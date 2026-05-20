import styles from './Card.module.css';

/**
 * Card primitive — base container.
 *
 * Variants: default | linked | interactive
 * Sections: header (optional), body (children), footer (optional)
 *
 * `linked` wraps in an <a>; pass `to`/`href`. `interactive` renders a
 * focusable div with role=button; pass `onClick`.
 *
 * For most use cases just compose children directly:
 *   <Card><h2>...</h2><p>...</p></Card>
 */
export default function Card({
  variant = 'default',
  header,
  footer,
  className = '',
  children,
  ...rest
}) {
  const classes = [styles.card, styles[`v_${variant}`], className].filter(Boolean).join(' ');

  return (
    <section className={classes} {...rest}>
      {header && <header className={styles.header}>{header}</header>}
      <div className={styles.body}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </section>
  );
}

/** Compact heading element for use inside a Card's header slot. */
export function CardTitle({ children, className = '', as: As = 'h2' }) {
  return <As className={`${styles.title} ${className}`}>{children}</As>;
}
