import { useParams, Link } from 'react-router-dom';
import ChatSurface from '../components/ChatSurface';
import styles from './ProjectChat.module.css';

/**
 * ProjectChat — page wrapper for /projects/:name/chat. Renders the
 * generalized ChatSurface scoped to one project. Slice 1 of Wave 3B.
 */
export default function ProjectChat() {
  const { name } = useParams();

  return (
    <div className={styles.page}>
      <Link to={`/projects/${name}`} className={styles.backLink}>← {name}</Link>
      <ChatSurface
        apiBase={`/api/chat/project/${name}`}
        scopeLabel="Project chat"
        subtitle={name}
        defaultProject={name}
        lockProject
      />
    </div>
  );
}
