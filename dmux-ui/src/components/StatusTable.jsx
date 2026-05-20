import styles from './StatusTable.module.css';

const STATUS_COLORS = {
  running: 'green',
  done: 'green',
  idle: 'muted',
  waiting: 'orange',
  blocked: 'red',
  failed: 'red',
  unknown: 'muted',
};

function getStatusKey(status) {
  if (status.startsWith('waiting')) return 'waiting';
  if (status.startsWith('failed')) return 'failed';
  return status;
}

export default function StatusTable({ running, agents, session, connected, refresh }) {
  if (!running) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.header}>
          <span className={styles.title}>Agent Status</span>
          <div className={styles.headerRight}>
            <span className={`${styles.dot} ${connected ? styles.dotOn : styles.dotOff}`} />
          </div>
        </div>
        <div className={styles.empty}>No active agent session</div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>Agent Status</span>
          {session && <span className={styles.session}>{session}</span>}
        </div>
        <div className={styles.headerRight}>
          <span className={`${styles.dot} ${connected ? styles.dotOn : styles.dotOff}`} />
          <button className={styles.refreshBtn} onClick={refresh}>Refresh</button>
        </div>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Agent</th>
            <th className={styles.th}>Branch</th>
            <th className={styles.th}>Role</th>
            <th className={styles.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => {
            const colorKey = getStatusKey(a.status);
            return (
              <tr key={a.name} className={styles.row}>
                <td className={styles.td}>
                  <span className={styles.agentName}>{a.name}</span>
                </td>
                <td className={styles.td}>
                  {a.branch ? (
                    <span className={styles.branch}>{a.branch}</span>
                  ) : (
                    <span className={styles.noBranch}>--</span>
                  )}
                </td>
                <td className={styles.td}>
                  <span className={`${styles.role} ${a.role === 'review' ? styles.roleReview : ''}`}>
                    {a.role}
                  </span>
                </td>
                <td className={styles.td}>
                  <span className={`${styles.badge} ${styles[`badge_${STATUS_COLORS[colorKey] || 'muted'}`]}`}>
                    {a.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
