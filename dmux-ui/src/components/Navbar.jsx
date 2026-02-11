import { Link } from 'react-router-dom';
import styles from './Navbar.module.css';

export default function Navbar() {
  return (
    <nav className={styles.navbar}>
      <Link to="/" className={styles.logo}>
        <span className={styles.logoText}>
          d<span className={styles.logoAccent}>mux</span>
        </span>
      </Link>
      <div className={styles.nav}>
        <Link to="/" className={styles.navLink}>Projects</Link>
      </div>
    </nav>
  );
}
