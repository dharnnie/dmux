import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import {
  parseProjectsFile,
  addProject,
  removeProject,
  hasAgentsConfig,
  readAgentsConfig,
  writeAgentsConfig,
  loadAgentsConfigParsed,
  ConfigError,
  getTmuxSessions,
  execDmux,
  execDmuxSync,
  getGitInfo,
  getAgentStatusParsed,
  listTmuxPanes,
  getSkills,
  installSkill,
  removeSkill,
  applySkillToProject,
  createWsServer,
  listRunsForProject,
  listAllRuns,
  readRunDetail,
  readAgentPlan,
  readAgentDiff,
  readAgentViolations,
  readRunViolationsSummary,
  stopRun,
  approveAndLaunchProposal,
  discardProposalById,
  promoteProposalToEdit,
  runPlanner,
} from './lib/dmux.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3100;

app.use(cors());
app.use(express.json());
app.use(express.text());

// Serve static build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, '..', 'dist')));
}

// --- API Routes ---

// List all projects with status info
app.get('/api/projects', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const sessions = getTmuxSessions();

    const enriched = projects.map((p) => ({
      ...p,
      hasAgentsConfig: hasAgentsConfig(p.path),
      hasSession: sessions.some(
        (s) => s === `dmux-${p.name}` || s.includes(p.name)
      ),
    }));

    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Add a project
app.post('/api/projects', (req, res) => {
  try {
    const { name, path } = req.body;
    if (!name || !path) {
      return res.status(400).json({ error: 'name and path are required' });
    }
    addProject(name, path);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remove a project
app.delete('/api/projects/:name', (req, res) => {
  try {
    removeProject(req.params.name);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Read agents config YAML
app.get('/api/projects/:name/agents-config', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const config = readAgentsConfig(project.path);
    if (!config) return res.status(404).json({ error: 'No .dmux-agents.yml found' });

    res.type('text/plain').send(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Read agents config as parsed JSON (via dmux-core). Source of truth for the UI.
app.get('/api/projects/:name/agents-config-parsed', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const config = loadAgentsConfigParsed(project.path);
    if (!config) return res.status(404).json({ error: 'No .dmux-agents.yml found' });

    res.json(config);
  } catch (e) {
    if (e instanceof ConfigError) {
      return res.status(422).json({
        error: e.message,
        field: e.field ?? null,
        agent: e.agent ?? null,
      });
    }
    res.status(500).json({ error: e.message });
  }
});

// Write agents config YAML
app.put('/api/projects/:name/agents-config', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const body = typeof req.body === 'string' ? req.body : req.body.content;
    if (!body) return res.status(400).json({ error: 'content is required' });

    writeAgentsConfig(project.path, body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Launch project panes
app.post('/api/projects/:name/launch', (req, res) => {
  const { panes = 1, claude = 0 } = req.body || {};
  const name = req.params.name;

  execDmux(`-p ${name} -n ${panes} -c ${claude}`)
    .then((result) => res.json({ ok: true, output: result.stdout }))
    .catch((err) => res.status(500).json({ error: err.stderr || err.error }));
});

// Start agents. Body may contain { trigger: { type, skill_name } } so the
// spawn sheet can record the right trigger on the new Run. Falls back to
// "manual" when no trigger is provided (preserving the existing behavior
// of bare /agents/start callers).
app.post('/api/projects/:name/agents/start', (req, res) => {
  const name = req.params.name;
  const env = {};
  const trigger = req.body?.trigger;
  if (trigger?.type === 'skill') {
    env.DMUX_RUN_TRIGGER = 'skill';
    if (trigger.skill_name) env.DMUX_RUN_SKILL_NAME = trigger.skill_name;
  } else if (trigger?.type === 'nl') {
    env.DMUX_RUN_TRIGGER = 'nl';
  }

  execDmux(`agents start ${name} -y`, env)
    .then((result) => res.json({ ok: true, output: result.stdout }))
    .catch((err) => res.status(500).json({ error: err.stderr || err.error, output: err.stdout }));
});

// Agent status
app.get('/api/projects/:name/agents/status', (req, res) => {
  try {
    const name = req.params.name;
    const output = execDmuxSync(`agents status ${name}`);
    res.json({ ok: true, output });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cleanup agents
app.post('/api/projects/:name/agents/cleanup', (req, res) => {
  const name = req.params.name;

  execDmux(`agents cleanup ${name}`)
    .then((result) => res.json({ ok: true, output: result.stdout }))
    .catch((err) => res.status(500).json({ error: err.stderr || err.error, output: err.stdout }));
});

// Git info for a project
app.get('/api/projects/:name/git', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const info = getGitInfo(project.path);
    if (!info) return res.json({ git: false });

    res.json({ git: true, ...info });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List tmux panes for a session
app.get('/api/sessions/:session/panes', (req, res) => {
  try {
    const panes = listTmuxPanes(req.params.session);
    res.json(panes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Parsed agent status (structured JSON instead of raw text)
app.get('/api/projects/:name/agents/status/parsed', (req, res) => {
  try {
    const name = req.params.name;
    const status = getAgentStatusParsed(name);
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Runs ---

// List runs across all projects, newest first. Powers the Dashboard.
app.get('/api/runs', (req, res) => {
  try {
    const runs = listAllRuns();
    const limit = req.query.limit ? Number(req.query.limit) : null;
    res.json(limit ? runs.slice(0, limit) : runs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List runs for a single project, newest first. Powers Project Detail's History.
app.get('/api/projects/:name/runs', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    res.json(listRunsForProject(project.path));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Full Run Detail with derived per-agent status.
app.get('/api/projects/:name/runs/:runId', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const run = readRunDetail(project.path, req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    res.json(run);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Read a plan markdown file produced (or consumed) by an agent.
// 404 if no plan file exists at the conventional path.
app.get('/api/projects/:name/runs/:runId/agents/:agentName/plan', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const plan = readAgentPlan(project.path, req.params.runId, req.params.agentName);
    if (!plan) return res.status(404).json({ error: 'No plan file' });
    res.json(plan);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Approve a proposal. dmux-core writes the live .dmux-agents.yml + sets
// started_at on the run; then we launch agents against the adopted run.
app.post('/api/projects/:name/proposals/:runId/approve', async (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const result = await approveAndLaunchProposal(project.path, project.name, req.params.runId);
    res.json(result);
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (/not found/i.test(msg)) return res.status(404).json({ error: msg });
    if (/abandoned|not a proposal/i.test(msg)) return res.status(409).json({ error: msg });
    res.status(500).json({ error: msg });
  }
});

// Discard a proposal. Sets abandoned_at; no worktrees to clean.
app.post('/api/projects/:name/proposals/:runId/discard', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const result = discardProposalById(project.path, req.params.runId);
    res.json(result);
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (/not found/i.test(msg)) return res.status(404).json({ error: msg });
    if (/started run/i.test(msg)) return res.status(409).json({ error: msg });
    res.status(500).json({ error: msg });
  }
});

// Promote a proposal to the editor: copy its YAML into the project's live
// .dmux-agents.yml and abandon the proposal. The user is bounced to the
// existing config-editor surface and can tweak before starting a run.
app.post('/api/projects/:name/proposals/:runId/promote-to-edit', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const result = promoteProposalToEdit(project.path, req.params.runId);
    res.json(result);
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (/not found/i.test(msg)) return res.status(404).json({ error: msg });
    if (/not a proposal/i.test(msg)) return res.status(409).json({ error: msg });
    res.status(500).json({ error: msg });
  }
});

// NL planner Smart path (Wave 2B PR 3). Takes a free-form prompt, shells to
// `claude` with project context, validates the returned YAML, and persists
// the result as a proposal via dmux-core's createProposal. Returns the new
// proposal id so the UI can navigate to the review page.
app.post('/api/projects/:name/proposals', async (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const prompt = (req.body?.prompt ?? '').toString();
    if (!prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required.' });
    }

    const { proposalId } = await runPlanner(project.path, project.name, prompt);
    res.json({ ok: true, proposalId });
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (/claude.*not found/i.test(msg)) return res.status(503).json({ error: msg });
    if (/timed out/i.test(msg)) return res.status(504).json({ error: msg });
    if (/validation|did not contain.*yaml/i.test(msg)) return res.status(422).json({ error: msg });
    res.status(500).json({ error: msg });
  }
});

// Stop a running run: kill its tmux session and mark cleaned. Worktrees
// survive — the user can clean them up via the existing project-level
// cleanup action.
app.post('/api/projects/:name/runs/:runId/stop', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const result = stopRun(project.path, req.params.runId);
    res.json(result);
  } catch (e) {
    if (e.code === 'not_found') return res.status(404).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// Per-agent violation counts for the whole run — used by Run Detail to
// render the banner + row badges in a single fetch.
app.get('/api/projects/:name/runs/:runId/violations-summary', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    res.json(readRunViolationsSummary(project.path, req.params.runId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Full violations payload for one agent — used by the Violations tab on
// Agent Detail.
app.get('/api/projects/:name/runs/:runId/agents/:agentName/violations', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    res.json(readAgentViolations(project.path, req.params.runId, req.params.agentName));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Git diff for an agent's worktree against the run's base branch.
app.get('/api/projects/:name/runs/:runId/agents/:agentName/diff', async (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const result = await readAgentDiff(project.path, req.params.runId, req.params.agentName);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Skills ---

app.get('/api/skills', (req, res) => {
  try {
    res.json(getSkills());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/skills/:name/install', (req, res) => {
  try {
    const result = installSkill(req.params.name);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

app.delete('/api/skills/:name', (req, res) => {
  try {
    const result = removeSkill(req.params.name);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// Apply skill to a project (generate config + optionally start).
// Body may include { inputs: { name: value } } when the skill has a declared
// inputs schema; absent/empty inputs preserves the pre-Wave-2B behavior of
// writing the static skill template.
app.post('/api/projects/:name/skills/:skill', (req, res) => {
  try {
    const projects = parseProjectsFile();
    const project = projects.find((p) => p.name === req.params.name);
    if (!project) return res.status(404).json({ ok: false, message: 'Project not found' });

    const inputs = (req.body && typeof req.body === 'object' && req.body.inputs) || {};
    const result = applySkillToProject(req.params.skill, project.path, inputs);
    if (!result.ok) {
      // 422 when the skill or its inputs are the problem (e.g. missing
      // required input, malformed skill); 500 only for genuine surprises.
      return res.status(422).json(result);
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// SPA fallback for production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '..', 'dist', 'index.html'));
  });
}

// Start server with WebSocket support
createWsServer(httpServer);

httpServer.listen(PORT, () => {
  console.log(`dmux UI server running at http://localhost:${PORT}`);
});
