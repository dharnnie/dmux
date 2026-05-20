import { useId, useRef } from 'react';
import styles from './Tabs.module.css';

/**
 * Tabs primitive — Section 3 / Section 5.
 *
 * Renders an accessible tablist with arrow-key navigation. Active panel is
 * controlled via the `value` / `onChange` props so parents can react to tab
 * switches (e.g. re-fetching data for the active tab).
 *
 * Props:
 *   tabs:    [{ value, label, count?, disabled? }]
 *   value:   currently selected tab value
 *   onChange: (next: string) => void
 *   children: render-prop or per-tab panel content. Pass children directly;
 *             only the panel matching `value` is rendered.
 *
 * Usage:
 *   <Tabs tabs={[{value:'a',label:'A'}, {value:'b',label:'B'}]} value={v} onChange={setV}>
 *     {v === 'a' && <PanelA />}
 *     {v === 'b' && <PanelB />}
 *   </Tabs>
 */
export default function Tabs({ tabs, value, onChange, children, className = '' }) {
  const baseId = useId();
  const tabRefs = useRef({});

  const activeIndex = tabs.findIndex((t) => t.value === value);

  const focusTab = (idx) => {
    const target = tabs[idx];
    if (!target) return;
    tabRefs.current[target.value]?.focus();
    onChange(target.value);
  };

  const onKeyDown = (e) => {
    const enabledIndexes = tabs.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i !== -1);
    const here = enabledIndexes.indexOf(activeIndex);
    if (here === -1) return;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusTab(enabledIndexes[(here + 1) % enabledIndexes.length]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusTab(enabledIndexes[(here - 1 + enabledIndexes.length) % enabledIndexes.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusTab(enabledIndexes[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusTab(enabledIndexes[enabledIndexes.length - 1]);
    }
  };

  return (
    <div className={`${styles.wrapper} ${className}`}>
      <div role="tablist" className={styles.tablist} onKeyDown={onKeyDown}>
        {tabs.map((t) => {
          const tabId = `${baseId}-tab-${t.value}`;
          const panelId = `${baseId}-panel-${t.value}`;
          const selected = t.value === value;
          return (
            <button
              key={t.value}
              ref={(el) => (tabRefs.current[t.value] = el)}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              disabled={t.disabled}
              onClick={() => !t.disabled && onChange(t.value)}
              className={`${styles.tab} ${selected ? styles.tabActive : ''}`}
            >
              <span className={styles.tabLabel}>{t.label}</span>
              {typeof t.count === 'number' && (
                <span className={styles.tabCount}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-${value}`}
        aria-labelledby={`${baseId}-tab-${value}`}
        tabIndex={0}
        className={styles.panel}
      >
        {children}
      </div>
    </div>
  );
}
