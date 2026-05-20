import { useId, useState } from 'react';
import styles from './Disclosure.module.css';

/**
 * Disclosure primitive — Section 3 / Section 5.
 *
 * Trigger is a real <button> with aria-expanded + aria-controls. Panel is
 * hidden via the `hidden` attribute when collapsed. Animation respects
 * prefers-reduced-motion (handled by the global rule in theme.css).
 */
export default function Disclosure({ title, defaultOpen = false, children, className = '' }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={`${styles.disclosure} ${className}`}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.arrow} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span>{title}</span>
      </button>
      <div id={panelId} className={styles.panel} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
