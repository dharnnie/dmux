/**
 * Wave 3E handoff artifact parsing.
 *
 * Two artifact types live at `<runDir>/handoffs/{plan,review}.md`:
 *   - plan.md   — written by plan-role agents (Slice 1)
 *   - review.md — written by review-role agents (Slice 2)
 *
 * Format for both: markdown body for the human + a fenced ```json appendix
 * with structured data. The markdown body is preserved verbatim for UI
 * rendering. The JSON appendix is canonical when present.
 *
 * Permissive parsing — a missing or malformed JSON appendix yields
 * { markdown, structured: null, parseError } rather than throwing. The
 * markdown body is still useful (the UI renders it) even when the
 * appendix is broken. We don't want to wipe out an agent's work because
 * of a stray backtick.
 */

/**
 * Parse a plan artifact's markdown text. Returns:
 *   { markdown, structured: { summary, tasks, acceptanceCriteria } | null,
 *     parseError?: string }
 *
 * Structured plan shape:
 *   summary             — string
 *   tasks               — [{ id, description, files[] }]
 *   acceptanceCriteria  — [string]
 *
 * Unknown extra keys are ignored. Task `id` defaults to a 1-based string
 * when missing. `files` is always present (possibly empty).
 */
export function parsePlanArtifact(markdown) {
  if (typeof markdown !== 'string') {
    return { markdown: '', structured: null, parseError: 'input is not a string' };
  }
  const jsonText = extractTrailingJsonBlock(markdown);
  if (jsonText == null) {
    return { markdown, structured: null, parseError: 'no fenced ```json block found' };
  }
  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    return { markdown, structured: null, parseError: `JSON parse error: ${e.message}` };
  }
  const structured = normalizePlanShape(raw);
  if (structured == null) {
    return { markdown, structured: null, parseError: 'JSON does not match plan schema' };
  }
  return { markdown, structured };
}

/**
 * Parse a review artifact's markdown text. Returns:
 *   { markdown, structured: { verdict, summary, findings } | null,
 *     parseError?: string }
 *
 * Structured review shape:
 *   verdict   — 'approve' | 'request_changes' | 'block'
 *               (anything else normalizes to 'approve' rather than failing
 *               — the reviewer's words still surface in markdown)
 *   summary   — string
 *   findings  — [{ severity, file, line?, comment }]
 *               severity in {low, medium, high, critical} (default 'medium'
 *               when unknown); file required; line optional integer;
 *               comment required
 */
export function parseReviewArtifact(markdown) {
  if (typeof markdown !== 'string') {
    return { markdown: '', structured: null, parseError: 'input is not a string' };
  }
  const jsonText = extractTrailingJsonBlock(markdown);
  if (jsonText == null) {
    return { markdown, structured: null, parseError: 'no fenced ```json block found' };
  }
  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    return { markdown, structured: null, parseError: `JSON parse error: ${e.message}` };
  }
  const structured = normalizeReviewShape(raw);
  if (structured == null) {
    return { markdown, structured: null, parseError: 'JSON does not match review schema' };
  }
  return { markdown, structured };
}

const VALID_VERDICTS = new Set(['approve', 'request_changes', 'block']);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function normalizeReviewShape(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  // Verdict: normalize unknown values to 'approve' so a typo doesn't wipe
  // out the review.
  const rawVerdict = typeof obj.verdict === 'string' ? obj.verdict.trim().toLowerCase() : '';
  const verdict = VALID_VERDICTS.has(rawVerdict) ? rawVerdict : 'approve';

  // Summary is optional — reviewers might leave it empty and just list
  // findings. Don't fail the structured view on missing summary.
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';

  const findings = [];
  if (Array.isArray(obj.findings)) {
    for (const f of obj.findings) {
      if (!f || typeof f !== 'object') continue;
      if (typeof f.comment !== 'string' || f.comment.trim() === '') continue;
      if (typeof f.file !== 'string' || f.file.trim() === '') continue;
      const sev = typeof f.severity === 'string' ? f.severity.trim().toLowerCase() : '';
      findings.push({
        severity: VALID_SEVERITIES.has(sev) ? sev : 'medium',
        file: f.file.trim(),
        line: Number.isInteger(f.line) && f.line > 0 ? f.line : null,
        comment: f.comment.trim(),
      });
    }
  }

  // Don't reject empty-findings reviews — an "approve" verdict legitimately
  // has zero findings. Only reject if NOTHING was parseable (verdict normalized
  // AND no summary AND no findings — that's an empty object, not a review).
  if (rawVerdict === '' && summary === '' && findings.length === 0) return null;

  return { verdict, summary, findings };
}

function normalizePlanShape(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (typeof obj.summary !== 'string' || obj.summary.trim() === '') return null;
  if (!Array.isArray(obj.tasks)) return null;

  const tasks = [];
  for (const t of obj.tasks) {
    if (!t || typeof t !== 'object') continue;
    if (typeof t.description !== 'string' || t.description.trim() === '') continue;
    const files = Array.isArray(t.files)
      ? t.files.filter((f) => typeof f === 'string' && f.length > 0)
      : [];
    tasks.push({
      id: typeof t.id === 'string' && t.id.length > 0 ? t.id : String(tasks.length + 1),
      description: t.description,
      files,
    });
  }
  if (tasks.length === 0) return null;

  const acceptanceCriteria = Array.isArray(obj.acceptanceCriteria)
    ? obj.acceptanceCriteria.filter((c) => typeof c === 'string' && c.trim().length > 0)
    : [];

  return { summary: obj.summary.trim(), tasks, acceptanceCriteria };
}

/**
 * Extract the last fenced ```json block from a markdown string. We pick
 * the LAST block (not the first) because the documented format puts the
 * structured appendix at the end; agents may include illustrative ```json
 * snippets earlier in the markdown body.
 *
 * Returns the inner text or null if no block is found.
 */
function extractTrailingJsonBlock(markdown) {
  const re = /```json\s*\n([\s\S]*?)\n```/g;
  let last = null;
  let m;
  while ((m = re.exec(markdown)) !== null) last = m[1];
  return last;
}
