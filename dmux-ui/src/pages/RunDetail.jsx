import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import Card, { CardTitle } from '../components/Card';
import Disclosure from '../components/Disclosure';
import Button from '../components/Button';
import { ConfirmDialog } from '../components/Sheet';
import { useToast } from '../components/Toasts';
import styles from './RunDetail.module.css';

const STATUS_TONE = {
  running: 'green',
  completed: 'green',
  failed: 'red',
  cleaned: 'muted',
  abandoned: 'muted',
  pending: 'muted',
  waiting: 'orange',
};

const STATUS_GLYPH = {
  running: '●',
  completed: '✓',
  failed: '✗',
  cleaned: '○',
  abandoned: '⊘',
  pending: '◌',
  waiting: '○',
};

/**
 * Run Detail — a specific run within a project. This is the "basic" version
 * per the Section 4.7 wireframe — agent list table + frozen config disclosure
 * + link back to the editor's live terminal view. The dedicated Agent Detail
 * drill-in page (Tabs for Terminal/Plan/Diff/Violations) is a follow-up.
 */
export default function RunDetail() {
  const { name, runId } = useParams();
  const toast = useToast();
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [violations, setViolations] = useState(null); // { byAgent: { name: count|null } }

  const fetchRun = () => {
    fetch(`/api/projects/${name}/runs/${runId}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          setError(body.error || `HTTP ${r.status}`);
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data) setRun(data);
      })
      .catch((e) => setError(e.message));
  };

  const fetchViolations = () => {
    fetch(`/api/projects/${name}/runs/${runId}/violations-summary`)
      .then((r) => (r.ok ? r.json() : { byAgent: {} }))
      .then(setViolations)
      .catch(() => setViolations({ byAgent: {} }));
  };

  useEffect(() => {
    fetchRun();
    fetchViolations();
    // Light polling — agent statuses are derived from signal files on the
    // server, so this picks up completions as they happen. Violations
    // refresh on a slower interval since they cost a git diff per agent.
    const id = setInterval(fetchRun, 4000);
    const id2 = setInterval(fetchViolations, 8000);
    return () => { clearInterval(id); clearInterval(id2); };
  }, [name, runId]);

  if (error) {
    return (
      <div className={styles.page}>
        <Link to={`/projects/${name}`} className={styles.backLink}>← {name}</Link>
        <Card><p className={styles.error}>{error}</p></Card>
      </div>
    );
  }

  if (!run) {
    return (
      <div className={styles.page}>
        <Link to={`/projects/${name}`} className={styles.backLink}>← {name}</Link>
        <p className={styles.loading}>Loading run…</p>
      </div>
    );
  }

  const elapsed = formatElapsed(run);

  // Compute violation summary: total across all agents, plus the first
  // agent name with violations (for the banner's deep link).
  const byAgent = violations?.byAgent ?? {};
  const totalViolations = Object.values(byAgent).reduce(
    (acc, n) => acc + (typeof n === 'number' ? n : 0),
    0,
  );
  const firstViolatingAgent = Object.entries(byAgent).find(
    ([, n]) => typeof n === 'number' && n > 0,
  )?.[0];

  return (
    <div className={styles.page}>
      <Link to={`/projects/${name}`} className={styles.backLink}>← {name}</Link>

      {totalViolations > 0 && firstViolatingAgent && (
        <div className={styles.violationBanner} role="alert">
          <span className={styles.violationGlyph} aria-hidden="true">⚠</span>
          <span>
            <strong>{totalViolations}</strong> scope violation{totalViolations === 1 ? '' : 's'} detected.
          </span>
          <Link
            to={`/projects/${name}/runs/${runId}/agents/${firstViolatingAgent}`}
            className={styles.violationLink}
          >
            View violations →
          </Link>
        </div>
      )}

      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.statusLine}>
            <span className={styles.statusGlyph} data-tone={STATUS_TONE[run.status]}>
              {STATUS_GLYPH[run.status] ?? '·'}
            </span>
            <span className={styles.status}>{run.status}</span>
            <span className={styles.elapsed}>· {elapsed}</span>
          </div>
          <h1 className={styles.title}>Run {formatTimestamp(run.started_at)}</h1>
          <div className={styles.meta}>
            {formatTrigger(run.trigger)} · {run.agents.length} agent{run.agents.length === 1 ? '' : 's'}
          </div>
        </div>
        {run.status === 'running' && (
          <div className={styles.headerActions}>
            <Button variant="secondary" to={`/projects/${name}/agents`}>
              Open terminals →
            </Button>
            <Button variant="danger" onClick={() => setConfirmStop(true)}>
              Stop run
            </Button>
          </div>
        )}
      </header>

      <ConfirmDialog
        open={confirmStop}
        onClose={() => !stopping && setConfirmStop(false)}
        onConfirm={async () => {
          setStopping(true);
          try {
            const res = await fetch(`/api/projects/${name}/runs/${runId}/stop`, { method: 'POST' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
            toast(body.sessionWasAlive ? 'Run stopped.' : 'Run marked cleaned.', 'success');
            setConfirmStop(false);
            fetchRun();
          } catch (e) {
            toast(`Couldn't stop run: ${e.message}`, 'error');
          } finally {
            setStopping(false);
          }
        }}
        title="Stop run?"
        message="Agents will be terminated. Worktrees stay until you clean them up. This can't be undone."
        confirmLabel="Stop run"
        confirmVariant="danger"
        busy={stopping}
      />

      <Card header={<CardTitle>Agents</CardTitle>}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Role</th>
              <th>Model</th>
              <th>Branch</th>
              <th>Status</th>
              <th>Duration</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {run.agents.map((a) => (
              <tr key={a.name} className={styles.row}>
                <td className={styles.cellName}>
                  <Link to={`/projects/${name}/runs/${runId}/agents/${a.name}`} className={styles.agentLink}>
                    {a.name}
                  </Link>
                </td>
                <td className={styles.cellMono}>{a.role}</td>
                <td className={styles.cellMono}>{a.model ?? '—'}</td>
                <td className={styles.cellMono}>{a.branch || '—'}</td>
                <td>
                  <span className={styles.statusBadge} data-tone={STATUS_TONE[a.status]}>
                    {STATUS_GLYPH[a.status] ?? '·'} {a.status}
                  </span>
                  {byAgent[a.name] > 0 && (
                    <span
                      className={styles.violationPill}
                      title={`${byAgent[a.name]} scope violation${byAgent[a.name] === 1 ? '' : 's'}`}
                    >
                      ⚠ {byAgent[a.name]}
                    </span>
                  )}
                </td>
                <td className={styles.cellMono}>{formatAgentDuration(run, a)}</td>
                <td className={styles.cellOpen}>
                  <Link to={`/projects/${name}/runs/${runId}/agents/${a.name}`} className={styles.openLink}>
                    open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.tableHint}>
          Per-agent terminal, plan, diff, and scope-violation drill-ins ship in a follow-up slice. For now,{' '}
          <Link to={`/projects/${name}/agents`}>open the editor view</Link> to see live terminals.
        </p>
      </Card>

      <Disclosure title={`Run config (frozen at ${formatTimestamp(run.started_at)})`}>
        <pre className={styles.yaml}>{run.config.yaml}</pre>
      </Disclosure>
    </div>
  );
}

// -- helpers --

function formatTrigger(t) {
  if (!t) return 'Manual';
  if (t.type === 'skill') return `Skill: ${t.skill_name ?? '?'}`;
  if (t.type === 'nl') return `NL: ${t.prompt ?? '?'}`;
  return 'Manual';
}

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatElapsed(run) {
  if (!run.started_at) return '';
  const start = new Date(run.started_at).getTime();
  const end = run.completed_at ? new Date(run.completed_at).getTime() : Date.now();
  const ms = end - start;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m elapsed`;
  return `${(ms / 3_600_000).toFixed(1)}h elapsed`;
}

function formatAgentDuration(run, a) {
  if (!a.completed_at) return '—';
  const start = new Date(run.started_at).getTime();
  const end = new Date(a.completed_at).getTime();
  const ms = Math.max(0, end - start);
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
