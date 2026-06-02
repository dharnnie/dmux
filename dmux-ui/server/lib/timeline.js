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
import { listRuns, readRun } from '../../../dmux-core/src/runs.js';

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

// ---------------------------------------------------------------------------
// God-view aggregator — Wave 4A Slice 2
// ---------------------------------------------------------------------------

const RECENTLY_COMPLETED_LIMIT = 5;

/**
 * Cross-project activity summary for the /activity god-view.
 *
 * Walks every project in the registry, picks running runs, and for each
 * agent in each running run returns:
 *   - project / runId / agent name / branch / role
 *   - derived agent status (running / waiting / completed / failed / pending)
 *   - the most recent timeline event scoped to that agent (or run-scoped
 *     when no agent-scoped event has fired yet)
 *
 * When NO runs are active across all projects, falls back to the
 * `recentlyCompleted` field — the 5 most recently terminal runs with their
 * last timeline event. Keeps the page useful when nothing's in flight.
 *
 * Cheap at the user's scale (32 projects × ~1 active run × ~50 events).
 * Errors from individual projects are caught + skipped — a broken project
 * directory should not break the whole god-view.
 */
export function getActivitySummary(projects) {
  const activeAgents = [];
  const allRuns = []; // [{ project, run }] kept for the recently-completed fallback

  for (const project of projects) {
    let runs;
    try {
      runs = listRuns(project.path);
    } catch {
      continue;
    }
    for (const summary of runs) {
      let run;
      try {
        run = readRun(project.path, summary.id);
      } catch {
        continue;
      }
      if (!run) continue;
      allRuns.push({ project, run });

      if (run.status !== 'running') continue;

      const { events } = readRunTimeline(project.path, run.id);
      for (const agent of run.agents) {
        activeAgents.push({
          project: project.name,
          projectPath: project.path,
          runId: run.id,
          agentName: agent.name,
          agentRole: agent.role ?? null,
          branch: agent.branch ?? null,
          agentStatus: agent.status,
          lastEvent: pickLastEventForAgent(events, agent.name),
        });
      }
    }
  }

  const summary = {
    activeRunCount: countActiveRuns(activeAgents),
    activeAgents,
    lastEventTs: latestTs(activeAgents),
    recentlyCompleted: [],
  };

  if (activeAgents.length === 0) {
    summary.recentlyCompleted = pickRecentlyCompleted(allRuns);
  }

  return summary;
}

function pickLastEventForAgent(events, agentName) {
  if (!Array.isArray(events) || events.length === 0) return null;
  // events come from readTimeline in file order (oldest first). Walk back
  // through the tail looking for the most-recent event scoped to this
  // agent; fall back to the most-recent run-scoped event if none.
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].agent === agentName) return events[i];
  }
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].agent === null) return events[i];
  }
  return events[events.length - 1];
}

function countActiveRuns(activeAgents) {
  const set = new Set();
  for (const a of activeAgents) set.add(`${a.project}/${a.runId}`);
  return set.size;
}

function latestTs(activeAgents) {
  let latest = '';
  for (const a of activeAgents) {
    const ts = a.lastEvent?.ts ?? '';
    if (ts > latest) latest = ts;
  }
  return latest || null;
}

function pickRecentlyCompleted(allRuns) {
  // Filter to terminal states (completed / failed / cleaned / abandoned),
  // sort newest first by completed_at, take top 5, attach last event.
  const terminal = allRuns.filter(({ run }) => {
    return run.status === 'completed' || run.status === 'failed' ||
           run.status === 'cleaned' || run.status === 'abandoned';
  });
  terminal.sort((a, b) => {
    const aT = a.run.completed_at ?? a.run.abandoned_at ?? a.run.cleaned_at ?? '';
    const bT = b.run.completed_at ?? b.run.abandoned_at ?? b.run.cleaned_at ?? '';
    return bT.localeCompare(aT);
  });
  return terminal.slice(0, RECENTLY_COMPLETED_LIMIT).map(({ project, run }) => {
    const { events } = readRunTimeline(project.path, run.id);
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    return {
      project: project.name,
      runId: run.id,
      status: run.status,
      completedAt: run.completed_at ?? run.abandoned_at ?? run.cleaned_at ?? null,
      agentCount: run.config?.agents?.length ?? 0,
      lastEvent,
    };
  });
}
