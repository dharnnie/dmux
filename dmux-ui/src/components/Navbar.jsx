import { Link, useLocation } from 'react-router-dom';
import styles from './Navbar.module.css';

const LINKS = [
  { to: '/', label: 'Dashboard' },
  { to: '/activity', label: 'Activity' },
  { to: '/projects', label: 'Projects' },
  { to: '/skills', label: 'Skills' },
  { to: '/chat', label: 'Chat' },
];

export default function Navbar() {
  const { pathname } = useLocation();
  // Active match: exact for "/", prefix for everything else.
  const isActive = (path) => (path === '/' ? pathname === '/' : pathname.startsWith(path));

  return (
    <nav className={styles.navbar} aria-label="Primary">
      <Link to="/" className={styles.logo}>
        <span className={styles.logoText}>
          d<span className={styles.logoAccent}>mux</span>
        </span>
      </Link>
      <div className={styles.nav}>
        {LINKS.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className={`${styles.navLink} ${isActive(l.to) ? styles.navLinkActive : ''}`}
            aria-current={isActive(l.to) ? 'page' : undefined}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
