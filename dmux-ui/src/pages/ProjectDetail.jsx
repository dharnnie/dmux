import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import useAgentStatus from '../hooks/useAgentStatus';
import StatusTable from '../components/StatusTable';
import AgentTerminals from '../components/AgentTerminals';
import GitPanel from '../components/GitPanel';
import SkillPicker from '../components/SkillPicker';
import { useToast } from '../components/Toasts';
import styles from './ProjectDetail.module.css';

export default function ProjectDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [panes, setPanes] = useState(2);
  const [claudePanes, setClaudePanes] = useState(1);
  const [hasConfig, setHasConfig] = useState(false);

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

  useEffect(() => {
    fetchProject();
  }, [name]);

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

  const handleStartAgents = () => {
    toast('Starting agents...', 'info');
    fetch(`/api/projects/${name}/agents/start`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) toast('Agents started!', 'success');
        else toast(data.error || 'Failed to start agents', 'error');
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
    if (!confirm(`Remove project "${name}" from dmux?`)) return;
    fetch(`/api/projects/${name}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then(() => navigate('/'));
  };

  const handleSkillApplied = (skillName, started) => {
    setHasConfig(true);
    if (started) {
      toast(`Skill "${skillName}" applied and agents started!`, 'success');
    } else {
      toast(`Skill "${skillName}" applied — config generated.`, 'success');
    }
    fetchProject();
  };

  if (!project) {
    return (
      <div className={styles.page}>
        <Link to="/" className={styles.backLink}>&#8592; Back</Link>
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Link to="/" className={styles.backLink}>&#8592; Projects</Link>

      <div className={styles.header}>
        <h1 className={styles.name}>{project.name}</h1>
        <div className={styles.path}>{project.path}</div>
      </div>

      <div className={styles.sections}>
        {/* Quick Launch */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Quick Launch</h2>
          <div className={styles.launchRow}>
            <div className={styles.launchField}>
              <label className={styles.launchLabel}>Panes</label>
              <input
                className={styles.launchInput}
                type="number"
                min="1"
                max="6"
                value={panes}
                onChange={(e) => setPanes(Number(e.target.value))}
              />
            </div>
            <div className={styles.launchField}>
              <label className={styles.launchLabel}>Claude Panes</label>
              <input
                className={styles.launchInput}
                type="number"
                min="0"
                max={panes}
                value={claudePanes}
                onChange={(e) => setClaudePanes(Number(e.target.value))}
              />
            </div>
            <button className={styles.launchBtn} onClick={handleLaunch}>
              Launch
            </button>
          </div>
        </div>

        {/* Agents */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Agents</h2>

          {hasConfig ? (
            <div className={styles.agentActions}>
              <Link to={`/projects/${name}/agents`} className={styles.btnPink}>
                Edit Config
              </Link>
              <button className={styles.btnCyan} onClick={handleStartAgents}>
                Start Agents
              </button>
              <SkillPicker projectName={name} onApplied={handleSkillApplied} />
              <button className={styles.btnDanger} onClick={handleCleanup}>
                Cleanup
              </button>
            </div>
          ) : (
            <>
              <p className={styles.noConfig}>No .dmux-agents.yml found for this project.</p>
              <div className={styles.agentActions}>
                <Link to={`/projects/${name}/agents`} className={styles.btnPink}>
                  Create Agent Config
                </Link>
                <SkillPicker projectName={name} onApplied={handleSkillApplied} />
              </div>
            </>
          )}
        </div>

        {/* Git info */}
        <GitPanel projectName={name} />

        {/* Agent status — live via WebSocket */}
        <StatusTable {...agentStatus} />

        {/* Embedded terminals — click an agent tab to see its output */}
        <AgentTerminals session={agentStatus.session} agents={agentStatus.agents} />

        {/* Danger zone */}
        <div className={styles.card}>
          <div className={styles.deleteSection}>
            <span className={styles.deleteHint}>Remove this project from dmux (does not delete files)</span>
            <button className={styles.btnDanger} onClick={handleDelete}>
              Remove Project
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
