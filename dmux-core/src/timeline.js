/**
 * Run-timeline event parsing — Wave 4A Slice 1.
 *
 * The timeline lives at <runDir>/timeline.jsonl as append-only JSON Lines.
 * Each line is one event:
 *
 *   { "ts": "ISO timestamp", "type": "agent_started", "agent": "planner",
 *     "summary": "Agent planner started", "data": {} }
 *
 * Permissive parsing — malformed lines are counted + dropped, never fatal.
 * The markdown body equivalent: even if half the file is corrupt, the
 * valid events still render.
 */

/**
 * The set of event types dmux itself emits in v1. Informational — the
 * parser doesn't enforce it. Agents may emit unknown types and the UI
 * falls back to a generic chip.
 */
export const TIMELINE_EVENT_TYPES = Object.freeze([
  'run_started',
  'agent_started',
  'plan_written',
  'review_written',
  'agent_succeeded',
  'agent_failed',
  'agent_blocked',
  'scope_violation',
  'proposal_ready',
  'run_completed',
]);

/**
 * Parse one JSONL line into an event. Returns { event } or { error }.
 * Required fields: ts (string), type (string), summary (string).
 * Optional: agent (string|null), data (object).
 */
export function parseTimelineEvent(line) {
  if (typeof line !== 'string') return { error: 'line is not a string' };
  const trimmed = line.trim();
  if (trimmed === '') return { error: 'empty line' };

  let raw;
  try {
    raw = JSON.parse(trimmed);
  } catch (e) {
    return { error: `JSON parse error: ${e.message}` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'event must be a JSON object' };
  }
  if (typeof raw.ts !== 'string' || raw.ts.trim() === '') {
    return { error: "missing or empty 'ts'" };
  }
  if (typeof raw.type !== 'string' || raw.type.trim() === '') {
    return { error: "missing or empty 'type'" };
  }
  if (typeof raw.summary !== 'string') {
    return { error: "missing 'summary'" };
  }

  return {
    event: {
      ts: raw.ts,
      type: raw.type,
      agent: typeof raw.agent === 'string' && raw.agent.length > 0 ? raw.agent : null,
      summary: raw.summary,
      data: raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : {},
    },
  };
}

/**
 * Parse a full JSONL document. Returns:
 *   { events: [...], malformedCount: N }
 *
 * Events are returned in file order (chronological by convention — dmux
 * appends in real time). The caller doesn't need to re-sort.
 */
export function readTimeline(text) {
  if (typeof text !== 'string' || text === '') {
    return { events: [], malformedCount: 0 };
  }
  const events = [];
  let malformedCount = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const result = parseTimelineEvent(line);
    if (result.event) events.push(result.event);
    else malformedCount += 1;
  }
  return { events, malformedCount };
}
