import { useState, useEffect } from 'react';
import styles from './GitPanel.module.css';

export default function GitPanel({ projectName }) {
  const [git, setGit] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchGit = () => {
    fetch(`/api/projects/${projectName}/git`)
      .then((r) => r.json())
      .then((data) => {
        setGit(data.git ? data : null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchGit();
  }, [projectName]);

  if (loading) return null;
  if (!git) return null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.title}>Git</span>
        <button className={styles.refreshBtn} onClick={fetchGit}>Refresh</button>
      </div>

      <div className={styles.body}>
        {/* Branch + changes summary */}
        <div className={styles.topRow}>
          <div className={styles.branchChip}>{git.branch}</div>
          {git.changes > 0 ? (
            <div className={styles.changes}>
              {git.staged > 0 && <span className={styles.changeStat}><span className={styles.changeGreen}>{git.staged}</span> staged</span>}
              {git.modified > 0 && <span className={styles.changeStat}><span className={styles.changeOrange}>{git.modified}</span> modified</span>}
              {git.untracked > 0 && <span className={styles.changeStat}><span className={styles.changeMuted}>{git.untracked}</span> untracked</span>}
            </div>
          ) : (
            <span className={styles.clean}>clean</span>
          )}
        </div>

        {/* Recent commits */}
        {git.commits.length > 0 && (
          <div className={styles.commits}>
            {git.commits.map((c) => (
              <div key={c.hash} className={styles.commit}>
                <span className={styles.hash}>{c.hash}</span>
                <span className={styles.subject}>{c.subject}</span>
                <span className={styles.time}>{c.time}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
