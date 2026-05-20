import { useEffect, useState } from 'react';
import styles from './DiffViewer.module.css';

/**
 * DiffViewer — renders a unified git diff with per-line coloring. Splits the
 * raw diff text into per-file sections so each file has a sticky header.
 * No file-tree split for v1 — single scrollable view.
 *
 * Empty state: agent has no changes (or the worktree was cleaned up so we
 * can't compute the diff anymore).
 */
export default function DiffViewer({ projectName, runId, agentName }) {
  const [data, setData] = useState(null); // null = loading, { diff, ... } | { error }
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectName}/runs/${runId}/agents/${agentName}/diff`)
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

  if (error) return <div className={styles.error}>Couldn't load diff: {error}</div>;
  if (data === null) return <div className={styles.muted}>Loading diff…</div>;

  if (data.unavailable) {
    return (
      <div className={styles.empty}>
        <p>Diff unavailable for this agent.</p>
        <p className={styles.hint}>{data.reason ?? 'The agent worktree no longer exists.'}</p>
      </div>
    );
  }

  if (!data.diff || data.diff.trim() === '') {
    return (
      <div className={styles.empty}>
        <p>No changes yet.</p>
        <p className={styles.hint}>
          {data.branch && data.base
            ? <>Comparing <code>{data.branch}</code> against <code>{data.base}</code>.</>
            : 'Agent has not modified any files.'}
        </p>
      </div>
    );
  }

  const files = parseDiff(data.diff);

  return (
    <div className={styles.wrapper}>
      <header className={styles.summary}>
        <span>
          {files.length} file{files.length === 1 ? '' : 's'} changed
        </span>
        <span className={styles.summarySpacer} />
        {data.branch && data.base && (
          <span className={styles.branchInfo}>
            <code>{data.branch}</code> ← <code>{data.base}</code>
          </span>
        )}
      </header>
      {files.map((f, i) => (
        <section key={`${f.path}-${i}`} className={styles.file}>
          <header className={styles.fileHeader}>
            <code className={styles.filePath}>{f.path}</code>
            <span className={styles.fileStats}>
              {f.added > 0 && <span className={styles.added}>+{f.added}</span>}
              {f.removed > 0 && <span className={styles.removed}>−{f.removed}</span>}
            </span>
          </header>
          <pre className={styles.body}>
            {f.lines.map((line, idx) => (
              <span key={idx} className={lineClass(line)}>
                {line}
                {'\n'}
              </span>
            ))}
          </pre>
        </section>
      ))}
    </div>
  );
}

// --- diff parser ---

function parseDiff(text) {
  const lines = text.split('\n');
  const files = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (current) files.push(current);
      // diff --git a/path b/path
      const m = line.match(/^diff --git a\/(.*) b\/(.*)$/);
      current = { path: m ? m[2] : line, lines: [], added: 0, removed: 0 };
      continue;
    }
    if (!current) continue;
    // Skip the index/--- /+++ header lines but keep them in the body for context.
    current.lines.push(line);
    if (line.startsWith('+') && !line.startsWith('+++')) current.added++;
    if (line.startsWith('-') && !line.startsWith('---')) current.removed++;
  }
  if (current) files.push(current);
  return files;
}

function lineClass(line) {
  if (line.startsWith('+++') || line.startsWith('---')) return styles.headerLine;
  if (line.startsWith('@@')) return styles.hunkLine;
  if (line.startsWith('+')) return styles.addedLine;
  if (line.startsWith('-')) return styles.removedLine;
  if (line.startsWith('index ')) return styles.headerLine;
  return styles.contextLine;
}
