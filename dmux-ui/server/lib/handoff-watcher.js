/**
 * Handoff-write watcher — Wave 4A Slice 1.
 *
 * For each project's currently-running runs, polls
 * <runDir>/handoffs/{plan,review}.md on a 1s interval. When a file
 * newly appears, emits a `plan_written` / `review_written` timeline
 * event. Idempotent — each file fires once per server lifetime.
 *
 * State is in-memory (Map<runKey, {plan, review}>); terminal runs
 * aren't watched. On server restart watchers are recreated by
 * re-scanning active runs.
 *
 * Per wave-4a.md §6.5: v1 accepts the "events from before the
 * restart are missed" gap. A hardening follow-up could rebuild the
 * watcher's seen-set from existing timeline.jsonl entries on
 * startup.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseProjectsFile } from './dmux.js';
import { appendTimelineEvent } from './timeline.js';
import { parsePlanArtifact, parseReviewArtifact } from '../../../dmux-core/src/handoffs.js';

const POLL_INTERVAL_MS = 1000;
// Map<projectPath::runId, { plan: bool, review: bool }>
const seen = new Map();
let intervalHandle = null;

function key(projectPath, runId) {
  return `${projectPath}::${runId}`;
}

function listActiveRuns(projectPath) {
  const runsDir = join(projectPath, '.dmux', 'runs');
  if (!existsSync(runsDir)) return [];
  let entries;
  try {
    entries = readdirSync(runsDir);
  } catch {
    return [];
  }
  const active = [];
  for (const id of entries) {
    const runJson = join(runsDir, id, 'run.json');
    if (!existsSync(runJson)) continue;
    let r;
    try {
      r = JSON.parse(readFileSync(runJson, 'utf-8'));
    } catch {
      continue;
    }
    // Active = has started but isn't cleaned/abandoned. Proposed runs
    // also get watched since plan-role agents could in theory write
    // handoffs (rare but cheap to support).
    if (r.cleaned_at || r.abandoned_at) continue;
    active.push(id);
  }
  return active;
}

function tickOnce() {
  let projects;
  try {
    projects = parseProjectsFile();
  } catch {
    return;
  }

  for (const project of projects) {
    let runs;
    try {
      runs = listActiveRuns(project.path);
    } catch {
      continue;
    }
    for (const runId of runs) {
      const k = key(project.path, runId);
      let state = seen.get(k);
      if (!state) {
        state = { plan: false, review: false };
        seen.set(k, state);
      }

      if (!state.plan) {
        const planPath = join(project.path, '.dmux', 'runs', runId, 'handoffs', 'plan.md');
        if (existsSync(planPath)) {
          state.plan = true;
          let taskCount = null;
          try {
            const parsed = parsePlanArtifact(readFileSync(planPath, 'utf-8'));
            taskCount = parsed.structured?.tasks?.length ?? null;
          } catch {}
          appendTimelineEvent(project.path, runId, {
            type: 'plan_written',
            summary: taskCount != null
              ? `Plan written · ${taskCount} task${taskCount === 1 ? '' : 's'}`
              : 'Plan written',
            data: taskCount != null ? { tasks: taskCount } : {},
          });
        }
      }

      if (!state.review) {
        const reviewPath = join(project.path, '.dmux', 'runs', runId, 'handoffs', 'review.md');
        if (existsSync(reviewPath)) {
          state.review = true;
          let verdict = null;
          let findingCount = null;
          try {
            const parsed = parseReviewArtifact(readFileSync(reviewPath, 'utf-8'));
            verdict = parsed.structured?.verdict ?? null;
            findingCount = parsed.structured?.findings?.length ?? null;
          } catch {}
          let summary = 'Review written';
          if (verdict) summary += ` · ${verdict.replace('_', ' ')}`;
          if (findingCount != null) summary += ` · ${findingCount} finding${findingCount === 1 ? '' : 's'}`;
          appendTimelineEvent(project.path, runId, {
            type: 'review_written',
            summary,
            data: { verdict, findingCount },
          });
        }
      }
    }
  }
}

export function startHandoffWatcher() {
  if (intervalHandle) return;
  // Seed the seen-set from existing files so we don't re-fire events on
  // server restart for runs that already had handoffs.
  try {
    const projects = parseProjectsFile();
    for (const project of projects) {
      for (const runId of listActiveRuns(project.path)) {
        const k = key(project.path, runId);
        const planExists = existsSync(join(project.path, '.dmux', 'runs', runId, 'handoffs', 'plan.md'));
        const reviewExists = existsSync(join(project.path, '.dmux', 'runs', runId, 'handoffs', 'review.md'));
        seen.set(k, { plan: planExists, review: reviewExists });
      }
    }
  } catch {
    // Best-effort seeding; if it fails we'll just emit duplicate events
    // for pre-existing handoffs on first tick, which is acceptable.
  }
  intervalHandle = setInterval(tickOnce, POLL_INTERVAL_MS);
  // Don't keep the process alive on this interval alone.
  intervalHandle.unref?.();
}

export function stopHandoffWatcher() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
