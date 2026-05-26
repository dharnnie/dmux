import Button from './Button';
import styles from './ProjectSummaryHeader.module.css';

/**
 * ProjectSummaryHeader — the top of /projects/:name.
 * Single horizontal band (not a card). Name + path + branch + last commit
 * + agent count, with the New Run primary action right-aligned and an
 * Edit config secondary link.
 */
export default function ProjectSummaryHeader({
  project,
  git,
  hasConfig,
  agentCount,
  onNewRun,
  configHref,
  chatHref,
}) {
  return (
    <header className={styles.wrapper}>
      <div className={styles.top}>
        <div className={styles.titleBlock}>
          <h1 className={styles.name}>{project.name}</h1>
          <div className={styles.path}>{project.path}</div>
        </div>
        <Button variant="primary" onClick={onNewRun}>
          + New Run
        </Button>
      </div>

      <div className={styles.meta}>
        {git?.branch && (
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>on</span>{' '}
            <span className={styles.branch}>{git.branch}</span>
          </span>
        )}
        {git?.commits?.[0] && (
          <span className={styles.metaItem}>
            <span className={styles.hash}>{git.commits[0].hash}</span>{' '}
            <span className={styles.subject}>{git.commits[0].subject}</span>
          </span>
        )}
        <span className={styles.metaItem}>
          {hasConfig
            ? `${agentCount ?? '—'} agent${agentCount === 1 ? '' : 's'} configured`
            : 'No agents configured'}
        </span>
      </div>

      <div className={styles.actions}>
        {chatHref && (
          <Button variant="ghost" size="sm" to={chatHref}>
            💬 Chat
          </Button>
        )}
        <Button variant="ghost" size="sm" to={configHref}>
          Edit config →
        </Button>
      </div>
    </header>
  );
}
