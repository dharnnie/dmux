/**
 * Scope matching + numstat parsing for the post-run scope-violation check.
 *
 * Scope semantics:
 *   - Empty scope = no restriction. No violations are ever reported for an
 *     agent without a declared scope.
 *   - A scope entry ending in '/' matches any file under that directory
 *     (prefix match).
 *   - A scope entry without a trailing slash matches either the file
 *     exactly or any file under it as a directory (e.g. `src/auth` matches
 *     `src/auth/oauth.ts` and `src/auth.ts`).
 *   - Leading `./` is stripped from both scope entries and file paths.
 */

function normalize(p) {
  if (!p) return '';
  return p.replace(/^\.\//, '').replace(/^\/+/, '');
}

export function fileMatchesScope(filePath, scope) {
  if (!Array.isArray(scope) || scope.length === 0) return true; // empty = no restriction
  const f = normalize(filePath);
  for (const raw of scope) {
    const entry = normalize(raw);
    if (!entry) continue;
    if (entry.endsWith('/')) {
      if (f.startsWith(entry)) return true;
    } else {
      if (f === entry) return true;
      if (f.startsWith(entry + '/')) return true;
    }
  }
  return false;
}

/**
 * Parse `git diff --numstat` output into an array of file stats.
 *
 *   Input (one entry per line):
 *     1\t0\tsrc/auth/oauth.ts
 *     18\t2\tsrc/middleware/auth.ts
 *     -\t-\tassets/logo.png            (binary file)
 *     0\t0\told/path => new/path       (rename, no content change)
 *     12\t3\tpkg/{old => new}/file.ts  (more compact rename form)
 *
 * Numeric stats are coerced; binary `-\t-` entries become null.
 * Renames are recorded with the NEW path (we don't currently surface the
 * old path; renames into scope are not violations).
 */
export function parseNumstat(text) {
  if (!text) return [];
  const lines = text.split('\n').map((l) => l.trimEnd());
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    const match = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/);
    if (!match) continue;
    const [, addedStr, removedStr, rawPath] = match;
    const added = addedStr === '-' ? null : Number(addedStr);
    const removed = removedStr === '-' ? null : Number(removedStr);
    const path = extractRenameNewPath(rawPath);
    out.push({ path, added, removed });
  }
  return out;
}

/**
 * Extract the new path from a rename entry. Handles two formats:
 *   "old/path => new/path"           — separate paths
 *   "pkg/{old => new}/file.ts"       — brace expansion
 * Non-rename paths are returned as-is.
 */
function extractRenameNewPath(raw) {
  // Brace form first
  const brace = raw.match(/^(.*)\{(.+?) => (.+?)\}(.*)$/);
  if (brace) {
    const [, prefix, , newMid, suffix] = brace;
    return `${prefix}${newMid}${suffix}`.replace(/\/+/g, '/');
  }
  // Plain " => " form
  const arrow = raw.match(/^(.+) => (.+)$/);
  if (arrow) return arrow[2];
  return raw;
}

/**
 * Compute scope violations from a numstat text and a scope list.
 * Returns `[{ path, added, removed }]` for files outside the declared scope.
 * Empty scope short-circuits to an empty array (no restriction → no
 * violations).
 */
export function computeViolations(numstatText, scope) {
  if (!Array.isArray(scope) || scope.length === 0) return [];
  const stats = parseNumstat(numstatText);
  return stats.filter((s) => !fileMatchesScope(s.path, scope));
}
