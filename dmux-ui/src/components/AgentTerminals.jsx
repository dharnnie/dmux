import { useState } from 'react';
import TerminalPane from './TerminalPane';
import styles from './AgentTerminals.module.css';

export default function AgentTerminals({ session, agents }) {
  const [expanded, setExpanded] = useState(null);

  if (!session || agents.length === 0) return null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.title}>Terminals</span>
        <span className={styles.hint}>{agents.length} agent{agents.length !== 1 ? 's' : ''}</span>
      </div>

      <div className={styles.tabs}>
        {agents.map((a, i) => (
          <button
            key={a.name}
            className={`${styles.tab} ${expanded === i ? styles.tabActive : ''}`}
            onClick={() => setExpanded(expanded === i ? null : i)}
          >
            {a.name}
          </button>
        ))}
        {expanded !== null && (
          <button
            className={styles.tabClose}
            onClick={() => setExpanded(null)}
          >
            Close
          </button>
        )}
      </div>

      {expanded !== null && agents[expanded] && (
        <TerminalPane
          session={session}
          paneIndex={expanded}
          agentName={agents[expanded].name}
        />
      )}
    </div>
  );
}
