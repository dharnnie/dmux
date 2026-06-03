import Card, { CardTitle } from './Card';
import Disclosure from './Disclosure';
import useRunTimeline from '../hooks/useRunTimeline';
import styles from './TimelinePanel.module.css';

/**
 * TimelinePanel — Wave 4A Slice 1.
 *
 * Renders the run's timeline.jsonl event stream as a chronological list.
 * Auto-polls every 3s while the run is in `running` state (via
 * useRunTimeline). Hides itself entirely when there are no events to
 * surface — Run Detail stays clean for completed runs that never wrote
 * a timeline (older runs from before Wave 4A).
 *
 * Props:
 *   projectName — current project
 *   runId       — current run id
 *   runStatus   — the run's status field (drives polling)
 */
export default function TimelinePanel({ projectName, runId, runStatus }) {
  const { events, malformedCount, ready } = useRunTimeline(projectName, runId, runStatus);

  if (!ready) return null;
  if (events.length === 0 && malformedCount === 0) return null;

  const title = (
    <span>
      Timeline
      <span className={styles.count}> · {events.length} event{events.length === 1 ? '' : 's'}</span>
      {runStatus === 'running' && <span className={styles.liveChip}>● live</span>}
    </span>
  );

  return (
    <Card header={<CardTitle>{title}</CardTitle>}>
      <Disclosure title="Show event log" defaultOpen>
        <ol className={styles.list}>
          {events.map((ev, i) => (
            <li key={i} className={styles.row}>
              <span className={styles.time} title={ev.ts}>{formatTime(ev.ts)}</span>
              <span className={styles.glyph} data-tone={toneFor(ev.type)}>{glyphFor(ev.type)}</span>
              <span className={styles.type}>{ev.type.replace(/_/g, ' ')}</span>
              {ev.agent && <span className={styles.agent}>· {ev.agent}</span>}
              <span className={styles.summary}>· {ev.summary}</span>
            </li>
          ))}
        </ol>
        {malformedCount > 0 && (
          <p className={styles.footer}>
            ⚠ {malformedCount} malformed event{malformedCount === 1 ? '' : 's'} skipped.
          </p>
        )}
      </Disclosure>
    </Card>
  );
}

function formatTime(iso) {
  if (typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const TONE_BY_TYPE = {
  run_started: 'cyan',
  agent_started: 'cyan',
  plan_written: 'green',
  review_written: 'green',
  agent_succeeded: 'green',
  agent_failed: 'red',
  agent_blocked: 'red',
  scope_violation: 'orange',
  proposal_ready: 'cyan',
  run_completed: 'green',
};
function toneFor(type) { return TONE_BY_TYPE[type] || 'muted'; }

const GLYPH_BY_TYPE = {
  run_started: '●',
  agent_started: '●',
  plan_written: '📋',
  review_written: '⚖️',
  agent_succeeded: '✓',
  agent_failed: '✗',
  agent_blocked: '⊘',
  scope_violation: '⚠',
  proposal_ready: '●',
  run_completed: '✓',
};
function glyphFor(type) { return GLYPH_BY_TYPE[type] || '·'; }
