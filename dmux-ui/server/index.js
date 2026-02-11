import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseProjectsFile,
  addProject,
  removeProject,
  hasAgentsConfig,
  readAgentsConfig,
  writeAgentsConfig,
  getTmuxSessions,
  execDmux,
  execDmuxSync,
} from './lib/dmux.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
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

// Start agents
app.post('/api/projects/:name/agents/start', (req, res) => {
  const name = req.params.name;

  execDmux(`agents start ${name} -y`)
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

// SPA fallback for production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '..', 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`dmux UI server running at http://localhost:${PORT}`);
});
