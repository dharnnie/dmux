import { useId } from 'react';
import styles from './RadioGroup.module.css';

/**
 * Segmented radio group. Renders as a <fieldset> with <legend> for the
 * label (proper a11y semantics). Each option becomes a native radio with
 * its label wrapping for click affordance. Visually it's a segmented
 * control — one connected bar with the active segment highlighted.
 *
 * options: [{ value, label, description? }]
 */
export default function RadioGroup({
  label,
  helperText,
  value,
  onChange,
  options,
  name,
  className = '',
}) {
  const baseId = useId();
  const groupName = name ?? baseId;
  const helperId = `${baseId}-help`;

  return (
    <fieldset className={`${styles.group} ${className}`} aria-describedby={helperText ? helperId : undefined}>
      {label && <legend className={styles.legend}>{label}</legend>}
      <div className={styles.segments} role="radiogroup">
        {options.map((opt) => {
          const inputId = `${baseId}-${opt.value}`;
          const checked = opt.value === value;
          return (
            <label
              key={opt.value}
              htmlFor={inputId}
              className={`${styles.segment} ${checked ? styles.segmentActive : ''}`}
            >
              <input
                id={inputId}
                type="radio"
                name={groupName}
                value={opt.value}
                checked={checked}
                onChange={(e) => onChange(e.target.value)}
                className={styles.input}
              />
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>
      {helperText && (
        <span id={helperId} className={styles.helper}>
          {helperText}
        </span>
      )}
    </fieldset>
  );
}
