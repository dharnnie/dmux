import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const RUNS_DIR = '.dmux/runs';

/**
 * A Run is one execution of one or more agents in a project. The on-disk
 * shape is `.dmux/runs/{id}/run.json` plus a `signals/` directory where
 * per-agent `.done` files land as agents complete.
 *
 * run.json schema (v2 — Wave 2B):
 *   {
 *     id:            string,                 // sortable + filesystem-safe
 *     project:       string,                 // project name from the registry
 *     proposed_at:   string | null,          // ISO — set on createProposal
 *     started_at:    string | null,          // ISO — set on createRun OR approveProposal
 *     completed_at:  string | null,          // set when all agents finished
 *     cleaned_at:    string | null,          // set when worktrees removed
 *     abandoned_at:  string | null,          // set when proposal discarded
 *     trigger:       { type, ...meta },      // 'manual' | 'skill' | 'nl'
 *     config:        { yaml: string, agents: AgentSummary[] }
 *   }
 *
 * Status is derived (not stored) from the timestamps + per-agent signals:
 *   abandoned_at set                 → 'abandoned'
 *   cleaned_at set                   → 'cleaned'
 *   proposed_at && !started_at       → 'proposed'
 *   agents derive running/completed/failed from signal files (as before)
 *
 * The per-agent status is also derived at read time from the signal files,
 * which means there's no concurrent-writer problem and no possibility of
 * stale state.
 */

/** Generate a fresh run id: YYYY-MM-DDTHHMMSS-{6 hex}. Sortable. */
export function newRunId(now = new Date()) {
  const iso = now.toISOString();
  // 2026-05-20T14:32:11.123Z → 2026-05-20T143211
  const ts = iso.slice(0, 19).replace(/:/g, '');
  const suffix = randomBytes(3).toString('hex');
  return `${ts}-${suffix}`;
}

/**
 * Create a new run directory + run.json. Returns { id, dir, signalsDir }.
 * `configYaml` is stored verbatim (the frozen snapshot). `agentsSummary`
 * is the lightweight per-agent shape needed to render status without
 * re-parsing the YAML.
 */
export function createRun(projectPath, {
  trigger = { type: 'manual' },
  configYaml,
  agentsSummary,
  now = new Date(),
} = {}) {
  if (typeof projectPath !== 'string' || projectPath.length === 0) {
    throw new Error('createRun: projectPath is required');
  }
  if (typeof configYaml !== 'string') {
    throw new Error('createRun: configYaml is required (string)');
  }
  if (!Array.isArray(agentsSummary)) {
    throw new Error('createRun: agentsSummary is required (array)');
  }

  const id = newRunId(now);
  const dir = join(projectPath, RUNS_DIR, id);
  const signalsDir = join(dir, 'signals');
  const plansDir = join(dir, 'plans');
  mkdirSync(signalsDir, { recursive: true });
  // Plan-role agents write to plansDir/{name}.md; downstream agents read
  // from the same path. Created up front so agents don't need to mkdir.
  mkdirSync(plansDir, { recursive: true });

  const run = {
    id,
    project: projectPath.split('/').pop() ?? '',
    proposed_at: null,
    started_at: now.toISOString(),
    completed_at: null,
    cleaned_at: null,
    abandoned_at: null,
    trigger,
    config: {
      yaml: configYaml,
      agents: agentsSummary,
    },
  };

  writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
  return { id, dir, signalsDir, plansDir };
}

/**
 * Create a Run record in the `proposed` state (Wave 2B). Same on-disk shape
 * as a regular run, but `proposed_at` is set and `started_at` is null —
 * status derivation reports 'proposed' until approveProposal flips it.
 *
 * Trigger is typically `{ type: 'nl', prompt: '...' }` (the NL planner)
 * but the function is provider-agnostic — anything that wants to stage a
 * run for review uses this.
 */
export function createProposal(projectPath, {
  trigger = { type: 'nl' },
  configYaml,
  agentsSummary,
  now = new Date(),
} = {}) {
  if (typeof projectPath !== 'string' || projectPath.length === 0) {
    throw new Error('createProposal: projectPath is required');
  }
  if (typeof configYaml !== 'string') {
    throw new Error('createProposal: configYaml is required (string)');
  }
  if (!Array.isArray(agentsSummary)) {
    throw new Error('createProposal: agentsSummary is required (array)');
  }

  const id = newRunId(now);
  const dir = join(projectPath, RUNS_DIR, id);
  const signalsDir = join(dir, 'signals');
  const plansDir = join(dir, 'plans');
  mkdirSync(signalsDir, { recursive: true });
  mkdirSync(plansDir, { recursive: true });

  const run = {
    id,
    project: projectPath.split('/').pop() ?? '',
    proposed_at: now.toISOString(),
    started_at: null,
    completed_at: null,
    cleaned_at: null,
    abandoned_at: null,
    trigger,
    config: {
      yaml: configYaml,
      agents: agentsSummary,
    },
  };

  writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
  return { id, dir, signalsDir, plansDir };
}

/**
 * Approve a proposal: write the frozen YAML as the project's live
 * `.dmux-agents.yml` and set `started_at` on the run record. After this,
 * the run is in the same state as one created by `createRun` — bash can
 * adopt it via DMUX_ADOPT_RUN_ID and spawn agents against it.
 *
 * Idempotent: calling on an already-approved proposal is a no-op that
 * returns { alreadyApproved: true }. Calling on an abandoned proposal
 * throws — abandoning is terminal.
 */
export function approveProposal(projectPath, runId, now = new Date()) {
  const run = readRunJson(projectPath, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.abandoned_at) {
    throw new Error(`Cannot approve abandoned proposal: ${runId}`);
  }
  if (run.started_at) {
    return { id: runId, ok: true, alreadyApproved: true };
  }
  if (!run.proposed_at) {
    throw new Error(`Run ${runId} is not a proposal (no proposed_at timestamp)`);
  }
  // Write the frozen YAML as the live config the bash side will read.
  writeFileSync(join(projectPath, '.dmux-agents.yml'), run.config.yaml);
  run.started_at = now.toISOString();
  writeFileSync(
    join(projectPath, RUNS_DIR, runId, 'run.json'),
    JSON.stringify(run, null, 2),
  );
  return { id: runId, ok: true };
}

/**
 * Discard a proposal: set `abandoned_at` on the record. Worktrees were
 * never created so nothing else to clean.
 *
 * Idempotent. Throws if called on a started run (use cleanup/stop instead).
 */
export function discardProposal(projectPath, runId, now = new Date()) {
  const run = readRunJson(projectPath, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.started_at) {
    throw new Error(`Cannot discard a started run: ${runId} (use stop or cleanup)`);
  }
  if (run.abandoned_at) {
    return { id: runId, ok: true, alreadyDiscarded: true };
  }
  run.abandoned_at = now.toISOString();
  writeFileSync(
    join(projectPath, RUNS_DIR, runId, 'run.json'),
    JSON.stringify(run, null, 2),
  );
  return { id: runId, ok: true };
}

/** Read run.json by id. Returns null if not found. */
function readRunJson(projectPath, runId) {
  const path = join(projectPath, RUNS_DIR, runId, 'run.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Read a run with derived per-agent status. Agent status is computed from
 * signal files at read time (no concurrent-write race with run.json).
 */
export function readRun(projectPath, runId) {
  const run = readRunJson(projectPath, runId);
  if (!run) return null;

  // For proposed/abandoned runs there are no signal files to read; agents
  // are uniformly pending (proposed) or abandoned (discarded).
  const isProposed = Boolean(run.proposed_at) && !run.started_at && !run.abandoned_at;
  const isAbandoned = Boolean(run.abandoned_at);

  const signalsDir = join(projectPath, RUNS_DIR, runId, 'signals');
  const agents = run.config.agents.map((a) => {
    if (isAbandoned) {
      return { ...a, status: 'abandoned', exit_code: null, completed_at: null };
    }
    if (isProposed) {
      return { ...a, status: 'pending', exit_code: null, completed_at: null };
    }

    const signalPath = join(signalsDir, `${a.name}.done`);
    let agentStatus = 'pending';
    let exitCode = null;
    let completedAt = null;

    if (existsSync(signalPath)) {
      try {
        const raw = readFileSync(signalPath, 'utf-8').trim();
        exitCode = Number.isFinite(Number(raw)) ? Number(raw) : null;
        agentStatus = exitCode === 0 ? 'completed' : 'failed';
        completedAt = statSync(signalPath).mtime.toISOString();
      } catch {
        agentStatus = 'unknown';
      }
    } else if (run.cleaned_at) {
      // The run was cleaned up before this agent produced a signal — treat
      // as abandoned rather than perpetually pending.
      agentStatus = 'abandoned';
    } else {
      // No signal yet — determine running vs waiting from depends_on.
      const upstreamDone = (a.depends_on ?? []).every((dep) => {
        return existsSync(join(signalsDir, `${dep}.done`));
      });
      agentStatus = upstreamDone ? 'running' : 'waiting';
    }

    return { ...a, status: agentStatus, exit_code: exitCode, completed_at: completedAt };
  });

  return { ...run, status: deriveRunStatus(run, agents), agents };
}

function deriveRunStatus(run, agents) {
  if (run.abandoned_at) return 'abandoned';
  if (run.cleaned_at) return 'cleaned';
  if (run.proposed_at && !run.started_at) return 'proposed';
  if (agents.length === 0) return 'pending';
  if (agents.every((a) => a.status === 'completed')) return 'completed';
  if (agents.some((a) => a.status === 'failed')) return 'failed';
  if (agents.some((a) => a.status === 'running' || a.status === 'waiting' || a.status === 'pending')) return 'running';
  return 'completed';
}

/**
 * List run summaries for a project, newest first. Each summary is the same
 * shape as readRun but with a lighter payload (no frozen YAML body, just
 * the metadata + derived statuses) — appropriate for list views.
 */
export function listRuns(projectPath) {
  const baseDir = join(projectPath, RUNS_DIR);
  if (!existsSync(baseDir)) return [];

  const ids = readdirSync(baseDir).filter((entry) => {
    return existsSync(join(baseDir, entry, 'run.json'));
  });

  // Newest first (run ids are timestamp-sortable).
  ids.sort().reverse();

  return ids
    .map((id) => readRun(projectPath, id))
    .filter(Boolean)
    .map((r) => ({
      id: r.id,
      project: r.project,
      proposed_at: r.proposed_at ?? null,
      started_at: r.started_at,
      completed_at: r.completed_at,
      cleaned_at: r.cleaned_at,
      abandoned_at: r.abandoned_at ?? null,
      trigger: r.trigger,
      status: r.status,
      agent_count: r.config.agents.length,
      // Compact per-agent status for the RunCard mini-DAG display.
      agents: r.agents.map((a) => ({ name: a.name, role: a.role, status: a.status })),
    }));
}

/**
 * Cross-project run listing for the Dashboard. Accepts an array of
 * { name, path } entries (from the projects registry) and merges run
 * summaries from each, newest-first overall.
 */
export function listAllRuns(projects) {
  const merged = [];
  for (const p of projects) {
    try {
      const runs = listRuns(p.path);
      for (const r of runs) {
        merged.push({ ...r, project: p.name });
      }
    } catch {
      // Skip projects we can't read. The Dashboard should not blow up on
      // a single broken project directory.
    }
  }
  merged.sort((a, b) => {
    // Sort by the timestamp that represents the run's "begin moment" —
    // started_at for normal runs, proposed_at for proposals (which have
    // no started_at). Same ISO string ordering applies.
    const aT = a.started_at ?? a.proposed_at ?? '';
    const bT = b.started_at ?? b.proposed_at ?? '';
    return bT.localeCompare(aT);
  });
  return merged;
}

/**
 * Mark a run as cleaned (worktrees removed but record retained). Idempotent.
 * `completed_at` is also set if it wasn't already — cleaning implies the
 * run is no longer in flight.
 */
export function markRunCleaned(projectPath, runId, now = new Date()) {
  const run = readRunJson(projectPath, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  run.cleaned_at = now.toISOString();
  if (!run.completed_at) run.completed_at = now.toISOString();
  const path = join(projectPath, RUNS_DIR, runId, 'run.json');
  writeFileSync(path, JSON.stringify(run, null, 2));
}

/**
 * Mark a run completed (all agents finished, success or failure). Idempotent.
 * Typically called by the bash side or by the server when it observes all
 * signal files have appeared.
 */
export function markRunCompleted(projectPath, runId, now = new Date()) {
  const run = readRunJson(projectPath, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (!run.completed_at) {
    run.completed_at = now.toISOString();
    const path = join(projectPath, RUNS_DIR, runId, 'run.json');
    writeFileSync(path, JSON.stringify(run, null, 2));
  }
}
