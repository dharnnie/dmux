import ChatSurface from '../components/ChatSurface';
import styles from './ProjectChat.module.css';

/**
 * GlobalChat — page wrapper for /chat. Renders the generalized ChatSurface
 * scoped to dmux-global (cross-project planning surface).
 */
export default function GlobalChat() {
  return (
    <div className={styles.page}>
      <ChatSurface
        apiBase="/api/chat/global"
        scopeLabel="dmux Chat"
        subtitle="Cross-project planning"
      />
    </div>
  );
}
