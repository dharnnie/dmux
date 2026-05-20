import { forwardRef, useId } from 'react';
import styles from './Field.module.css';

/**
 * Internal shell shared by Input / Textarea / Select. Owns label, helper
 * text, error text, and the aria-describedby wiring per Section 5.
 *
 * Render function receives ({ id, describedBy, invalid }) so the control
 * itself can be a native <input>, <textarea>, or <select> as needed.
 */
function Field({ label, helperText, error, required, children, className = '' }) {
  const id = useId();
  const helperId = `${id}-help`;
  const errorId = `${id}-err`;
  const describedBy = error ? errorId : helperText ? helperId : undefined;

  return (
    <div className={`${styles.field} ${className}`}>
      {label && (
        <label className={styles.label} htmlFor={id}>
          {label}
          {required && (
            <span className={styles.required} aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children({ id, describedBy, invalid: Boolean(error), required })}
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : helperText ? (
        <span id={helperId} className={styles.helper}>
          {helperText}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Single-line text input. Placeholders are example values only — never
 * use them in place of `label` (see Section 5).
 */
export const Input = forwardRef(function Input(
  { label, helperText, error, required, className, ...rest },
  ref,
) {
  return (
    <Field
      label={label}
      helperText={helperText}
      error={error}
      required={required}
      className={className}
    >
      {({ id, describedBy, invalid }) => (
        <input
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          className={styles.control}
          {...rest}
        />
      )}
    </Field>
  );
});

/**
 * Multi-line text area. Defaults to 4 rows; pass `rows` to override.
 */
export const Textarea = forwardRef(function Textarea(
  { label, helperText, error, required, rows = 4, className, ...rest },
  ref,
) {
  return (
    <Field
      label={label}
      helperText={helperText}
      error={error}
      required={required}
      className={className}
    >
      {({ id, describedBy, invalid }) => (
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          className={`${styles.control} ${styles.textarea}`}
          {...rest}
        />
      )}
    </Field>
  );
});

/**
 * Native <select> with a custom dropdown chevron. Children are <option>
 * elements as in standard HTML.
 */
export const Select = forwardRef(function Select(
  { label, helperText, error, required, children, className, ...rest },
  ref,
) {
  return (
    <Field
      label={label}
      helperText={helperText}
      error={error}
      required={required}
      className={className}
    >
      {({ id, describedBy, invalid }) => (
        <select
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          className={`${styles.control} ${styles.select}`}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  );
});
