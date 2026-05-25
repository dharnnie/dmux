import { Link } from 'react-router-dom';
import styles from './RunCard.module.css';

/**
 * RunCard — Section 3 / Section 4.2.
 *
 * Variants:
 *   full — the Dashboard's Running section; multi-line, status dot, agent
 *          summary chips, elapsed time.
 *   row  — the Dashboard's Recent section and Project Detail history; one
 *          line per run.
 *
 * Both variants link to /projects/{project}/runs/{id}.
 */
export default function RunCard({ run, variant = 'full', showProject = true }) {
  const isProposed = run.status === 'proposed';
  // Proposals are addressable as runs too (design §3.5: Run Detail renders the
  // proposal variant when status=proposed). The dedicated /proposals/:id route
  // arrives with PR 3.
  const to = `/projects/${run.project}/runs/${run.id}`;
  const tone = STATUS_TONE[run.status] ?? 'muted';
  const triggerText = formatTrigger(run.trigger);
  const eventAt = run.started_at ?? run.proposed_at ?? null;
  const elapsed = formatElapsed(run);

  if (variant === 'row') {
    return (
      <Link to={to} className={`${styles.row} ${styles[`tone_${tone}`]}`}>
        <span className={styles.rowIcon} aria-hidden="true">
          {STATUS_GLYPH[run.status] ?? '·'}
        </span>
        <span className={styles.rowStatus}>{run.status}</span>
        {showProject && <span className={styles.rowProject}>{run.project}</span>}
        <span className={styles.rowTimestamp}>{formatTimestamp(eventAt)}</span>
        <span className={styles.rowTrigger}>{triggerText}</span>
        <span className={styles.rowAgents}>
          {run.agent_count} agent{run.agent_count === 1 ? '' : 's'}
        </span>
        <span className={styles.rowSpacer} aria-hidden="true" />
        <span className={styles.rowChevron} aria-hidden="true">→</span>
      </Link>
    );
  }

  // full variant
  return (
    <Link to={to} className={`${styles.card} ${styles[`tone_${tone}`]}`}>
      <header className={styles.header}>
        <span className={styles.dot} data-running={run.status === 'running' || undefined} />
        <span className={styles.status}>{run.status}</span>
        {showProject && (
          <>
            <span className={styles.divider}>·</span>
            <span className={styles.project}>{run.project}</span>
          </>
        )}
        <span className={styles.divider}>·</span>
        <span className={styles.timestamp}>
          {isProposed ? 'Proposed' : 'Run'} {formatTimestamp(eventAt)}
        </span>
        <span className={styles.spacer} />
        <span className={styles.elapsed}>{elapsed}</span>
      </header>

      <div className={styles.trigger}>{triggerText}</div>

      <div className={styles.agents}>
        {run.agents?.map((a) => (
          <span
            key={a.name}
            className={`${styles.agentChip} ${styles[`chip_${AGENT_TONE[a.status] ?? 'muted'}`]}`}
            title={`${a.name}: ${a.status}`}
          >
            <span className={styles.agentGlyph} aria-hidden="true">
              {AGENT_GLYPH[a.status] ?? '·'}
            </span>
            {a.name}
          </span>
        ))}
      </div>

      <footer className={styles.footer}>
        <span className={styles.viewLink}>{isProposed ? 'Review →' : 'view run →'}</span>
      </footer>
    </Link>
  );
}

// -- helpers --

const STATUS_TONE = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cleaned: 'muted',
  abandoned: 'muted',
  pending: 'muted',
  proposed: 'cyan',
};

const STATUS_GLYPH = {
  running: '●',
  completed: '✓',
  failed: '✗',
  cleaned: '○',
  abandoned: '⊘',
  pending: '◌',
  proposed: '◌',
};

const AGENT_TONE = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  waiting: 'muted',
  pending: 'muted',
  abandoned: 'muted',
};

const AGENT_GLYPH = {
  running: '●',
  completed: '✓',
  failed: '✗',
  waiting: '○',
  pending: '◌',
  abandoned: '⊘',
};

function formatTrigger(trigger) {
  if (!trigger) return 'Manual';
  if (trigger.type === 'skill') return `Skill: ${trigger.skill_name ?? '?'}`;
  if (trigger.type === 'nl') return `NL: ${trigger.prompt ?? '?'}`;
  return 'Manual';
}

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  // 2026-05-20 14:32
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatElapsed(run) {
  const begin = run.started_at ?? run.proposed_at;
  if (!begin) return '';
  const start = new Date(begin).getTime();
  const end = run.completed_at ? new Date(run.completed_at).getTime() : Date.now();
  const ms = end - start;
  let value;
  if (ms < 60_000) value = `${Math.round(ms / 1000)}s`;
  else if (ms < 3_600_000) value = `${Math.round(ms / 60_000)}m`;
  else value = `${(ms / 3_600_000).toFixed(1)}h`;
  return run.status === 'proposed' ? `${value} ago` : value;
}
