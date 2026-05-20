import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import useAgentStatus from '../hooks/useAgentStatus';
import GitPanel from '../components/GitPanel';
import ProjectSummaryHeader from '../components/ProjectSummaryHeader';
import Card, { CardTitle } from '../components/Card';
import Button from '../components/Button';
import Disclosure from '../components/Disclosure';
import RunCard from '../components/RunCard';
import { useToast } from '../components/Toasts';
import styles from './ProjectDetail.module.css';

export default function ProjectDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [git, setGit] = useState(null);
  const [hasConfig, setHasConfig] = useState(false);
  const [agentCount, setAgentCount] = useState(null);
  const [runs, setRuns] = useState(null); // null = loading, [] = no runs

  // Quick Launch (legacy tmux pane spawn — demoted to Settings)
  const [panes, setPanes] = useState(2);
  const [claudePanes, setClaudePanes] = useState(1);

  const agentStatus = useAgentStatus(name);

  const fetchProject = () => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((projects) => {
        const p = projects.find((proj) => proj.name === name);
        if (p) {
          setProject(p);
          setHasConfig(p.hasAgentsConfig);
        }
      });
  };

  const fetchGit = () => {
    fetch(`/api/projects/${name}/git`)
      .then((r) => r.json())
      .then((data) => setGit(data.git ? data : null))
      .catch(() => setGit(null));
  };

  const fetchAgentCount = () => {
    fetch(`/api/projects/${name}/agents-config-parsed`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setAgentCount(data?.agents?.length ?? null))
      .catch(() => setAgentCount(null));
  };

  const fetchRuns = () => {
    fetch(`/api/projects/${name}/runs`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setRuns)
      .catch(() => setRuns([]));
  };

  useEffect(() => {
    fetchProject();
    fetchGit();
    fetchAgentCount();
    fetchRuns();
    // Refresh runs periodically so status updates while one is running.
    const id = setInterval(fetchRuns, 5000);
    return () => clearInterval(id);
  }, [name]);

  const handleNewRun = () => {
    // The spawn sheet (Wave 2A 4.6) isn't built yet. For now, take the user
    // to the editor where they can configure + Save & Start.
    toast('New Run sheet coming soon — opening the editor for now.', 'info');
    navigate(`/projects/${name}/agents`);
  };

  const handleLaunch = () => {
    toast('Launching tmux session...', 'info');
    fetch(`/api/projects/${name}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panes, claude: claudePanes }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) toast('Launched! Check your terminal.', 'success');
        else toast(data.error || 'Launch failed', 'error');
      })
      .catch((e) => toast(e.message, 'error'));
  };

  const handleCleanup = () => {
    toast('Cleaning up...', 'info');
    fetch(`/api/projects/${name}/agents/cleanup`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) toast('Cleanup complete.', 'success');
        else toast(data.error || 'Cleanup failed', 'error');
      })
      .catch((e) => toast(e.message, 'error'));
  };

  const handleDelete = () => {
    // TODO: replace window.confirm with a Sheet[dialog] confirmation in a
    // future PR (Section 5 Wave 1 fix #3).
    if (!confirm(`Remove project "${name}" from dmux?`)) return;
    fetch(`/api/projects/${name}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then(() => navigate('/'));
  };

  if (!project) {
    return (
      <div className={styles.page}>
        <Link to="/" className={styles.backLink}>← Projects</Link>
        <p>Loading...</p>
      </div>
    );
  }

  // Active-session detection. The Run noun (Wave 2A 4.7) isn't persisted yet,
  // so we infer "something is happening" from the live agent status.
  const isActive = agentStatus.running && (agentStatus.agents?.length ?? 0) > 0;

  return (
    <div className={styles.page}>
      <Link to="/" className={styles.backLink}>← Projects</Link>

      <ProjectSummaryHeader
        project={project}
        git={git}
        hasConfig={hasConfig}
        agentCount={agentCount}
        onNewRun={handleNewRun}
        configHref={`/projects/${name}/agents`}
      />

      <div className={styles.sections}>
        {isActive && (
          <Card header={<CardTitle>Active session</CardTitle>}>
            <div className={styles.activeRow}>
              <div className={styles.activeMeta}>
                <span className={styles.activeDot} aria-hidden="true" />
                <span>
                  {agentStatus.agents.length} agent{agentStatus.agents.length === 1 ? '' : 's'} —{' '}
                  {summarizeStatuses(agentStatus.agents)}
                </span>
              </div>
              <Button variant="secondary" size="sm" to={`/projects/${name}/agents`}>
                View session →
              </Button>
            </div>
          </Card>
        )}

        <Card header={<CardTitle>History</CardTitle>}>
          {runs === null ? (
            <p className={styles.loading}>Loading runs…</p>
          ) : runs.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyHeadline}>No runs yet on this project.</p>
              <p className={styles.emptyHint}>
                Save and start a run from the editor to begin building history.
              </p>
              <div className={styles.emptyActions}>
                <Button variant="primary" size="sm" onClick={handleNewRun}>
                  + New Run
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.historyList}>
              {runs.slice(0, 8).map((r) => (
                <RunCard key={r.id} run={{ ...r, project: name }} variant="row" showProject={false} />
              ))}
            </div>
          )}
        </Card>

        <Card header={<CardTitle>Context</CardTitle>}>
          <GitPanel projectName={name} />
          <p className={styles.contextHint}>
            CLAUDE.md preview lands with the Wave 2C adopt-repo flow.
          </p>
        </Card>

        <Disclosure title="Settings">
          <div className={styles.settingsBlock}>
            <div className={styles.settingsRow}>
              <div>
                <div className={styles.settingsLabel}>Quick Launch</div>
                <div className={styles.settingsHint}>
                  Legacy tmux pane spawning. New work should use New Run.
                </div>
              </div>
              <div className={styles.launchRow}>
                <label className={styles.launchField}>
                  <span>Panes</span>
                  <input
                    type="number"
                    min="1"
                    max="6"
                    value={panes}
                    onChange={(e) => setPanes(Number(e.target.value))}
                    className={styles.launchInput}
                  />
                </label>
                <label className={styles.launchField}>
                  <span>Claude panes</span>
                  <input
                    type="number"
                    min="0"
                    max={panes}
                    value={claudePanes}
                    onChange={(e) => setClaudePanes(Number(e.target.value))}
                    className={styles.launchInput}
                  />
                </label>
                <Button variant="secondary" size="sm" onClick={handleLaunch}>
                  Launch
                </Button>
              </div>
            </div>

            {hasConfig && (
              <div className={styles.settingsRow}>
                <div>
                  <div className={styles.settingsLabel}>Cleanup worktrees</div>
                  <div className={styles.settingsHint}>
                    Removes agent worktrees and ends any active tmux session.
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={handleCleanup}>
                  Cleanup
                </Button>
              </div>
            )}

            <div className={styles.settingsRow}>
              <div>
                <div className={styles.settingsLabel}>Remove project</div>
                <div className={styles.settingsHint}>
                  Removes this project from dmux's registry. Files on disk are untouched.
                </div>
              </div>
              <Button variant="danger" size="sm" onClick={handleDelete}>
                Remove project
              </Button>
            </div>
          </div>
        </Disclosure>
      </div>
    </div>
  );
}

function summarizeStatuses(agents) {
  const counts = agents.reduce((acc, a) => {
    const key = a.status?.startsWith('waiting') ? 'waiting' : a.status;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([s, n]) => `${n} ${s}`)
    .join(', ');
}
