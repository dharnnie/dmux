import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import RunCard from '../components/RunCard';
import Button from '../components/Button';
import { useToast } from '../components/Toasts';
import styles from './Dashboard.module.css';

/**
 * Dashboard — the new landing surface at `/`. Shows in-flight runs across
 * all projects, plus a Recent section. Replaces the Projects grid as `/`;
 * the projects list moves to `/projects`.
 */
export default function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [runs, setRuns] = useState(null); // null = loading, [] = no runs

  const fetchRuns = () => {
    fetch('/api/runs')
      .then((r) => r.json())
      .then(setRuns)
      .catch(() => setRuns([]));
  };

  useEffect(() => {
    fetchRuns();
    // Light polling for in-flight changes. Could move to WebSocket later.
    const id = setInterval(fetchRuns, 5000);
    return () => clearInterval(id);
  }, []);

  const handleNewRun = () => {
    toast('New Run sheet coming in a later Wave 2A slice — pick a project to start.', 'info');
    navigate('/projects');
  };

  if (runs === null) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Activity</h1>
        </header>
        <p className={styles.loading}>Loading runs…</p>
      </div>
    );
  }

  const running = runs.filter((r) => r.status === 'running');
  const proposed = runs.filter((r) => r.status === 'proposed');
  const recent = runs
    .filter((r) => r.status !== 'running' && r.status !== 'proposed')
    .slice(0, 8);

  const empty = running.length === 0 && proposed.length === 0 && recent.length === 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Activity</h1>
        <Button variant="primary" onClick={handleNewRun}>
          + New Run
        </Button>
      </header>

      {empty ? (
        <section className={styles.empty}>
          <h2 className={styles.emptyHeadline}>No runs yet</h2>
          <p className={styles.emptyHint}>
            Start your first agent run from a project, or pick a skill to spawn a team.
          </p>
          <div className={styles.emptyActions}>
            <Button variant="primary" onClick={handleNewRun}>+ New Run</Button>
            <Button variant="secondary" to="/projects">Browse projects</Button>
          </div>
        </section>
      ) : (
        <>
          {running.length > 0 && (
            <Section title={`Running (${running.length})`}>
              <div className={styles.runningGrid}>
                {running.map((r) => (
                  <RunCard key={r.id} run={r} variant="full" />
                ))}
              </div>
            </Section>
          )}

          {proposed.length > 0 && (
            <Section title={`Pending proposals (${proposed.length})`}>
              <div className={styles.runningGrid}>
                {proposed.map((r) => (
                  <RunCard key={r.id} run={r} variant="full" />
                ))}
              </div>
            </Section>
          )}

          {recent.length > 0 && (
            <Section title={`Recent (${recent.length})`}>
              <div className={styles.rowsList}>
                {recent.map((r) => (
                  <RunCard key={r.id} run={r} variant="row" />
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}
