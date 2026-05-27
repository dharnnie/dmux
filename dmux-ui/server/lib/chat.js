/**
 * Wave 3B chat — project-scoped (this slice) and dmux-global (Slice 2).
 *
 * Uses `claude --print` so the user's Claude Code Max subscription is the
 * single source of auth, same as Wave 2D's per-proposal chat, the NL
 * planner, and discovery. No separate ANTHROPIC_API_KEY.
 *
 * This module is intentionally separate from lib/dmux.js because lib/dmux.js
 * has grown large and chat is a coherent surface of its own. The dispatch
 * primitive (execClaude) is duplicated rather than shared so chat.js is
 * self-contained.
 *
 * Wave 2D's per-proposal chat continues to live in lib/dmux.js — two chat
 * surfaces, both on `--print`.
 */

import { spawn } from 'child_process';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  statSync,
} from 'fs';
import { homedir } from 'os';
import { join, relative } from 'path';
import { parseProjectsFile } from './dmux.js';

const CHAT_MODEL = 'sonnet';
const CHAT_TIMEOUT_MS = 120_000;
const SOFT_CAP_MESSAGES = 50;
const HARD_CAP_MESSAGES = 100;

// ---------------------------------------------------------------------------
// Chat storage
// ---------------------------------------------------------------------------

function chatFilePath(scope, identifier) {
  if (scope === 'project') {
    // identifier is the absolute project path
    return join(identifier, '.dmux', 'chats', 'project.json');
  }
  if (scope === 'global') {
    const root = process.env.XDG_CONFIG_HOME
      ? join(process.env.XDG_CONFIG_HOME, 'dmux')
      : join(homedir(), '.config', 'dmux');
    return join(root, 'chats', 'global.json');
  }
  throw new Error(`Unknown chat scope: ${scope}`);
}

export function readChat(scope, identifier) {
  const path = chatFilePath(scope, identifier);
  if (!existsSync(path)) return { messages: [] };
  try {
    const messages = JSON.parse(readFileSync(path, 'utf-8'));
    return { messages: Array.isArray(messages) ? messages : [] };
  } catch {
    return { messages: [] };
  }
}

function appendChatMessage(scope, identifier, message) {
  const path = chatFilePath(scope, identifier);
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

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

// ---------------------------------------------------------------------------
// Context envelopes
// ---------------------------------------------------------------------------

const FILE_TREE_MAX_ENTRIES = 200;
const FILE_TREE_MAX_DEPTH = 3;
const FILE_TREE_SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  '.venv', 'venv', '__pycache__', '.dmux', 'coverage', '.turbo',
]);

function summarizeFileTree(root) {
  const lines = [];
  let truncated = false;
  const walk = (dir, depth) => {
    if (lines.length >= FILE_TREE_MAX_ENTRIES) { truncated = true; return; }
    if (depth > FILE_TREE_MAX_DEPTH) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (lines.length >= FILE_TREE_MAX_ENTRIES) { truncated = true; return; }
      if (e.name.startsWith('.') && e.name !== '.dmux-agents.yml') continue;
      if (FILE_TREE_SKIP.has(e.name)) continue;
      const full = join(dir, e.name);
      const rel = relative(root, full);
      if (e.isDirectory()) {
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

function safeRead(path, maxBytes = 30_000) {
  try {
    if (!existsSync(path)) return null;
    const st = statSync(path);
    if (st.size > maxBytes) return null;
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Project context envelope. Assembled fresh each turn so changes to the
 * project since the chat started are reflected.
 */
export function buildProjectChatContext(projectPath, projectName, recentRuns = []) {
  return {
    projectName,
    fileTree: summarizeFileTree(projectPath),
    claudeMd: safeRead(join(projectPath, 'CLAUDE.md')),
    agentsYaml: safeRead(join(projectPath, '.dmux-agents.yml')),
    recentRuns: recentRuns.slice(0, 5).map((r) => ({
      id: r.id,
      status: r.status,
      agent_count: r.agent_count,
      trigger: r.trigger?.type ?? 'manual',
    })),
  };
}

function buildSystemPrompt(scope, ctx) {
  if (scope === 'project') {
    return [
      `You are dmux's chat assistant for the project "${ctx.projectName}". You can answer questions about the codebase, brainstorm changes, and help the user draft a team proposal when they're ready to act.`,
      ``,
      `Conventions:`,
      `- Be concise. Default to 2–4 sentences. Bullet lists only for 3+ items.`,
      `- Cite real evidence from the context below. Don't invent files or behaviors you haven't seen.`,
      `- If the user is converging on an actionable plan, suggest they click "Convert to proposal" — don't try to plan the team yourself; dmux has a dedicated planner for that.`,
      `- If the user asks something off-topic from this project, redirect briefly.`,
      ``,
      `Project context:`,
      ``,
      `File tree (depth-limited):`,
      '```',
      ctx.fileTree || '(empty)',
      '```',
      ``,
      `CLAUDE.md:`,
      ctx.claudeMd ? '```\n' + ctx.claudeMd + '\n```' : '(none)',
      ``,
      `Current .dmux-agents.yml:`,
      ctx.agentsYaml ? '```yaml\n' + ctx.agentsYaml + '\n```' : '(none — no team currently configured)',
      ``,
      `Recent runs (newest first):`,
      ctx.recentRuns.length === 0
        ? '(none yet)'
        : ctx.recentRuns.map((r) => `- ${r.id} · ${r.status} · ${r.agent_count} agent${r.agent_count === 1 ? '' : 's'} · ${r.trigger}`).join('\n'),
    ].join('\n');
  }
  if (scope === 'global') {
    const projectLines = ctx.projects.length === 0
      ? '(none registered yet)'
      : ctx.projects
          .map((p) => `- ${p.name} (${p.path})${p.summary ? `\n    ${p.summary}` : ''}`)
          .join('\n');
    return [
      `You are dmux's global chat assistant. You know about the user's registered dmux projects (their names + paths + a one-line description per project where one's available). You do NOT have access to any project's file tree, code, or history — those live behind each project's own chat.`,
      ``,
      `Conventions:`,
      `- Be concise. Default to 2–4 sentences. Bullet lists only for 3+ items.`,
      `- For questions about a specific project's internals, suggest opening that project's chat (link in the navbar / Project Detail page).`,
      `- If the user is converging on an actionable plan for a specific project, suggest they click "Convert to proposal" — they'll pick which project to target.`,
      `- For cross-project brainstorming, you're the right surface. Help them think through priorities, naming, sequencing, etc.`,
      ``,
      `Registered projects:`,
      projectLines,
    ].join('\n');
  }
  throw new Error(`Unknown chat scope: ${scope}`);
}

export function buildProjectChatGreeting(projectName) {
  return `I know about ${projectName}. Ask me about the codebase, plan changes, or have me draft a proposal when you're ready.`;
}

/**
 * Global context envelope — Wave 3B Slice 2. The agent sees the project
 * registry (name + path + first line of CLAUDE.md per project) but no
 * file trees. For digging into a specific project the user is steered to
 * open that project's chat instead.
 */
export function buildGlobalChatContext() {
  let projects;
  try {
    projects = parseProjectsFile();
  } catch {
    projects = [];
  }
  return {
    projects: projects.map((p) => ({
      name: p.name,
      path: p.path,
      summary: firstLineOfClaudeMd(p.path),
    })),
  };
}

function firstLineOfClaudeMd(projectPath) {
  const path = join(projectPath, 'CLAUDE.md');
  const content = safeRead(path);
  if (!content) return null;
  // Skip a leading "# Title" heading; we want the descriptive line that
  // tells the user what this project is for.
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    if (line.startsWith('<!--')) continue;
    return line.slice(0, 200);
  }
  return null;
}

export function buildGlobalChatGreeting() {
  const ctx = buildGlobalChatContext();
  const n = ctx.projects.length;
  if (n === 0) {
    return `You haven't registered any dmux projects yet. Add one with \`dmux -a <name> <path>\` or use the Adopt button on the Dashboard. I can still chat — I just won't know about anything specific to act on.`;
  }
  const sample = ctx.projects.slice(0, 5).map((p) => p.name).join(', ');
  const more = n > 5 ? `, +${n - 5} more` : '';
  return `I know about ${n} project${n === 1 ? '' : 's'} you've registered: ${sample}${more}. Ask me anything across them, or open a project's chat for codebase-specific questions.`;
}

// ---------------------------------------------------------------------------
// Shell `claude --print` with the prompt on stdin
// ---------------------------------------------------------------------------

function execClaude(stdinText) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['--model', CHAT_MODEL, '--print'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, CHAT_TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        const e = new Error('`claude` CLI not found on PATH. Chat requires Claude Code installed (https://claude.com/claude-code).');
        e.status = 503;
        reject(e);
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        const e = new Error(`Chat timed out after ${CHAT_TIMEOUT_MS / 1000}s.`);
        e.status = 504;
        return reject(e);
      }
      if (code !== 0) {
        return reject(new Error(`claude exited ${code}: ${(stderr || stdout).slice(0, 500)}`));
      }
      resolve(stdout);
    });

    child.stdin.write(stdinText);
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// One chat turn (non-streaming)
// ---------------------------------------------------------------------------

/**
 * Drive one chat turn end-to-end: validate, append the user message,
 * assemble the conversation as a `claude --print` prompt, await the full
 * response, persist the assistant message. Returns the assistant message
 * for the route handler to JSON-respond with.
 *
 * Non-streaming by design (Claude Max subscription via `claude --print`
 * is the auth path; the SDK would have given us streaming but at the cost
 * of a second API key requirement — explicitly rejected, see wave-3b.md).
 */
export async function runProjectChatTurn(projectPath, projectName, userMessage, recentRuns) {
  if (typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    const e = new Error('message is required');
    e.status = 400;
    throw e;
  }

  const existing = readChat('project', projectPath);
  if (existing.messages.length >= HARD_CAP_MESSAGES) {
    const e = new Error(`Chat hard cap (${HARD_CAP_MESSAGES} messages) reached. Convert to a proposal or start a new chat.`);
    e.status = 429;
    throw e;
  }

  const trimmedUser = userMessage.trim();
  appendChatMessage('project', projectPath, {
    role: 'user',
    content: trimmedUser,
    ts: new Date().toISOString(),
  });

  const ctx = buildProjectChatContext(projectPath, projectName, recentRuns);
  const systemPrompt = buildSystemPrompt('project', ctx);
  const greeting = buildProjectChatGreeting(projectName);

  // Re-read so we include the just-appended user message.
  const stored = readChat('project', projectPath).messages;

  // Assemble the prompt: system + opener + full conversation transcript.
  // The final user message is included via the transcript; we don't repeat
  // it.
  const sections = [
    systemPrompt,
    ``,
    `Conversation so far:`,
    `Assistant (opener): ${greeting}`,
    ...stored.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`),
    ``,
    `Respond to the user's latest message in plain prose. Markdown OK; no fenced YAML or proposal configs — that's the planner's job.`,
  ];
  const prompt = sections.join('\n');

  const response = await execClaude(prompt);
  const assistantContent = (response ?? '').trim();
  if (!assistantContent) {
    throw new Error('Assistant returned an empty response. Try rephrasing.');
  }

  const assistantMessage = {
    role: 'assistant',
    content: assistantContent,
    ts: new Date().toISOString(),
  };
  const all = appendChatMessage('project', projectPath, assistantMessage);

  return {
    message: assistantMessage,
    count: all.length,
    nearLimit: all.length >= SOFT_CAP_MESSAGES,
    atHardCap: all.length >= HARD_CAP_MESSAGES,
  };
}

/**
 * dmux-global chat turn. Mirrors runProjectChatTurn but with the global
 * context envelope and the global system prompt. Storage lives at
 * ~/.config/dmux/chats/global.json (honors XDG_CONFIG_HOME).
 */
export async function runGlobalChatTurn(userMessage) {
  if (typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    const e = new Error('message is required');
    e.status = 400;
    throw e;
  }

  const existing = readChat('global', null);
  if (existing.messages.length >= HARD_CAP_MESSAGES) {
    const e = new Error(`Chat hard cap (${HARD_CAP_MESSAGES} messages) reached. Convert to a proposal or start a new chat.`);
    e.status = 429;
    throw e;
  }

  const trimmedUser = userMessage.trim();
  appendChatMessage('global', null, {
    role: 'user',
    content: trimmedUser,
    ts: new Date().toISOString(),
  });

  const ctx = buildGlobalChatContext();
  const systemPrompt = buildSystemPrompt('global', ctx);
  const greeting = buildGlobalChatGreeting();

  const stored = readChat('global', null).messages;

  const sections = [
    systemPrompt,
    ``,
    `Conversation so far:`,
    `Assistant (opener): ${greeting}`,
    ...stored.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`),
    ``,
    `Respond to the user's latest message in plain prose. Markdown OK; no fenced YAML or proposal configs — that's the planner's job.`,
  ];
  const prompt = sections.join('\n');

  const response = await execClaude(prompt);
  const assistantContent = (response ?? '').trim();
  if (!assistantContent) {
    throw new Error('Assistant returned an empty response. Try rephrasing.');
  }

  const assistantMessage = {
    role: 'assistant',
    content: assistantContent,
    ts: new Date().toISOString(),
  };
  const all = appendChatMessage('global', null, assistantMessage);

  return {
    message: assistantMessage,
    count: all.length,
    nearLimit: all.length >= SOFT_CAP_MESSAGES,
    atHardCap: all.length >= HARD_CAP_MESSAGES,
  };
}

export const CHAT_LIMITS = { soft: SOFT_CAP_MESSAGES, hard: HARD_CAP_MESSAGES };
