/**
 * Run-timeline server helpers — Wave 4A Slice 1.
 *
 * Reads + appends events at <runDir>/timeline.jsonl. Used by:
 *   - GET /api/projects/:name/runs/:runId/timeline — UI reads the parsed
 *     event list.
 *   - Server-side event emitters (proposal_ready notifications, scope-
 *     violation transitions, the handoff watcher).
 *
 * Bash-side events go through `dmux _log` and don't use this module —
 * they append directly to the same file. The format is JSON Lines so the
 * two paths interleave cleanly without coordination.
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { readTimeline } from '../../../dmux-core/src/timeline.js';

function timelinePath(projectPath, runId) {
  return join(projectPath, '.dmux', 'runs', runId, 'timeline.jsonl');
}

/**
 * Read + parse the timeline for a run. Returns
 * { events, malformedCount } via dmux-core, or { events: [], malformedCount: 0 }
 * when the file doesn't exist.
 */
export function readRunTimeline(projectPath, runId) {
  const path = timelinePath(projectPath, runId);
  if (!existsSync(path)) return { events: [], malformedCount: 0 };
  let text;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return { events: [], malformedCount: 0 };
  }
  return readTimeline(text);
}

/**
 * Append a single event. Fire-and-forget — errors are swallowed (writing
 * a timeline event should never break the calling path). Writes via
 * appendFileSync; one JSONL line stays well under PIPE_BUF so concurrent
 * appenders from multiple agents don't tear.
 *
 * `event` should be { type, summary, agent?, data? }; ts is added here.
 */
export function appendTimelineEvent(projectPath, runId, event) {
  try {
    if (!event || typeof event.type !== 'string' || typeof event.summary !== 'string') return;
    const dir = join(projectPath, '.dmux', 'runs', runId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      type: event.type,
      agent: typeof event.agent === 'string' && event.agent.length > 0 ? event.agent : null,
      summary: event.summary,
      data: event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : {},
    }) + '\n';
    appendFileSync(timelinePath(projectPath, runId), line);
  } catch {
    // Swallow — timeline writes must never break the calling flow.
  }
}
