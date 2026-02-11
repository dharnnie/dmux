import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import StatusTable from '../components/StatusTable';
import styles from './ProjectDetail.module.css';

export default function ProjectDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [panes, setPanes] = useState(2);
  const [claudePanes, setClaudePanes] = useState(1);
  const [message, setMessage] = useState('');
  const [hasConfig, setHasConfig] = useState(false);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((projects) => {
        const p = projects.find((proj) => proj.name === name);
        if (p) {
          setProject(p);
          setHasConfig(p.hasAgentsConfig);
        }
      });
  }, [name]);

  const handleLaunch = () => {
    setMessage('Launching...');
    fetch(`/api/projects/${name}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panes, claude: claudePanes }),
    })
      .then((r) => r.json())
      .then((data) => {
        setMessage(data.ok ? 'Launched! Check your terminal.' : `Error: ${data.error}`);
      })
      .catch((e) => setMessage(`Error: ${e.message}`));
  };

  const handleStartAgents = () => {
    setMessage('Starting agents...');
    fetch(`/api/projects/${name}/agents/start`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        setMessage(data.ok ? 'Agents started! Check your terminal.' : `Error: ${data.error}`);
      })
      .catch((e) => setMessage(`Error: ${e.message}`));
  };

  const handleCleanup = () => {
    setMessage('Cleaning up...');
    fetch(`/api/projects/${name}/agents/cleanup`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        setMessage(data.ok ? 'Cleanup complete.' : `Error: ${data.error}`);
      })
      .catch((e) => setMessage(`Error: ${e.message}`));
  };

  const handleDelete = () => {
    if (!confirm(`Remove project "${name}" from dmux?`)) return;
    fetch(`/api/projects/${name}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then(() => navigate('/'));
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
            <>
              <div className={styles.agentActions}>
                <Link to={`/projects/${name}/agents`} className={styles.btnPink}>
                  Edit Config
                </Link>
                <button className={styles.btnCyan} onClick={handleStartAgents}>
                  Start Agents
                </button>
                <button className={styles.btnDanger} onClick={handleCleanup}>
                  Cleanup
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={styles.noConfig}>No .dmux-agents.yml found for this project.</p>
              <div className={styles.agentActions}>
                <Link to={`/projects/${name}/agents`} className={styles.btnPink}>
                  Create Agent Config
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Status (always show, will gracefully handle no session) */}
        <StatusTable projectName={name} />

        {message && <div className={styles.message}>{message}</div>}

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
