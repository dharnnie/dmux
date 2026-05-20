import { useId, useRef, useState } from 'react';
import styles from './ListEditor.module.css';

/**
 * ListEditor — chip-style row editor for path lists, agent dependency
 * lists, and similar. Replaces the comma-separated single-line inputs
 * that Wave 1 used for scope/context/depends_on.
 *
 * Props:
 *   label         — visible group label (renders as fieldset legend)
 *   helperText    — optional helper text below
 *   items         — string[] of current values
 *   onChange      — (next: string[]) => void
 *   placeholder   — placeholder for the add-row input
 *   addLabel      — button text, e.g. "Add path" or "Add dependency"
 *   suggestions   — optional string[] for the <datalist>
 *
 * Keyboard:
 *   Enter on the input — adds the row
 *   Backspace on an empty input — removes the last row
 *
 * Each remove button has an explicit aria-label that includes the row
 * value, per Section 5.
 */
export default function ListEditor({
  label,
  helperText,
  items = [],
  onChange,
  placeholder = '',
  addLabel = 'Add',
  suggestions,
  disabled = false,
}) {
  const baseId = useId();
  const helperId = `${baseId}-help`;
  const listId = suggestions ? `${baseId}-list` : undefined;
  const inputRef = useRef(null);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (items.includes(trimmed)) {
      setDraft('');
      return;
    }
    onChange([...items, trimmed]);
    setDraft('');
    inputRef.current?.focus();
  };

  const remove = (idx) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && items.length > 0) {
      e.preventDefault();
      remove(items.length - 1);
    }
  };

  return (
    <fieldset
      className={styles.group}
      aria-describedby={helperText ? helperId : undefined}
      disabled={disabled}
    >
      {label && <legend className={styles.legend}>{label}</legend>}

      <div className={styles.chips}>
        {items.map((item, idx) => (
          <span key={`${item}-${idx}`} className={styles.chip}>
            <span className={styles.chipText}>{item}</span>
            <button
              type="button"
              className={styles.chipRemove}
              aria-label={`Remove ${item}`}
              onClick={() => remove(idx)}
              disabled={disabled}
            >
              ×
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder={items.length === 0 ? placeholder : ''}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          list={listId}
          disabled={disabled}
          aria-label={addLabel}
        />
        {suggestions && (
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}

        <button
          type="button"
          className={styles.addBtn}
          onClick={commit}
          disabled={disabled || draft.trim() === ''}
        >
          + {addLabel}
        </button>
      </div>

      {helperText && (
        <span id={helperId} className={styles.helper}>
          {helperText}
        </span>
      )}
    </fieldset>
  );
}
