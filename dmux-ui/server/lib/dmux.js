import { execSync, exec } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

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
