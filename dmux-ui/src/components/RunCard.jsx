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
  const to = `/projects/${run.project}/runs/${run.id}`;
  const tone = STATUS_TONE[run.status] ?? 'muted';
  const triggerText = formatTrigger(run.trigger);
  const elapsed = formatElapsed(run);

  if (variant === 'row') {
    return (
      <Link to={to} className={`${styles.row} ${styles[`tone_${tone}`]}`}>
        <span className={styles.rowIcon} aria-hidden="true">
          {STATUS_GLYPH[run.status] ?? '·'}
        </span>
        <span className={styles.rowStatus}>{run.status}</span>
        {showProject && <span className={styles.rowProject}>{run.project}</span>}
        <span className={styles.rowTimestamp}>{formatTimestamp(run.started_at)}</span>
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
        <span className={styles.timestamp}>Run {formatTimestamp(run.started_at)}</span>
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
        <span className={styles.viewLink}>view run →</span>
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
  if (!run.started_at) return '';
  const start = new Date(run.started_at).getTime();
  const end = run.completed_at ? new Date(run.completed_at).getTime() : Date.now();
  const ms = end - start;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
