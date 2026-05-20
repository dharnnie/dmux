import { Link, useLocation } from 'react-router-dom';
import styles from './Navbar.module.css';

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
        <Link
          to="/"
          className={`${styles.navLink} ${isActive('/') ? styles.navLinkActive : ''}`}
          aria-current={isActive('/') ? 'page' : undefined}
        >
          Projects
        </Link>
        <Link
          to="/skills"
          className={`${styles.navLink} ${isActive('/skills') ? styles.navLinkActive : ''}`}
          aria-current={isActive('/skills') ? 'page' : undefined}
        >
          Skills
        </Link>
      </div>
    </nav>
  );
}
