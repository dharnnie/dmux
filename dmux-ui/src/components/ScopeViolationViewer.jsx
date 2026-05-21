import { useEffect, useState } from 'react';
import styles from './ScopeViolationViewer.module.css';

/**
 * Section 4.8 / 3 — Renders files an agent modified outside its declared
 * scope. List form with +N/-M per file. "Add to scope" quick action is
 * deferred (see Section 4.8 notes); this viewer just surfaces the data
 * and lets the user copy the path manually for now.
 *
 * Empty/unavailable states:
 *   - reason === 'no_scope' — scope was never declared, so there's
 *     nothing to compare against. Surface a gentle hint.
 *   - any other unavailable reason — surface verbatim (worktree gone,
 *     plan/review role, git failure).
 *   - violations array is empty — agent stayed in scope ✓
 */
export default function ScopeViolationViewer({ projectName, runId, agentName, onClickViewDiff }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectName}/runs/${runId}/agents/${agentName}/violations`)
      .then(async (r) => {
        if (cancelled) return;
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(body.error || `HTTP ${r.status}`);
          return;
        }
        setData(body);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [projectName, runId, agentName]);

  if (error) return <div className={styles.error}>Couldn't load violations: {error}</div>;
  if (data === null) return <div className={styles.muted}>Loading…</div>;

  if (data.unavailable) {
    if (data.reason === 'no_scope') {
      return (
        <div className={styles.empty}>
          <p>No scope declared for this agent.</p>
          <p className={styles.hint}>
            Scope-violation detection only runs when the agent has a <code>scope:</code> list in
            <code> .dmux-agents.yml</code>. Declare which files the agent is allowed to modify and
            re-run to get this surface.
          </p>
        </div>
      );
    }
    return (
      <div className={styles.empty}>
        <p>Violations check unavailable.</p>
        <p className={styles.hint}>{data.reason}</p>
      </div>
    );
  }

  if (!data.violations || data.violations.length === 0) {
    return (
      <div className={styles.clean}>
        <span className={styles.cleanGlyph} aria-hidden="true">✓</span>
        <div>
          <p className={styles.cleanHeadline}>No violations.</p>
          <p className={styles.cleanHint}>
            Every changed file is within the declared scope: {data.scope.map((s) => (
              <code key={s} className={styles.scopeChip}>{s}</code>
            ))}
          </p>
        </div>
      </div>
    );
  }

  const copy = (path) => {
    navigator.clipboard?.writeText(path);
    setCopied(path);
    setTimeout(() => setCopied(null), 1200);
  };

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div>
          <strong>{data.violations.length}</strong> file{data.violations.length === 1 ? '' : 's'} modified outside scope.
        </div>
        <div className={styles.scopeMeta}>
          Declared scope: {data.scope.map((s) => (
            <code key={s} className={styles.scopeChip}>{s}</code>
          ))}
        </div>
      </header>

      <ul className={styles.list}>
        {data.violations.map((v) => (
          <li key={v.path} className={styles.row}>
            <code className={styles.path}>{v.path}</code>
            <span className={styles.stats}>
              {v.added !== null && v.added > 0 && <span className={styles.added}>+{v.added}</span>}
              {v.removed !== null && v.removed > 0 && <span className={styles.removed}>−{v.removed}</span>}
              {(v.added === null || v.removed === null) && <span className={styles.binary}>binary</span>}
            </span>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.copyBtn}
                onClick={() => copy(v.path)}
                aria-label={`Copy path ${v.path}`}
              >
                {copied === v.path ? 'Copied' : 'Copy path'}
              </button>
              {onClickViewDiff && (
                <button
                  type="button"
                  className={styles.viewBtn}
                  onClick={() => onClickViewDiff(v.path)}
                >
                  View diff →
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <footer className={styles.footer}>
        <p>
          To allow the agent to touch a path in future runs, add it to its <code>scope:</code> list in
          <code> .dmux-agents.yml</code>. Scope updates from the UI ship in a follow-up.
        </p>
      </footer>
    </div>
  );
}
