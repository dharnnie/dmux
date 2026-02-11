import { useState, useEffect } from 'react';
import styles from './StatusTable.module.css';

export default function StatusTable({ projectName }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const fetchStatus = () => {
    fetch(`/api/projects/${projectName}/agents/status`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setStatus(data.output);
          setError(null);
        } else {
          setError(data.error);
        }
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [projectName]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.title}>Agent Status</span>
        <button className={styles.refreshBtn} onClick={fetchStatus}>
          Refresh
        </button>
      </div>
      {error ? (
        <div className={styles.empty}>{error}</div>
      ) : status ? (
        <pre className={styles.pre}>{status}</pre>
      ) : (
        <div className={styles.empty}>Loading...</div>
      )}
    </div>
  );
}
