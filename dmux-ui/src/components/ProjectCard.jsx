import { Link } from 'react-router-dom';
import styles from './ProjectCard.module.css';

export default function ProjectCard({ project }) {
  return (
    <Link to={`/projects/${project.name}`} className={styles.card}>
      <div className={styles.name}>{project.name}</div>
      <div className={styles.path}>{project.path}</div>
      <div className={styles.badges}>
        {project.hasAgentsConfig && (
          <span className={`${styles.badge} ${styles.badgeAgents}`}>agents</span>
        )}
        {project.hasSession && (
          <span className={`${styles.badge} ${styles.badgeSession}`}>running</span>
        )}
      </div>
    </Link>
  );
}
