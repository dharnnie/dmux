import { execSync, exec, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join, relative } from 'path';
import { WebSocketServer } from 'ws';
import { loadAgentsConfig as loadAgentsConfigParsedFromCore, ConfigError } from '../../../dmux-core/src/config.js';
import {
  listRuns as listRunsFromCore,
  listAllRuns as listAllRunsFromCore,
  readRun as readRunFromCore,
  markRunCleaned as markRunCleanedFromCore,
  approveProposal as approveProposalFromCore,
  discardProposal as discardProposalFromCore,
  createProposal as createProposalFromCore,
  updateProposal as updateProposalFromCore,
} from '../../../dmux-core/src/runs.js';
import { computeViolations as computeViolationsFromCore } from '../../../dmux-core/src/scope.js';
import { parseAgentsConfig as parseAgentsConfigFromCore } from '../../../dmux-core/src/config.js';
import {
  parseSkillYaml as parseSkillYamlFromCore,
  applyInputs as applyInputsFromCore,
  SkillSchemaError,
} from '../../../dmux-core/src/skills.js';

const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, 'dmux')
  : join(homedir(), '.config', 'dmux');
const PROJECTS_FILE = join(CONFIG_DIR, 'projects');

export function parseProjectsFile() {
  if (!existsSync(PROJECTS_FILE)) return [];

  const content = readFileSync(PROJECTS_FILE, 'utf-8');
  const projects = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const name = trimmed.slice(0, eqIdx).trim();
    let path = trimmed.slice(eqIdx + 1).trim();
    path = path.replace(/\$HOME/g, homedir()).replace(/^~/, homedir());

    projects.push({ name, path });
  }

  return projects;
}

export function addProject(name, path) {
  const storedPath = path.replace(homedir(), '$HOME');
  const content = readFileSync(PROJECTS_FILE, 'utf-8');
  writeFileSync(PROJECTS_FILE, content + `${name}=${storedPath}\n`);
}

export function removeProject(name) {
  const content = readFileSync(PROJECTS_FILE, 'utf-8');
  const filtered = content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return true;
      return !trimmed.startsWith(`${name}=`);
    })
    .join('\n');
  writeFileSync(PROJECTS_FILE, filtered);
}

export function hasAgentsConfig(projectPath) {
  return existsSync(join(projectPath, '.dmux-agents.yml'));
}

export function readAgentsConfig(projectPath) {
  const configPath = join(projectPath, '.dmux-agents.yml');
  if (!existsSync(configPath)) return null;
  return readFileSync(configPath, 'utf-8');
}

export function writeAgentsConfig(projectPath, content) {
  const configPath = join(projectPath, '.dmux-agents.yml');
  writeFileSync(configPath, content);
}

// Returns the parsed, normalized config object from dmux-core, or null if no
// .dmux-agents.yml exists. Throws ConfigError on validation failures — the
// caller is responsible for surfacing field/agent context to the client.
export function loadAgentsConfigParsed(projectPath) {
  return loadAgentsConfigParsedFromCore(projectPath);
}

// Re-export so the route handler can do `instanceof ConfigError`.
export { ConfigError };

// --- Runs (dmux-core wrappers) ---

export function listRunsForProject(projectPath) {
  return listRunsFromCore(projectPath);
}

export function listAllRuns() {
  return listAllRunsFromCore(parseProjectsFile());
}

export function readRunDetail(projectPath, runId) {
  return readRunFromCore(projectPath, runId);
}

/**
 * Approve a proposal and launch agents against it.
 * dmux-core's approveProposal writes the live .dmux-agents.yml + sets
 * started_at; then we shell into `dmux agents start` with DMUX_ADOPT_RUN_ID
 * so the bash side reuses the existing run dir instead of creating a new one.
 */
export async function approveAndLaunchProposal(projectPath, projectName, runId) {
  const result = approveProposalFromCore(projectPath, runId);
  // If already approved, the underlying tmux session likely already exists.
  // The user can interact with the running session — no further launch needed.
  if (result.alreadyApproved) return { ...result, launched: false };

  try {
    await execDmux(`agents start ${projectName} -y`, { DMUX_ADOPT_RUN_ID: runId });
  } catch (rej) {
    // execDmux rejects with a plain { error, stderr, stdout } object rather
    // than an Error — repackage so callers see a useful message instead of
    // "[object Object]".
    const detail = rej?.stderr?.trim() || rej?.stdout?.trim() || rej?.error || String(rej);
    throw new Error(`Approved run ${runId} (config written) but agent launch failed: ${detail.slice(0, 500)}`);
  }
  return { ...result, launched: true };
}

export function discardProposalById(projectPath, runId) {
  return discardProposalFromCore(projectPath, runId);
}

/**
 * "Edit before running" — write the proposal's YAML into the project's live
 * .dmux-agents.yml so the existing config editor surface is pre-filled, then
 * abandon the proposal. The user can then tweak the config and start a run
 * normally. No agents spawn from this path.
 */
export function promoteProposalToEdit(projectPath, runId) {
  const run = readRunFromCore(projectPath, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.status !== 'proposed') {
    throw new Error(`Run ${runId} is not a proposal (status=${run.status})`);
  }
  writeFileSync(join(projectPath, '.dmux-agents.yml'), run.config.yaml);
  discardProposalFromCore(projectPath, runId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// NL planner (Wave 2B PR 3)
// ---------------------------------------------------------------------------

const PLANNER_MODEL = 'sonnet';
const PLANNER_TIMEOUT_MS = 120_000;
const FILE_TREE_MAX_DEPTH = 3;
const FILE_TREE_MAX_ENTRIES = 200;
const FILE_TREE_SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  '.venv', 'venv', '__pycache__', '.dmux', 'coverage', '.turbo',
]);

/**
 * Run the NL planner: builds a system prompt from project context + the user's
 * free-form request, shells to `claude --print`, extracts the fenced ```yaml
 * block from the response, validates it via dmux-core's config parser
 * (retrying once on schema error with the validation message folded into the
 * prompt), and persists the result as a proposal via createProposal.
 *
 * Returns { proposalId } on success. Throws with a user-readable message on
 * any failure — the route handler maps to HTTP status.
 */
export async function runPlanner(projectPath, projectName, userPrompt) {
  if (typeof userPrompt !== 'string' || userPrompt.trim().length === 0) {
    throw new Error('Prompt is required.');
  }

  const ctx = {
    projectName,
    fileTree: summarizeFileTree(projectPath),
    claudeMd: safeReadFile(join(projectPath, 'CLAUDE.md')),
    existingConfig: safeReadFile(join(projectPath, '.dmux-agents.yml')),
  };

  let yamlText;
  let parsed;
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const planner = buildPlannerPrompt(ctx, userPrompt, lastError);
    const response = await execClaude(planner);
    const extracted = extractYamlBlock(response);
    if (!extracted) {
      lastError = 'Your previous response did not contain a ```yaml fenced code block. Emit exactly one.';
      if (attempt === 2) throw new Error('Planner produced no YAML block after retry.');
      continue;
    }
    try {
      parsed = parseAgentsConfigFromCore(extracted);
      yamlText = extracted;
      break;
    } catch (e) {
      lastError = `Your previous YAML was rejected by the schema validator: ${e.message}. Fix and re-emit.`;
      if (attempt === 2) {
        throw new Error(`Planner output failed validation after retry: ${e.message}`);
      }
    }
  }

  const agentsSummary = parsed.agents.map((a) => ({
    name: a.name,
    role: a.role,
    branch: a.branch || '',
    model: a.model || null,
    provider: a.provider || parsed.provider || 'claude',
    depends_on: a.depends_on || [],
  }));

  const { id } = createProposalFromCore(projectPath, {
    trigger: { type: 'nl', prompt: userPrompt },
    configYaml: yamlText,
    agentsSummary,
  });

  return { proposalId: id };
}

function safeReadFile(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null;
  } catch {
    return null;
  }
}

/**
 * Depth-limited file-tree summary suitable for prompt context. Walks up to
 * FILE_TREE_MAX_DEPTH levels, skips well-known noise dirs, and caps total
 * entries at FILE_TREE_MAX_ENTRIES so we never blow the context window on
 * a giant repo.
 */
function summarizeFileTree(root) {
  const lines = [];
  let truncated = false;

  const walk = (dir, depth) => {
    if (lines.length >= FILE_TREE_MAX_ENTRIES) { truncated = true; return; }
    if (depth > FILE_TREE_MAX_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (lines.length >= FILE_TREE_MAX_ENTRIES) { truncated = true; return; }
      if (entry.name.startsWith('.') && entry.name !== '.dmux-agents.yml') {
        // Skip dotfiles/dotdirs except the agents config; the planner doesn't
        // benefit from seeing .DS_Store etc.
        continue;
      }
      if (FILE_TREE_SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (entry.isDirectory()) {
        lines.push(`${rel}/`);
        walk(full, depth + 1);
      } else {
        lines.push(rel);
      }
    }
  };

  walk(root, 0);
  if (truncated) lines.push(`(... truncated at ${FILE_TREE_MAX_ENTRIES} entries)`);
  return lines.join('\n');
}

function buildPlannerPrompt(ctx, userPrompt, retryError) {
  const sections = [
    `You are dmux's planner agent. Read the project state and the user's work request, then propose an agent team as a valid .dmux-agents.yml.`,
    ``,
    `The agent team usually has:`,
    `- One plan-role agent (writes a plan markdown that downstream agents consume)`,
    `- One or more build-role agents (each on its own branch, with declared \`scope\`)`,
    `- Optionally one review-role agent at the end`,
    ``,
    `Rules:`,
    `- Emit exactly one fenced \`\`\`yaml code block. No prose outside it.`,
    `- Use the dmux schema: top-level \`session\`, \`worktree_base\`, \`main_pane\`, and \`agents:\` (a list).`,
    `- Each agent needs: name, role (plan|build|review|research), branch, task, model, scope (list of paths it may modify), context (list of paths it may read), depends_on (list of agent names).`,
    `- EVERY agent — including plan-role and review-role agents — MUST have a unique \`branch:\` value. dmux creates a git worktree per agent; an agent without a branch fails to launch. Use a descriptive prefix per role: plan/<topic>, feat/<topic>, review/<topic>.`,
    `- The \`model\` field MUST be exactly one of these three short aliases: \`opus\`, \`sonnet\`, \`haiku\`. Do NOT use fully-qualified ids like \`claude-sonnet-4-6\` or \`claude-opus-4-7\` — the schema rejects them.`,
    `- Pick models thoughtfully: sonnet for planners and reviewers; opus for builders on complex work; haiku only when speed beats quality.`,
    `- Declare a tight \`scope\` for every build agent. Be specific — list directories or files. Scope is enforced.`,
    ``,
    `Project: ${ctx.projectName}`,
    ``,
    `Existing .dmux-agents.yml:`,
    ctx.existingConfig ? '```yaml\n' + ctx.existingConfig + '\n```' : '(none)',
    ``,
    `File tree (depth-limited):`,
    '```\n' + (ctx.fileTree || '(empty)') + '\n```',
    ``,
    `CLAUDE.md:`,
    ctx.claudeMd ? '```\n' + ctx.claudeMd + '\n```' : '(none)',
    ``,
    `User request:`,
    userPrompt,
  ];
  if (retryError) {
    sections.push('', `IMPORTANT — this is a retry. ${retryError}`);
  }
  sections.push('', `Now emit the .dmux-agents.yml.`);
  return sections.join('\n');
}

/**
 * Extract the first fenced ```yaml code block from a string. Returns the
 * inner text (no fences) or null if no block is found.
 */
function extractYamlBlock(text) {
  // Tolerate ```yaml, ```yml, and bare ```. Prefer a labeled block when
  // present; fall back to the first bare block otherwise.
  const labeled = text.match(/```ya?ml\s*\n([\s\S]*?)\n```/i);
  if (labeled) return labeled[1].trim();
  const bare = text.match(/```\s*\n([\s\S]*?)\n```/);
  if (bare) return bare[1].trim();
  return null;
}

/**
 * Shell to the `claude` CLI with the prompt on stdin. Throws a clear error
 * if the binary isn't on PATH (the planner is opt-in until users install it).
 */
function execClaude(stdinText) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['--model', PLANNER_MODEL, '--print'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, PLANNER_TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error('`claude` CLI not found on PATH. The NL planner requires Claude Code installed (https://claude.com/claude-code).'));
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`Planner timed out after ${PLANNER_TIMEOUT_MS / 1000}s.`));
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${(stderr || stdout).slice(0, 500)}`));
      resolve(stdout);
    });

    child.stdin.write(stdinText);
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// `dmux adopt` (Wave 2C) — discovery agent + CLAUDE.md merge + adoption
// orchestrator. UI flow lands in Slice 2; CLI in Slice 3.
// ---------------------------------------------------------------------------

const DISCOVERY_MODEL = 'sonnet';
const DISCOVERY_TIMEOUT_MS = 180_000;
const DISCOVERY_MANIFEST_FILES = [
  'package.json', 'pyproject.toml', 'setup.py', 'requirements.txt',
  'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'composer.json',
  'Gemfile', 'mix.exs',
];
const DISCOVERY_MAX_MANIFEST_SIZE = 50_000;
const DISCOVERY_MAX_README_SIZE = 30_000;

const CLAUDE_MD_MARKER_START = '<!-- dmux:discovered start -->';
const CLAUDE_MD_MARKER_END = '<!-- dmux:discovered end -->';

// In-memory progress map. Keys are correlationIds the client passes in.
// Entries get cleaned ADOPTION_JOB_TTL_MS after entering a terminal state
// so a polling client that gives up doesn't leak forever.
const adoptionJobs = new Map();
const ADOPTION_JOB_TTL_MS = 10 * 60 * 1000;

function setAdoptionStage(correlationId, stage, extra = {}) {
  if (!correlationId) return;
  const prev = adoptionJobs.get(correlationId) ?? {};
  const next = { ...prev, ...extra, stage, updatedAt: Date.now() };
  adoptionJobs.set(correlationId, next);
  if (stage === 'done' || stage === 'error') {
    setTimeout(() => adoptionJobs.delete(correlationId), ADOPTION_JOB_TTL_MS).unref?.();
  }
}

export function getAdoptionProgress(correlationId) {
  return adoptionJobs.get(correlationId) ?? null;
}

/**
 * Top-level adopt orchestrator. Validates path → registers project →
 * runs discovery → writes CLAUDE.md → stages a starter team as a proposal.
 *
 * When correlationId is provided, stage transitions are written to the
 * adoptionJobs map so the UI can poll /api/adopt/progress/:correlationId.
 */
export async function runAdoption(rawPath, providedName, correlationId = null) {
  try {
    setAdoptionStage(correlationId, 'validating');

    if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
      throw badRequest('path is required');
    }
    const path = rawPath.trim();
    if (!path.startsWith('/')) {
      throw badRequest('path must be absolute');
    }
    if (!existsSync(path)) {
      throw badRequest(`path does not exist: ${path}`);
    }
    if (!existsSync(join(path, '.git'))) {
      throw badRequest(`path is not a git repository: ${path}`);
    }

    const name = (providedName && providedName.trim()) || path.split('/').filter(Boolean).pop() || '';
    if (!name) throw badRequest('could not derive project name from path; pass a name');

    const existing = parseProjectsFile();
    const existingForName = existing.find((p) => p.name === name);
    if (existingForName && existingForName.path !== path) {
      throw conflict(`project name '${name}' is already registered at a different path: ${existingForName.path}`);
    }

    setAdoptionStage(correlationId, 'registering', { projectName: name });
    if (!existingForName) {
      addProject(name, path);
    }

    setAdoptionStage(correlationId, 'discovering');
    const { claudeMdContent, agentsYaml, recommendedSkills } = await runDiscovery(path, name);

    setAdoptionStage(correlationId, 'writing-claude-md');
    const claudeResult = writeClaudeMd(path, claudeMdContent);

    setAdoptionStage(correlationId, 'creating-proposal');
    const parsed = parseAgentsConfigFromCore(agentsYaml);
    const agentsSummary = parsed.agents.map((a) => ({
      name: a.name,
      role: a.role,
      branch: a.branch || '',
      model: a.model || null,
      provider: a.provider || parsed.provider || 'claude',
      depends_on: a.depends_on || [],
    }));
    const trigger = { type: 'adopt', adoptedPath: path };
    if (recommendedSkills && recommendedSkills.length > 0) {
      trigger.recommendedSkills = recommendedSkills;
    }
    const { id: proposalId } = createProposalFromCore(path, {
      trigger,
      configYaml: agentsYaml,
      agentsSummary,
    });

    setAdoptionStage(correlationId, 'done', {
      projectName: name,
      proposalId,
      mergedExistingClaudeMd: claudeResult.merged,
      recommendedSkillsCount: recommendedSkills?.length ?? 0,
    });

    return {
      projectName: name,
      proposalId,
      mergedExistingClaudeMd: claudeResult.merged,
      recommendedSkills: recommendedSkills ?? [],
    };
  } catch (e) {
    setAdoptionStage(correlationId, 'error', { error: e?.message ?? String(e) });
    throw e;
  }
}

// Status-tagged errors so the route handler can map cleanly without
// pattern-matching error message text.
function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}
function conflict(msg) {
  const e = new Error(msg);
  e.status = 409;
  return e;
}

/**
 * Run the discovery agent: shells `claude` with a structured prompt built
 * from the project's file tree, README, manifest files, and any existing
 * CLAUDE.md / .dmux-agents.yml. Extracts two fenced blocks (claude-md,
 * yaml). Retries once on missing-block or schema-validation failure.
 */
async function runDiscovery(projectPath, projectName, opts = {}) {
  const { additionalContext = null, skipClaudeMd = false } = opts;
  const skillsCatalogue = buildSkillsCatalogueForPrompt();
  const ctx = { ...buildDiscoveryContext(projectPath, projectName), skillsCatalogue };
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = buildDiscoveryPrompt(ctx, lastError, { additionalContext, skipClaudeMd });
    const response = await execClaudeWithTimeout(prompt, DISCOVERY_MODEL, DISCOVERY_TIMEOUT_MS);
    const claudeMd = extractFencedBlock(response, 'claude-md');
    const yamlText = extractFencedBlock(response, ['yaml', 'yml']);

    if (!skipClaudeMd && !claudeMd) {
      lastError = 'Your previous response did not contain a ```claude-md fenced block. Emit one.';
      if (attempt === 2) throw new Error('Discovery produced no claude-md block after retry.');
      continue;
    }
    if (!yamlText) {
      lastError = 'Your previous response did not contain a ```yaml fenced block. Emit one.';
      if (attempt === 2) throw new Error('Discovery produced no yaml block after retry.');
      continue;
    }
    try {
      parseAgentsConfigFromCore(yamlText);
      const recommendedSkills = parseRecommendedSkillsBlock(response);
      return { claudeMdContent: claudeMd, agentsYaml: yamlText, recommendedSkills };
    } catch (e) {
      lastError = `Your previous YAML was rejected by the schema validator: ${e.message}. Fix and re-emit.`;
      if (attempt === 2) {
        throw new Error(`Discovery output failed validation after retry: ${e.message}`);
      }
    }
  }
}

function buildSkillsCatalogueForPrompt() {
  let skills;
  try {
    skills = getSkills();
  } catch {
    return null;
  }
  if (!Array.isArray(skills) || skills.length === 0) return null;
  return skills
    .map((s) => `- ${s.name} (${s.installed ? 'already installed' : 'available'}): ${s.description ?? ''}`)
    .join('\n');
}

/**
 * Parse the optional ```recommended-skills fenced block from a discovery
 * response. Format is a JSON array of { name, reason } objects. Returns
 * a normalized array of { name, reason, installed }; bad/missing blocks
 * yield an empty array (this is optional output, never fatal). Names that
 * don't match any known skill are dropped silently — the agent doesn't get
 * to introduce skills that don't exist.
 */
function parseRecommendedSkillsBlock(response) {
  const block = extractFencedBlock(response, ['recommended-skills', 'json']);
  if (!block) return [];
  let parsed;
  try {
    parsed = JSON.parse(block);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  let catalogue;
  try {
    catalogue = getSkills();
  } catch {
    catalogue = [];
  }
  const byName = new Map(catalogue.map((s) => [s.name, s]));

  const out = [];
  for (const entry of parsed) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.reason !== 'string') continue;
    const name = entry.name.trim();
    const reason = entry.reason.trim();
    if (!name || !reason) continue;
    const catEntry = byName.get(name);
    if (!catEntry) continue;  // drop names that don't exist in the catalogue
    out.push({ name, reason, installed: Boolean(catEntry.installed) });
    if (out.length >= 4) break;  // hard cap at 4 — design §3
  }
  return out;
}

function buildDiscoveryContext(projectPath, projectName) {
  const readmeCandidates = ['README.md', 'README', 'readme.md'];
  const readmePath = readmeCandidates.map((f) => join(projectPath, f)).find((p) => existsSync(p));
  const readme = readmePath ? safeReadFileSized(readmePath, DISCOVERY_MAX_README_SIZE) : null;

  const manifests = [];
  for (const fname of DISCOVERY_MANIFEST_FILES) {
    if (manifests.length >= 5) break;
    const p = join(projectPath, fname);
    if (!existsSync(p)) continue;
    const content = safeReadFileSized(p, DISCOVERY_MAX_MANIFEST_SIZE);
    if (content !== null) manifests.push({ name: fname, content });
  }

  return {
    projectName,
    fileTree: summarizeFileTree(projectPath),
    readme,
    manifests,
    existingClaudeMd: safeReadFile(join(projectPath, 'CLAUDE.md')),
    existingAgentsYaml: safeReadFile(join(projectPath, '.dmux-agents.yml')),
  };
}

function safeReadFileSized(path, maxBytes) {
  try {
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    if (stat.size > maxBytes) return null;
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function buildDiscoveryPrompt(ctx, retryError, opts = {}) {
  const { additionalContext = null, skipClaudeMd = false } = opts;
  const hasSkills = Boolean(ctx.skillsCatalogue);
  const sections = [
    skipClaudeMd
      ? `You are dmux's discovery agent. You previously analyzed this project and proposed a team. The user has been chatting with you and now wants a regenerated .dmux-agents.yml that reflects their feedback. Emit only the YAML block — no CLAUDE.md.`
      : `You are dmux's discovery agent. Read this project (the user just adopted it into dmux), then emit artifacts that get it set up: an updated CLAUDE.md, a starter .dmux-agents.yml, and (optionally) a list of skills from the catalogue that would help this project.`,
    ``,
    skipClaudeMd
      ? `Output format: one fenced \`\`\`yaml code block. Optionally also a \`\`\`recommended-skills JSON block (see rules below). One short paragraph of summary OUTSIDE the blocks.`
      : `Output format: two required fenced blocks, in this order:\n1. A \`\`\`claude-md fenced block\n2. A \`\`\`yaml fenced block\nOptionally, a third \`\`\`recommended-skills JSON block (see rules below).\nPlus one short paragraph OUTSIDE the blocks summarizing what you found.`,
    ``,
    `### CLAUDE.md rules`,
    `- Wrap your CLAUDE.md output in these HTML-comment markers (literal, on their own lines):`,
    `    ${CLAUDE_MD_MARKER_START}`,
    `    ...your content...`,
    `    ${CLAUDE_MD_MARKER_END}`,
    `- Include only sections you have evidence for: Project Overview, Stack, Layout, Commands (build/test/lint/run), Conventions.`,
    `- Cite real evidence ("Express routes live under \`src/routes/\` (5 files detected)"), not generic templates.`,
    `- Do NOT include sections you can't ground in the files you saw.`,
    ``,
    `### .dmux-agents.yml rules`,
    `- One fenced \`\`\`yaml block, valid against dmux's schema.`,
    `- Top-level: session, worktree_base, main_pane, agents (a list).`,
    `- Each agent: name, role (plan|build|review|research), branch, task, model, scope (list of paths it may modify), context (list of paths it may read), depends_on (list of agent names).`,
    `- EVERY agent including plan/review needs a unique \`branch:\` value. Use prefixes: plan/<topic>, feat/<topic>, review/<topic>.`,
    `- \`model\` must be exactly one of: \`opus\`, \`sonnet\`, \`haiku\`. Do NOT use fully-qualified ids like \`claude-sonnet-4-6\`.`,
    `- Pick models thoughtfully: sonnet for plan/review; opus for complex build; haiku only when speed beats quality.`,
    ``,
    `### Starter-team guidance`,
    `The user hasn't asked for anything yet — they just adopted the repo. Propose a low-stakes "first task" they can either approve immediately to dogfood dmux on this project, or use as a template.`,
    `Good defaults:`,
    `- A single plan-role agent that writes \`docs/project-tour.md\` summarizing the codebase. Useful for any project.`,
    `- Or, if the repo has obvious gaps (no tests, no CI, missing README), a 2-agent plan→build team that addresses one of them.`,
    ``,
    `Project: ${ctx.projectName}`,
    ``,
    `File tree:`,
    '```\n' + (ctx.fileTree || '(empty)') + '\n```',
    ``,
    `README:`,
    ctx.readme ? '```\n' + ctx.readme + '\n```' : '(none)',
    ``,
    `Manifest files:`,
    ctx.manifests.length === 0
      ? '(none detected)'
      : ctx.manifests.map((m) => `**${m.name}**\n\`\`\`\n${m.content}\n\`\`\``).join('\n\n'),
    ``,
    `Existing CLAUDE.md:`,
    ctx.existingClaudeMd ? '```\n' + ctx.existingClaudeMd + '\n```' : '(none — first adoption)',
    ``,
    `Existing .dmux-agents.yml:`,
    ctx.existingAgentsYaml ? '```yaml\n' + ctx.existingAgentsYaml + '\n```' : '(none)',
    ``,
    `Skill catalogue (for the optional recommended-skills block):`,
    hasSkills ? ctx.skillsCatalogue : '(no skills installed or available)',
    ``,
    `### Recommended-skills rules (optional output)`,
    `If one or more skills from the catalogue above are clearly relevant to this repo, emit a third fenced block:`,
    '```recommended-skills',
    `[`,
    `  { "name": "<exact-skill-name-from-catalogue>", "reason": "<one sentence grounded in repo evidence>" }`,
    `]`,
    '```',
    `- Only recommend skills from the catalogue above. Exact name match required.`,
    `- Each reason must cite something you observed in the repo. No generic recommendations.`,
    `- It's fine to recommend nothing — omit the block entirely.`,
    `- Don't recommend more than 4 skills.`,
  ];
  if (additionalContext) {
    sections.push('', additionalContext);
  }
  if (retryError) {
    sections.push('', `IMPORTANT — this is a retry. ${retryError}`);
  }
  sections.push('', `Now emit the two artifacts.`);
  return sections.join('\n');
}

/**
 * Generalized fenced-block extractor. `label` may be a string ('yaml',
 * 'claude-md') or an array of acceptable labels (['yaml', 'yml']).
 * Returns the inner text of the first matching block, or null.
 */
function extractFencedBlock(text, label) {
  const labels = Array.isArray(label) ? label : [label];
  for (const l of labels) {
    const pattern = new RegExp('```' + escapeRegex(l) + '\\s*\\n([\\s\\S]*?)\\n```', 'i');
    const m = text.match(pattern);
    if (m) return m[1].trim();
  }
  return null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Same as execClaude but with configurable model and timeout. The original
 * planner-only execClaude stays as-is so PR 3's behavior is unchanged.
 */
function execClaudeWithTimeout(stdinText, model, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['--model', model, '--print'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error('`claude` CLI not found on PATH. Adoption requires Claude Code installed (https://claude.com/claude-code).'));
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`Discovery timed out after ${timeoutMs / 1000}s.`));
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${(stderr || stdout).slice(0, 500)}`));
      resolve(stdout);
    });

    child.stdin.write(stdinText);
    child.stdin.end();
  });
}

/**
 * Write or merge a CLAUDE.md per Wave 2C §1.2:
 * - No existing file → write content verbatim (wrap in markers if missing)
 * - Existing with marker block → replace just the marker block
 * - Existing without marker → append marker block at the bottom
 *
 * The discovery agent is instructed to wrap its output in markers, so the
 * incoming `content` should arrive already wrapped. If it doesn't, we
 * defensively wrap it before writing.
 */
export function writeClaudeMd(projectPath, content) {
  const path = join(projectPath, 'CLAUDE.md');
  let wrapped = content;
  if (!wrapped.includes(CLAUDE_MD_MARKER_START)) {
    wrapped = `${CLAUDE_MD_MARKER_START}\n${content.trim()}\n${CLAUDE_MD_MARKER_END}`;
  }
  if (!existsSync(path)) {
    writeFileSync(path, wrapped + '\n');
    return { merged: false };
  }
  const existing = readFileSync(path, 'utf-8');
  if (existing.includes(CLAUDE_MD_MARKER_START) && existing.includes(CLAUDE_MD_MARKER_END)) {
    const startIdx = existing.indexOf(CLAUDE_MD_MARKER_START);
    const endIdx = existing.indexOf(CLAUDE_MD_MARKER_END) + CLAUDE_MD_MARKER_END.length;
    const next = existing.slice(0, startIdx) + wrapped + existing.slice(endIdx);
    writeFileSync(path, next);
    return { merged: true };
  }
  const next = existing.trimEnd() + '\n\n' + wrapped + '\n';
  writeFileSync(path, next);
  return { merged: true };
}

// ---------------------------------------------------------------------------
// Discovery chat (Wave 2D Slice 1) — proposal-scoped chat surface where the
// user converses with the discovery agent. Each chat is a JSON array at
// `.dmux/chats/<proposalId>.json` bound to the lifetime of the proposal.
// ---------------------------------------------------------------------------

const CHAT_MODEL = 'sonnet';
const CHAT_TIMEOUT_MS = 90_000;
const CHAT_SOFT_CAP = 15;  // warn at this many total messages
const CHAT_HARD_CAP = 25;  // refuse new messages past this

function chatFilePath(projectPath, proposalId) {
  return join(projectPath, '.dmux', 'chats', `${proposalId}.json`);
}

function buildChatGreeting(run) {
  const n = run.config.agents.length;
  const names = run.config.agents.map((a) => a.name).join(', ');
  return `I read the repo and proposed a ${n}-agent team: ${names}. Ask me anything about what I found, or request changes to the team — I can re-propose with different agents.`;
}

/**
 * Read the chat history for a proposal. Returns { greeting, messages,
 * count, nearLimit, atHardCap }. Greeting is synthesized server-side from
 * the proposal record; it isn't stored.
 */
export function readProposalChat(projectPath, proposalId) {
  const run = readRunFromCore(projectPath, proposalId);
  if (!run) throw notFound(`Proposal not found: ${proposalId}`);
  const greeting = buildChatGreeting(run);
  const path = chatFilePath(projectPath, proposalId);
  let messages = [];
  if (existsSync(path)) {
    try {
      messages = JSON.parse(readFileSync(path, 'utf-8'));
      if (!Array.isArray(messages)) messages = [];
    } catch {
      messages = [];
    }
  }
  return {
    greeting,
    messages,
    count: messages.length,
    nearLimit: messages.length >= CHAT_SOFT_CAP,
    atHardCap: messages.length >= CHAT_HARD_CAP,
  };
}

function appendChatMessage(projectPath, proposalId, message) {
  const dir = join(projectPath, '.dmux', 'chats');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = chatFilePath(projectPath, proposalId);
  let messages = [];
  if (existsSync(path)) {
    try {
      messages = JSON.parse(readFileSync(path, 'utf-8'));
      if (!Array.isArray(messages)) messages = [];
    } catch {
      messages = [];
    }
  }
  messages.push(message);
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(messages, null, 2));
  renameSync(tmp, path);
  return messages;
}

/**
 * Run a single chat turn: append the user's message, assemble the full
 * conversation as a prompt to claude --print, append the assistant's
 * response, persist. Returns { message, count, nearLimit }.
 *
 * The discovery context (file tree, manifests, CLAUDE.md, current proposal)
 * is re-fetched each turn. That's fine in v1 — the cost of re-reading local
 * files is negligible compared to the LLM call.
 */
export async function runProposalChat(projectPath, projectName, proposalId, userMessage) {
  if (typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    throw badRequest('message is required');
  }
  const run = readRunFromCore(projectPath, proposalId);
  if (!run) throw notFound(`Proposal not found: ${proposalId}`);
  if (run.status !== 'proposed') {
    throw conflict(`Proposal ${proposalId} is no longer in 'proposed' state (status=${run.status})`);
  }

  const existing = readProposalChat(projectPath, proposalId);
  if (existing.atHardCap) {
    const e = new Error(`Chat hard cap (${CHAT_HARD_CAP} messages) reached for this proposal.`);
    e.status = 429;
    throw e;
  }

  const trimmedUser = userMessage.trim();
  appendChatMessage(projectPath, proposalId, {
    role: 'user',
    content: trimmedUser,
    ts: new Date().toISOString(),
  });

  const ctx = buildDiscoveryContext(projectPath, projectName);
  const prompt = buildChatPrompt(ctx, run, existing.greeting, existing.messages, trimmedUser);
  const response = await execClaudeWithTimeout(prompt, CHAT_MODEL, CHAT_TIMEOUT_MS);

  const assistantContent = (response ?? '').trim();
  if (!assistantContent) {
    throw new Error('The agent did not return a response. Try rephrasing.');
  }

  const assistantMessage = {
    role: 'assistant',
    content: assistantContent,
    ts: new Date().toISOString(),
  };
  const all = appendChatMessage(projectPath, proposalId, assistantMessage);

  return {
    message: assistantMessage,
    count: all.length,
    nearLimit: all.length >= CHAT_SOFT_CAP,
    atHardCap: all.length >= CHAT_HARD_CAP,
  };
}

function buildChatPrompt(ctx, run, greeting, priorMessages, latestUserMessage) {
  const sections = [
    `You are dmux's discovery agent, in a chat with the user about a project you adopted into dmux. You already ran discovery; the user is now asking follow-ups or requesting changes to the team you proposed.`,
    ``,
    `Project context (loaded once; don't re-fetch):`,
    `Project: ${ctx.projectName}`,
    ``,
    `File tree:`,
    '```\n' + (ctx.fileTree || '(empty)') + '\n```',
    ``,
    `README:`,
    ctx.readme ? '```\n' + ctx.readme + '\n```' : '(none)',
    ``,
    `CLAUDE.md you wrote:`,
    ctx.existingClaudeMd ? '```\n' + ctx.existingClaudeMd + '\n```' : '(none)',
    ``,
    `Current proposed .dmux-agents.yml:`,
    '```yaml\n' + run.config.yaml + '\n```',
    ``,
    `Conversation so far:`,
    `Assistant (your opener): ${greeting}`,
    ...priorMessages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`),
    `User: ${latestUserMessage}`,
    ``,
    `Rules:`,
    `- Reply conversationally in plain prose. No fenced code blocks for new YAML — if the user wants the team changed, tell them you can regenerate the proposal and they can click "Regenerate proposal" to do it.`,
    `- Keep replies tight: usually 2–4 sentences. Use bullet lists only when listing 3+ items.`,
    `- Ground claims in the project context above. Don't make things up about files you haven't seen.`,
    `- If the user is asking something off-topic from this project, redirect briefly.`,
    ``,
    `Respond to the user's latest message.`,
  ];
  return sections.join('\n');
}

/**
 * Re-run discovery with the existing chat folded in as additional context.
 * The resulting agents config replaces the proposal's frozen YAML in place
 * (same run id, same proposed_at). The CLAUDE.md is NOT rewritten on
 * regenerate — that was a one-time write at adoption time.
 */
export async function regenerateProposalFromChat(projectPath, projectName, proposalId) {
  const run = readRunFromCore(projectPath, proposalId);
  if (!run) throw notFound(`Proposal not found: ${proposalId}`);
  if (run.status !== 'proposed') {
    throw conflict(`Proposal ${proposalId} is no longer in 'proposed' state`);
  }

  const chat = readProposalChat(projectPath, proposalId);
  const additionalContext = chat.messages.length > 0
    ? `The user has been chatting with you about this proposal. Their requested changes are in this transcript:\n\n` +
      `Assistant (opener): ${chat.greeting}\n` +
      chat.messages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') +
      `\n\nProduce an updated .dmux-agents.yml that reflects the user's intent from the conversation. The CLAUDE.md does not need to change.`
    : '';

  const { agentsYaml } = await runDiscovery(projectPath, projectName, { additionalContext, skipClaudeMd: true });

  const parsed = parseAgentsConfigFromCore(agentsYaml);
  const agentsSummary = parsed.agents.map((a) => ({
    name: a.name,
    role: a.role,
    branch: a.branch || '',
    model: a.model || null,
    provider: a.provider || parsed.provider || 'claude',
    depends_on: a.depends_on || [],
  }));

  updateProposalFromCore(projectPath, proposalId, {
    configYaml: agentsYaml,
    agentsSummary,
  });

  return { ok: true, proposalId };
}

function notFound(msg) {
  const e = new Error(msg);
  e.status = 404;
  return e;
}

/**
 * Read the markdown plan written by a plan-role agent (or consumed by a
 * downstream agent). Returns { content, path } or null if no plan file
 * exists.
 *
 * Convention: .dmux/runs/{runId}/plans/{agentName}.md. The convention isn't
 * yet enforced by the agent-spawn prompt — that's a follow-up — so this
 * endpoint will commonly return null until plan-writing is wired through.
 */
export function readAgentPlan(projectPath, runId, agentName) {
  const planPath = join(projectPath, '.dmux', 'runs', runId, 'plans', `${agentName}.md`);
  if (!existsSync(planPath)) return null;
  return {
    path: `.dmux/runs/${runId}/plans/${agentName}.md`,
    content: readFileSync(planPath, 'utf-8'),
  };
}

/**
 * Compute the git diff for an agent's worktree against the run's base branch.
 * Returns either { diff, branch, base } or { unavailable: true, reason }.
 *
 * Worktree path: {worktree_base}/{session}-{agentName}. We re-parse the
 * frozen YAML stored on the run record to recover session + worktree_base.
 */
/**
 * Stop a running Run: kill the tmux session it owns, mark the run cleaned
 * in dmux-core, and remove the .dmux/active_run pointer. Worktrees survive
 * — that matches the Section 6 copy and gives the user the choice between
 * stopping (interrupt) and cleaning (interrupt + remove worktrees).
 *
 * Returns { ok: true, sessionWasAlive } on success, throws on failure.
 */
export function stopRun(projectPath, runId) {
  const run = readRunFromCore(projectPath, runId);
  if (!run) {
    const err = new Error('Run not found');
    err.code = 'not_found';
    throw err;
  }

  // Extract the session name from the frozen YAML. We don't re-validate the
  // YAML here — even if it has drifted from current dmux-core rules, this
  // run was already created against it, so the session line is still good.
  const sessionLine = (run.config.yaml || '').match(/^session:\s*(.+)$/m);
  const session = sessionLine ? sessionLine[1].trim() : null;

  let sessionWasAlive = false;
  if (session) {
    try {
      execSync(`tmux has-session -t "${session}" 2>/dev/null`);
      sessionWasAlive = true;
      execSync(`tmux kill-session -t "${session}"`);
    } catch {
      // No session — agents already finished or were never alive in this
      // server's lifetime. Still safe to mark cleaned below.
    }
  }

  markRunCleanedFromCore(projectPath, runId);

  // Remove the active-run pointer if it points at this run. (If a newer
  // run has started since, leave it alone.)
  const activeFile = join(projectPath, '.dmux', 'active_run');
  if (existsSync(activeFile)) {
    const active = readFileSync(activeFile, 'utf-8').trim();
    if (active === runId) {
      try { execSync(`rm -f "${activeFile}"`); } catch { /* ignore */ }
    }
  }

  return { ok: true, sessionWasAlive };
}

// --- Scope-violation helpers ---

/**
 * Resolve the worktree path for an agent given a parsed config. Returns null
 * if the worktree no longer exists on disk (run was cleaned up).
 */
function resolveWorktreePath(projectPath, parsed, agentName) {
  const worktreeBase = parsed.worktree_base.startsWith('/')
    ? parsed.worktree_base
    : join(projectPath, parsed.worktree_base);
  const worktreePath = join(worktreeBase, `${parsed.session}-${agentName}`);
  return existsSync(worktreePath) ? worktreePath : null;
}

function resolveBaseBranch(projectPath) {
  const baseFile = join(projectPath, '.dmux', 'base_branch');
  if (!existsSync(baseFile)) return 'main';
  return (readFileSync(baseFile, 'utf-8').trim() || 'main');
}

/**
 * Compute the violations for a single agent. Returns one of:
 *   { violations: [...], scope, base, branch }      — normal case
 *   { unavailable: true, reason }                    — can't check (no
 *                                                      scope, plan/review
 *                                                      role, missing
 *                                                      worktree, git failure)
 */
function computeAgentViolations(projectPath, parsed, agent, base) {
  if (agent.role !== 'build') {
    return {
      unavailable: true,
      reason: `${agent.role} agents have no worktree to check.`,
    };
  }
  if (!Array.isArray(agent.scope) || agent.scope.length === 0) {
    return {
      unavailable: true,
      reason: 'no_scope',
    };
  }

  const worktreePath = resolveWorktreePath(projectPath, parsed, agent.name);
  if (!worktreePath) {
    return {
      unavailable: true,
      reason: 'Worktree no longer exists (likely cleaned up).',
    };
  }

  try {
    const numstat = execSync(
      `git -C "${worktreePath}" diff --numstat "${base}"...HEAD`,
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 },
    );
    const violations = computeViolationsFromCore(numstat, agent.scope);
    return {
      violations,
      scope: agent.scope,
      base,
      branch: agent.branch || '(detached)',
    };
  } catch (e) {
    return { unavailable: true, reason: `git diff --numstat failed: ${e.message}` };
  }
}

/**
 * Full violations payload for one agent — used by the per-agent endpoint.
 */
export function readAgentViolations(projectPath, runId, agentName) {
  const run = readRunFromCore(projectPath, runId);
  if (!run) return { unavailable: true, reason: 'Run not found' };

  let parsed;
  try {
    parsed = parseAgentsConfigFromCore(run.config.yaml);
  } catch (e) {
    return { unavailable: true, reason: `Couldn't parse frozen config: ${e.message}` };
  }

  const agent = parsed.agents.find((a) => a.name === agentName);
  if (!agent) return { unavailable: true, reason: `Agent ${agentName} not in run` };

  const base = resolveBaseBranch(projectPath);
  return computeAgentViolations(projectPath, parsed, agent, base);
}

/**
 * Per-agent violation counts for a whole run — used by Run Detail to render
 * the banner + per-row badges without spinning up N separate fetches.
 *
 * Returns { byAgent: { name: count|null } }. null = unavailable (no scope,
 * not a build agent, worktree gone). 0 = checked, clean.
 */
export function readRunViolationsSummary(projectPath, runId) {
  const run = readRunFromCore(projectPath, runId);
  if (!run) return { byAgent: {} };

  let parsed;
  try {
    parsed = parseAgentsConfigFromCore(run.config.yaml);
  } catch {
    return { byAgent: {} };
  }

  const base = resolveBaseBranch(projectPath);
  const byAgent = {};
  for (const agent of parsed.agents) {
    const result = computeAgentViolations(projectPath, parsed, agent, base);
    byAgent[agent.name] = result.unavailable ? null : result.violations.length;
  }
  return { byAgent };
}

export async function readAgentDiff(projectPath, runId, agentName) {
  const { parseAgentsConfig } = await import('../../../dmux-core/src/config.js');
  const run = readRunFromCore(projectPath, runId);
  if (!run) return { unavailable: true, reason: 'Run not found' };

  const agent = run.config.agents.find((a) => a.name === agentName);
  if (!agent) return { unavailable: true, reason: `Agent ${agentName} not in this run` };

  if (agent.role === 'plan' || agent.role === 'review') {
    return {
      unavailable: true,
      reason: `${agent.role} agents have no worktree to diff.`,
    };
  }

  let parsed;
  try {
    parsed = parseAgentsConfig(run.config.yaml);
  } catch (e) {
    return { unavailable: true, reason: `Couldn't re-parse frozen config: ${e.message}` };
  }

  const worktreeBase = parsed.worktree_base.startsWith('/')
    ? parsed.worktree_base
    : join(projectPath, parsed.worktree_base);
  const worktreePath = join(worktreeBase, `${parsed.session}-${agentName}`);

  if (!existsSync(worktreePath)) {
    return {
      unavailable: true,
      reason: 'Worktree no longer exists (likely cleaned up).',
    };
  }

  let base = 'main';
  const baseFile = join(projectPath, '.dmux', 'base_branch');
  if (existsSync(baseFile)) {
    base = readFileSync(baseFile, 'utf-8').trim() || 'main';
  }

  try {
    const diff = execSync(`git -C "${worktreePath}" diff --no-color "${base}"...HEAD`, {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 10, // 10MB
    });
    return { diff, branch: agent.branch || '(detached)', base };
  } catch (e) {
    return { unavailable: true, reason: `git diff failed: ${e.message}` };
  }
}

export function checkTmuxSession(sessionName) {
  try {
    execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`, {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

export function getTmuxSessions() {
  try {
    const output = execSync('tmux ls -F "#{session_name}" 2>/dev/null', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Run a dmux CLI invocation and return its stdout/stderr.
 *
 * `extraEnv` is merged into process.env for the child — used by the spawn
 * flow to pass trigger metadata (DMUX_RUN_TRIGGER / DMUX_RUN_SKILL_NAME)
 * down through dmux.sh → dmux-runs.js so the Run record carries the right
 * trigger.
 */
export function execDmux(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const dmuxPath = getDmuxPath();
    exec(`"${dmuxPath}" ${args}`, {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, ...extraEnv },
    }, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stderr, stdout });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export function execDmuxSync(args) {
  const dmuxPath = getDmuxPath();
  try {
    return execSync(`"${dmuxPath}" ${args}`, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    return e.stdout || e.stderr || e.message;
  }
}

// --- Git helpers ---

export function getGitInfo(projectPath) {
  if (!existsSync(join(projectPath, '.git'))) return null;
  const opts = { cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] };

  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', opts).trim();
    const statusRaw = execSync('git status --porcelain', opts).trim();
    const changes = statusRaw ? statusRaw.split('\n').length : 0;

    // Categorize changes
    let staged = 0, modified = 0, untracked = 0;
    if (statusRaw) {
      for (const line of statusRaw.split('\n')) {
        const x = line[0], y = line[1];
        if (x === '?' && y === '?') untracked++;
        else if (x !== ' ' && x !== '?') staged++;
        else modified++;
      }
    }

    // Recent commits (last 8)
    let commits = [];
    try {
      const log = execSync(
        'git log --oneline --format="%h|%s|%cr|%an" -8',
        opts
      ).trim();
      if (log) {
        commits = log.split('\n').map((line) => {
          const [hash, subject, time, author] = line.split('|');
          return { hash, subject, time, author };
        });
      }
    } catch { /* empty repo */ }

    // Remotes
    let remote = null;
    try {
      remote = execSync('git remote get-url origin', opts).trim();
    } catch { /* no remote */ }

    return { branch, changes, staged, modified, untracked, commits, remote };
  } catch {
    return null;
  }
}

// --- Parsed agent status ---

export function getAgentStatusParsed(projectName) {
  const raw = execDmuxSync(`agents status ${projectName}`);
  if (!raw || raw.includes('is not running')) {
    return { running: false, session: null, agents: [], raw };
  }

  const lines = raw.split('\n');
  const sessionMatch = lines[0]?.match(/^Session:\s*(.+)/);
  const session = sessionMatch ? sessionMatch[1].trim() : null;

  const agents = [];
  for (const line of lines) {
    // Match the formatted output: name, branch, role, status
    const m = line.match(/^\s{2}(\S+)\s+(\S+)\s+(build|review)\s+(.+)$/);
    if (m && m[1] !== 'AGENT' && m[1] !== '-----') {
      agents.push({
        name: m[1],
        branch: m[2] === '—' ? null : m[2],
        role: m[3],
        status: m[4].trim(),
      });
    }
  }

  return { running: true, session, agents, raw };
}

// --- Skills ---

export function getSkills() {
  const skills = [];
  const installed = new Set();

  // Installed skills
  const skillsDir = join(homedir(), '.local', 'share', 'dmux', 'skills');
  if (existsSync(skillsDir)) {
    for (const name of readdirSync(skillsDir)) {
      const yml = join(skillsDir, name, 'skill.yml');
      if (existsSync(yml)) {
        const meta = readSkillSummary(yml);
        skills.push({ ...meta, installed: true });
        installed.add(name);
      }
    }
  }

  // Built-in skills (not yet installed)
  const builtinDir = getBuiltinSkillsDir();
  if (builtinDir && existsSync(builtinDir)) {
    for (const name of readdirSync(builtinDir)) {
      if (installed.has(name)) continue;
      const yml = join(builtinDir, name, 'skill.yml');
      if (existsSync(yml)) {
        const meta = readSkillSummary(yml);
        skills.push({ ...meta, installed: false });
      }
    }
  }

  return skills;
}

function getBuiltinSkillsDir() {
  // Check repo location (dev mode) — server/lib -> server -> dmux-ui -> repo root
  const repoSkills = join(import.meta.dirname, '..', '..', '..', 'skills');
  if (existsSync(repoSkills)) return repoSkills;

  // Check installed location
  const installed = join(homedir(), '.local', 'share', 'dmux', 'builtin-skills');
  if (existsSync(installed)) return installed;

  return null;
}

// Replaced the Wave 1 hand-rolled line parser with dmux-core's parseSkillYaml.
// Lightweight wrapper that just reads the file + falls back gracefully when
// a malformed skill ships — for the listing endpoint, a broken skill should
// surface as a degraded entry rather than crash the whole list.
function readSkillSummary(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  try {
    const skill = parseSkillYamlFromCore(content);
    return {
      name: skill.name,
      description: skill.description,
      tags: skill.tags,
      provider: skill.provider,
      inputs: skill.inputs,
      agentCount: skill.agents.length,
    };
  } catch (e) {
    // Degraded entry — show what we can, mark it broken.
    return {
      name: '(invalid skill)',
      description: e instanceof SkillSchemaError ? e.message : 'Could not parse skill.yml',
      tags: [],
      provider: 'claude',
      inputs: [],
      agentCount: 0,
      invalid: true,
    };
  }
}

export function installSkill(name) {
  const skillsDir = join(homedir(), '.local', 'share', 'dmux', 'skills');
  const destDir = join(skillsDir, name);

  if (existsSync(join(destDir, 'skill.yml'))) {
    return { ok: true, message: `Skill '${name}' is already installed.` };
  }

  const builtinDir = getBuiltinSkillsDir();
  const sourceDir = builtinDir ? join(builtinDir, name) : null;

  if (!sourceDir || !existsSync(join(sourceDir, 'skill.yml'))) {
    return { ok: false, message: `Skill '${name}' not found.` };
  }

  // Copy skill directory
  execSync(`mkdir -p "${destDir}" && cp -r "${sourceDir}/"* "${destDir}/"`, { stdio: 'pipe' });
  return { ok: true, message: `Installed skill: ${name}` };
}

export function applySkillToProject(skillName, projectPath, inputValues = {}) {
  // Find the skill yml
  let skillYml = null;
  const installed = join(homedir(), '.local', 'share', 'dmux', 'skills', skillName, 'skill.yml');
  if (existsSync(installed)) {
    skillYml = installed;
  } else {
    const builtinDir = getBuiltinSkillsDir();
    if (builtinDir) {
      const builtin = join(builtinDir, skillName, 'skill.yml');
      if (existsSync(builtin)) skillYml = builtin;
    }
  }

  if (!skillYml) return { ok: false, message: `Skill '${skillName}' not found.` };

  const content = readFileSync(skillYml, 'utf-8');

  let skill;
  try {
    skill = parseSkillYamlFromCore(content);
  } catch (e) {
    if (e instanceof SkillSchemaError) {
      return { ok: false, message: `Skill is malformed: ${e.message}`, input: e.input, field: e.field };
    }
    return { ok: false, message: `Couldn't parse skill: ${e.message}` };
  }

  // Render the agents block with the user-supplied input values + the
  // reserved {{project_name}} drawn from the project directory name.
  const projectName = projectPath.split('/').filter(Boolean).pop() ?? '';
  let renderedAgentsYaml;
  try {
    renderedAgentsYaml = applyInputsFromCore(skill, inputValues, { project_name: projectName });
  } catch (e) {
    if (e instanceof SkillSchemaError) {
      return { ok: false, message: e.message, input: e.input, field: e.field };
    }
    throw e;
  }

  // The rendered output is just the agents list. Wrap with the session
  // header and notifications setting that applySkillToProject has always
  // added on the way out.
  const config = `session: skill-${skillName}\nnotifications: true\n\nagents:\n${indentBlock(renderedAgentsYaml, 2)}`;

  const configPath = join(projectPath, '.dmux-agents.yml');
  writeFileSync(configPath, config);

  return { ok: true, message: `Applied skill '${skillName}' to project.`, config };
}

function indentBlock(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? pad + line : line))
    .join('\n');
}

export function removeSkill(name) {
  const skillsDir = join(homedir(), '.local', 'share', 'dmux', 'skills');
  const destDir = join(skillsDir, name);

  if (!existsSync(destDir)) {
    return { ok: false, message: `Skill '${name}' is not installed.` };
  }

  execSync(`rm -rf "${destDir}"`, { stdio: 'pipe' });
  return { ok: true, message: `Removed skill: ${name}` };
}

// --- Tmux pane capture ---

export function captureTmuxPane(session, paneIndex) {
  try {
    return execSync(
      `tmux capture-pane -t "${session}:0.${paneIndex}" -p -e 2>/dev/null`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000 }
    );
  } catch {
    return null;
  }
}

export function listTmuxPanes(session) {
  try {
    const raw = execSync(
      `tmux list-panes -t "${session}:0" -F "#{pane_index}|#{pane_pid}|#{pane_current_command}" 2>/dev/null`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return raw.trim().split('\n').filter(Boolean).map((line) => {
      const [index, pid, command] = line.split('|');
      return { index: Number(index), pid, command };
    });
  } catch {
    return [];
  }
}

// --- WebSocket ---

export function createWsServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  // Track all intervals per client so we can clean up
  const clientIntervals = new Map();

  function getIntervals(ws) {
    if (!clientIntervals.has(ws)) clientIntervals.set(ws, new Map());
    return clientIntervals.get(ws);
  }

  function clearAllIntervals(ws) {
    const intervals = clientIntervals.get(ws);
    if (intervals) {
      for (const iv of intervals.values()) clearInterval(iv);
      intervals.clear();
      clientIntervals.delete(ws);
    }
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        const intervals = getIntervals(ws);

        if (msg.type === 'subscribe:status' && msg.project) {
          const key = `status:${msg.project}`;
          if (intervals.has(key)) clearInterval(intervals.get(key));

          let prev = '';
          const send = () => {
            const status = getAgentStatusParsed(msg.project);
            const json = JSON.stringify(status);
            if (json !== prev) {
              prev = json;
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'status', project: msg.project, ...status }));
              }
            }
          };
          send();
          intervals.set(key, setInterval(send, 2000));
        }

        if (msg.type === 'subscribe:terminal' && msg.session != null && msg.pane != null) {
          const key = `term:${msg.session}:${msg.pane}`;
          if (intervals.has(key)) clearInterval(intervals.get(key));

          let prev = '';
          const send = () => {
            const content = captureTmuxPane(msg.session, msg.pane);
            if (content !== null && content !== prev) {
              prev = content;
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: 'terminal',
                  session: msg.session,
                  pane: msg.pane,
                  content,
                }));
              }
            }
          };
          send();
          intervals.set(key, setInterval(send, 800));
        }

        if (msg.type === 'unsubscribe:terminal' && msg.session != null && msg.pane != null) {
          const key = `term:${msg.session}:${msg.pane}`;
          if (intervals.has(key)) {
            clearInterval(intervals.get(key));
            intervals.delete(key);
          }
        }

        if (msg.type === 'unsubscribe') {
          clearAllIntervals(ws);
        }
      } catch { /* ignore bad messages */ }
    });

    ws.on('close', () => clearAllIntervals(ws));
  });

  // Heartbeat — drop dead connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

function getDmuxPath() {
  // Check common locations
  const candidates = [
    join(homedir(), '.local', 'bin', 'dmux'),
    '/usr/local/bin/dmux',
  ];

  // Also check if dmux is in the same repo (dev mode)
  const repoPath = join(import.meta.dirname, '..', '..', 'dmux.sh');
  candidates.unshift(repoPath);

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return 'dmux'; // fallback to PATH
}
