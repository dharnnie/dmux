import { Link } from 'react-router-dom';
import useActivity from '../hooks/useActivity';
import styles from './Activity.module.css';

/**
 * Activity — Wave 4A Slice 2 god-view.
 *
 * Mosaic of currently-active agents across all projects. Each card:
 *   project / agent name → agent status + branch → last timeline event.
 * Polls every 3s via useActivity.
 *
 * Empty state (no active agents): renders the 5 most-recently-terminal
 * runs with their final event. Keeps the page useful when nothing's in
 * flight.
 */
export default function Activity() {
  const { summary, ready } = useActivity();

  if (!ready) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Activity</h1>
        </header>
        <p className={styles.loading}>Loading activity…</p>
      </div>
    );
  }

  const activeAgents = summary?.activeAgents ?? [];
  const activeRunCount = summary?.activeRunCount ?? 0;
  const lastEventTs = summary?.lastEventTs ?? null;
  const recentlyCompleted = summary?.recentlyCompleted ?? [];

  const liveSummary = activeAgents.length > 0
    ? `${activeRunCount} active run${activeRunCount === 1 ? '' : 's'} · ${activeAgents.length} agent${activeAgents.length === 1 ? '' : 's'} working${lastEventTs ? ` · last event ${relativeTime(lastEventTs)}` : ''}`
    : 'No active runs';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          Activity
          <span className={styles.liveChip} aria-hidden>● live</span>
        </h1>
        <p className={styles.summary}>{liveSummary}</p>
      </header>

      {activeAgents.length > 0 ? (
        <div className={styles.mosaic}>
          {activeAgents.map((a) => (
            <AgentCard key={`${a.project}/${a.runId}/${a.agentName}`} agent={a} />
          ))}
        </div>
      ) : (
        <RecentlyCompletedSection items={recentlyCompleted} />
      )}
    </div>
  );
}

function AgentCard({ agent }) {
  const { project, runId, agentName, agentRole, branch, agentStatus, lastEvent } = agent;
  const glyph = STATUS_GLYPH[agentStatus] ?? '·';
  const tone = STATUS_TONE[agentStatus] ?? 'muted';

  return (
    <Link
      to={`/projects/${project}/runs/${runId}/agents/${agentName}`}
      className={styles.card}
    >
      <header className={styles.cardHeader}>
        <span className={styles.cardProject}>{project}</span>
        <span className={styles.cardSep}>/</span>
        <span className={styles.cardAgent}>{agentName}</span>
        {agentRole && <span className={styles.cardRole}>{agentRole}</span>}
      </header>

      <div className={styles.cardStatus} data-tone={tone}>
        <span className={styles.cardGlyph}>{glyph}</span>
        <span className={styles.cardStatusText}>{agentStatus}</span>
      </div>

      {branch && <div className={styles.cardBranch}>{branch}</div>}

      <div className={styles.cardEvent}>
        {lastEvent ? (
          <>
            <div className={styles.cardEventLabel}>
              Last: {lastEvent.type.replace(/_/g, ' ')}
            </div>
            <div className={styles.cardEventSummary} title={lastEvent.ts}>
              {lastEvent.summary}
            </div>
            <div className={styles.cardEventTime}>{relativeTime(lastEvent.ts)}</div>
          </>
        ) : (
          <div className={styles.cardEventNone}>No events yet</div>
        )}
      </div>
    </Link>
  );
}

function RecentlyCompletedSection({ items }) {
  if (items.length === 0) {
    return (
      <section className={styles.empty}>
        <h2 className={styles.emptyHeadline}>Nothing in flight</h2>
        <p className={styles.emptyHint}>
          Once a run starts, its agents will appear here in real time.
        </p>
      </section>
    );
  }
  return (
    <section className={styles.recent}>
      <h2 className={styles.sectionTitle}>Recently completed</h2>
      <div className={styles.recentList}>
        {items.map((r) => (
          <Link
            key={`${r.project}/${r.runId}`}
            to={`/projects/${r.project}/runs/${r.runId}`}
            className={styles.recentRow}
          >
            <span className={styles.recentStatus} data-tone={STATUS_TONE[r.status] ?? 'muted'}>
              {STATUS_GLYPH[r.status] ?? '·'} {r.status}
            </span>
            <span className={styles.recentProject}>{r.project}</span>
            <span className={styles.recentAgents}>
              {r.agentCount} agent{r.agentCount === 1 ? '' : 's'}
            </span>
            <span className={styles.recentEvent}>
              {r.lastEvent ? r.lastEvent.summary : '(no timeline)'}
            </span>
            <span className={styles.recentTime}>
              {r.completedAt ? relativeTime(r.completedAt) : ''}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

const STATUS_GLYPH = {
  running: '●',
  waiting: '◌',
  pending: '◌',
  completed: '✓',
  failed: '✗',
  abandoned: '⊘',
  cleaned: '·',
  unknown: '?',
};

const STATUS_TONE = {
  running: 'cyan',
  waiting: 'muted',
  pending: 'muted',
  completed: 'green',
  failed: 'red',
  abandoned: 'muted',
  cleaned: 'muted',
  unknown: 'muted',
};

function relativeTime(iso) {
  if (typeof iso !== 'string') return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
