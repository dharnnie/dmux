import { execSync, exec } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { WebSocketServer } from 'ws';

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

export function execDmux(args) {
  return new Promise((resolve, reject) => {
    const dmuxPath = getDmuxPath();
    exec(`"${dmuxPath}" ${args}`, { encoding: 'utf-8', timeout: 30000 }, (error, stdout, stderr) => {
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
        const meta = parseSkillYml(yml);
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
        const meta = parseSkillYml(yml);
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

function parseSkillYml(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const meta = { name: '', description: '', tags: [], provider: 'claude' };

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('name:')) meta.name = trimmed.slice(5).trim();
    else if (trimmed.startsWith('description:')) meta.description = trimmed.slice(12).trim();
    else if (trimmed.startsWith('provider:')) meta.provider = trimmed.slice(9).trim();
    else if (trimmed.startsWith('tags:')) {
      const raw = trimmed.slice(5).trim();
      const m = raw.match(/\[(.+)]/);
      if (m) meta.tags = m[1].split(',').map((t) => t.trim());
    }
  }

  return meta;
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

export function applySkillToProject(skillName, projectPath) {
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

  // Extract agents section (everything from "agents:" onwards)
  const agentsIdx = content.indexOf('\nagents:');
  if (agentsIdx === -1) return { ok: false, message: 'Skill has no agents defined.' };

  const agentsSection = content.slice(agentsIdx + 1);

  // Build the dmux config
  const config = `session: skill-${skillName}\nnotifications: true\n\n${agentsSection}`;

  // Write to project
  const configPath = join(projectPath, '.dmux-agents.yml');
  writeFileSync(configPath, config);

  return { ok: true, message: `Applied skill '${skillName}' to project.`, config };
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
