import { forwardRef, useId } from 'react';
import styles from './Checkbox.module.css';

/**
 * Checkbox primitive — native <input type="checkbox">, label wraps so the
 * entire label area is clickable. Pass `indeterminate` to render the
 * mixed-state checkbox (aria-checked="mixed").
 */
const Checkbox = forwardRef(function Checkbox(
  { label, checked, onChange, indeterminate = false, disabled, className = '', ...rest },
  ref,
) {
  const id = useId();
  const setRef = (el) => {
    if (el) el.indeterminate = indeterminate;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  return (
    <label className={`${styles.label} ${className}`} htmlFor={id}>
      <input
        id={id}
        ref={setRef}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-checked={indeterminate ? 'mixed' : undefined}
        className={styles.input}
        {...rest}
      />
      <span className={styles.box} aria-hidden="true" />
      <span className={styles.text}>{label}</span>
    </label>
  );
});

export default Checkbox;
