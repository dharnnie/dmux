import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Tabs from '../components/Tabs';
import TerminalPane from '../components/TerminalPane';
import PlanViewer from '../components/PlanViewer';
import DiffViewer from '../components/DiffViewer';
import ScopeViolationViewer from '../components/ScopeViolationViewer';
import Button from '../components/Button';
import styles from './AgentDetail.module.css';

const STATUS_TONE = {
  running: 'green',
  completed: 'green',
  failed: 'red',
  cleaned: 'muted',
  abandoned: 'muted',
  waiting: 'orange',
  pending: 'muted',
};

const STATUS_GLYPH = {
  running: '●',
  completed: '✓',
  failed: '✗',
  waiting: '○',
  pending: '◌',
  abandoned: '⊘',
  cleaned: '○',
};

/**
 * Agent Detail — drill-in for one agent within a run. Section 4.8 (basic).
 *
 * Tabs: Terminal | Plan | Diff | Violations
 *   - Terminal: live xterm if the tmux session is still alive (run.status
 *     === 'running'); otherwise a tmux-attach hint + reference back to the
 *     pane the agent ran in.
 *   - Plan: PlanViewer reads .dmux/runs/{id}/plans/{name}.md.
 *   - Diff: DiffViewer renders git diff in the agent's worktree against
 *     the run's base branch.
 *   - Violations: placeholder until the scope-violation check ships.
 */
export default function AgentDetail() {
  const { name: projectName, runId, agentName } = useParams();
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('terminal');
  const [violationCount, setViolationCount] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetchRun = () => {
      fetch(`/api/projects/${projectName}/runs/${runId}`)
        .then(async (r) => {
          if (cancelled) return;
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            setError(body.error || `HTTP ${r.status}`);
            return;
          }
          setRun(await r.json());
        })
        .catch((e) => !cancelled && setError(e.message));
    };
    fetchRun();
    const id = setInterval(fetchRun, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [projectName, runId]);

  // Pull the violation count once per agent (or per polled run update) so
  // the Violations tab label can show "Violations (N)".
  useEffect(() => {
    let cancelled = false;
    const fetchCount = () => {
      fetch(`/api/projects/${projectName}/runs/${runId}/violations-summary`)
        .then((r) => (r.ok ? r.json() : { byAgent: {} }))
        .then((body) => {
          if (cancelled) return;
          const v = body?.byAgent?.[agentName];
          setViolationCount(typeof v === 'number' ? v : null);
        })
        .catch(() => !cancelled && setViolationCount(null));
    };
    fetchCount();
    const id = setInterval(fetchCount, 6000);
    return () => { cancelled = true; clearInterval(id); };
  }, [projectName, runId, agentName]);

  if (error) {
    return (
      <div className={styles.page}>
        <Link to={`/projects/${projectName}/runs/${runId}`} className={styles.backLink}>
          ← Run
        </Link>
        <p className={styles.error}>{error}</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className={styles.page}>
        <Link to={`/projects/${projectName}/runs/${runId}`} className={styles.backLink}>
          ← Run
        </Link>
        <p className={styles.loading}>Loading…</p>
      </div>
    );
  }

  const agent = run.agents.find((a) => a.name === agentName);
  if (!agent) {
    return (
      <div className={styles.page}>
        <Link to={`/projects/${projectName}/runs/${runId}`} className={styles.backLink}>
          ← Run
        </Link>
        <p className={styles.error}>
          Agent <code>{agentName}</code> is not part of this run.
        </p>
      </div>
    );
  }

  const paneIndex = run.config.agents.findIndex((a) => a.name === agentName);
  const sessionAlive = run.status === 'running';
  const hasUpstreamPlan = (agent.depends_on ?? []).some((depName) => {
    const dep = run.config.agents.find((a) => a.name === depName);
    return dep?.role === 'plan';
  });

  const sessionName = run.config.session ?? extractSessionFromYaml(run.config.yaml);

  return (
    <div className={styles.page}>
      <Link to={`/projects/${projectName}/runs/${runId}`} className={styles.backLink}>
        ← Run {formatTimestamp(run.started_at)}
      </Link>

      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{agent.name}</h1>
          <div className={styles.meta}>
            <span className={styles.rolePill}>{agent.role}</span>
            {agent.model && <span className={styles.model}>{agent.model}</span>}
            <span className={styles.statusBadge} data-tone={STATUS_TONE[agent.status]}>
              {STATUS_GLYPH[agent.status]} {agent.status}
            </span>
            {agent.branch && (
              <span className={styles.branch}>branch: <code>{agent.branch}</code></span>
            )}
          </div>
          {agent.depends_on?.length > 0 && (
            <div className={styles.deps}>
              Depends on:{' '}
              {agent.depends_on.map((dep, i) => {
                const depAgent = run.agents.find((a) => a.name === dep);
                const tone = STATUS_TONE[depAgent?.status] ?? 'muted';
                return (
                  <span key={dep}>
                    <span className={styles.depName}>{dep}</span>
                    <span className={styles.depStatus} data-tone={tone}>
                      ({STATUS_GLYPH[depAgent?.status] ?? '·'} {depAgent?.status ?? 'unknown'})
                    </span>
                    {i < agent.depends_on.length - 1 ? ', ' : ''}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </header>

      <Tabs
        tabs={[
          { value: 'terminal', label: 'Terminal' },
          { value: 'plan', label: 'Plan' },
          { value: 'diff', label: 'Diff' },
          {
            value: 'violations',
            label: 'Violations',
            count: violationCount && violationCount > 0 ? violationCount : undefined,
          },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'terminal' && (
          <TerminalTab
            sessionAlive={sessionAlive}
            sessionName={sessionName}
            paneIndex={paneIndex}
            agentName={agent.name}
          />
        )}
        {tab === 'plan' && (
          <PlanViewer
            projectName={projectName}
            runId={runId}
            agentName={agent.name}
            agentRole={agent.role}
            hasUpstreamPlan={hasUpstreamPlan}
          />
        )}
        {tab === 'diff' && (
          <DiffViewer projectName={projectName} runId={runId} agentName={agent.name} />
        )}
        {tab === 'violations' && (
          <ScopeViolationViewer
            projectName={projectName}
            runId={runId}
            agentName={agent.name}
            onClickViewDiff={() => setTab('diff')}
          />
        )}
      </Tabs>
    </div>
  );
}

function TerminalTab({ sessionAlive, sessionName, paneIndex, agentName }) {
  const [copied, setCopied] = useState(false);
  const attachCmd = sessionName ? `tmux attach -t ${sessionName}:0.${paneIndex}` : null;

  if (sessionAlive && paneIndex >= 0 && sessionName) {
    return (
      <div className={styles.terminalWrap}>
        <div className={styles.terminalBar}>
          <span className={styles.terminalLive}>● live</span>
          <span className={styles.terminalLabel}>
            session <code>{sessionName}</code> · pane {paneIndex}
          </span>
          <span className={styles.terminalSpacer} />
          {attachCmd && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(attachCmd);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? 'Copied!' : 'Copy attach command'}
            </Button>
          )}
        </div>
        <TerminalPane session={sessionName} paneIndex={paneIndex} agentName={agentName} />
      </div>
    );
  }

  return (
    <div className={styles.empty}>
      <p>Live terminal is not available.</p>
      <p className={styles.emptyHint}>
        The tmux session has ended (run completed, failed, or cleaned). xterm.js can
        only render against an active session.
      </p>
    </div>
  );
}

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Cheap fallback: extract `session: foo` from frozen YAML if run.config.session
// isn't populated. (createRun stores yaml; config.session was added later.)
function extractSessionFromYaml(yaml) {
  if (!yaml) return null;
  const m = yaml.match(/^session:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}
