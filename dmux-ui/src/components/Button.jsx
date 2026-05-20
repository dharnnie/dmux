import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import styles from './Button.module.css';

/**
 * Button primitive — Section 3 / Section 5 conventions.
 *
 * Variants: primary | secondary | danger | ghost
 * Sizes:    md (default) | sm
 *
 * Loading state: replaces label with a spinner, preserves width, sets aria-busy.
 * Icon-only buttons MUST provide aria-label.
 * If `to` is set, renders as a React Router <Link> styled as a button.
 */
const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    type,
    to,
    href,
    className = '',
    children,
    'aria-label': ariaLabel,
    ...rest
  },
  ref,
) {
  const classes = [
    styles.btn,
    styles[`v_${variant}`],
    styles[`s_${size}`],
    loading ? styles.loading : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = loading ? (
    <>
      <span className={styles.spinner} aria-hidden="true" />
      <span className={styles.label}>{children}</span>
    </>
  ) : (
    children
  );

  if (to) {
    return (
      <Link
        ref={ref}
        to={to}
        className={classes}
        aria-disabled={disabled || undefined}
        aria-label={ariaLabel}
        {...rest}
      >
        {content}
      </Link>
    );
  }

  if (href) {
    return (
      <a
        ref={ref}
        href={href}
        className={classes}
        aria-disabled={disabled || undefined}
        aria-label={ariaLabel}
        {...rest}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      {...rest}
    >
      {content}
    </button>
  );
});

export default Button;
