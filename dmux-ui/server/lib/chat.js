/**
 * Wave 3B chat — project-scoped (this slice) and dmux-global (Slice 2).
 *
 * This module is intentionally separate from lib/dmux.js because:
 *   - It uses the Anthropic SDK directly (not `claude --print`), and that
 *     dispatch shape doesn't belong with the rest of dmux's dmux.sh
 *     bridging.
 *   - It needs to stream SSE responses to the client; the rest of the
 *     server's handlers are JSON-shaped.
 *   - lib/dmux.js is already large.
 *
 * Wave 2D's per-proposal chat stays in lib/dmux.js and continues to use
 * `claude --print` — two chat backends coexist by design (per wave-3b.md
 * §5.3).
 */

import Anthropic from '@anthropic-ai/sdk';
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

const CHAT_MODEL = 'claude-sonnet-4-5-20250929'; // SDK requires fully-qualified ids
const CHAT_MAX_TOKENS = 4096;
const SOFT_CAP_MESSAGES = 50;
const HARD_CAP_MESSAGES = 100;

let _anthropicClient = null;

/**
 * Lazy-init the Anthropic SDK client. Throws an error with status=503 if
 * ANTHROPIC_API_KEY isn't set — chat is opt-in; the rest of dmux works
 * without it.
 */
export function getAnthropicClient() {
  if (_anthropicClient) return _anthropicClient;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const e = new Error(
      'Chat requires ANTHROPIC_API_KEY. Set it in the shell that runs `dmux ui`.',
    );
    e.status = 503;
    throw e;
  }
  _anthropicClient = new Anthropic({ apiKey: key });
  return _anthropicClient;
}

/** Convenience: lets the UI render a friendly missing-key panel. */
export function hasAnthropicKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

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
 * Project context envelope: file tree, CLAUDE.md, current .dmux-agents.yml,
 * recent run summaries. Assembled fresh each turn so changes to the project
 * since the chat started are reflected.
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
    // Implemented in Slice 2.
    return `You are dmux's global chat assistant.`;
  }
  throw new Error(`Unknown chat scope: ${scope}`);
}

export function buildProjectChatGreeting(projectName) {
  return `I know about ${projectName}. Ask me about the codebase, plan changes, or have me draft a proposal when you're ready.`;
}

// ---------------------------------------------------------------------------
// Streaming chat turn
// ---------------------------------------------------------------------------

/**
 * Drive one chat turn end-to-end: append the user message, open an SSE
 * response on `res`, stream Anthropic's response back as text-delta events,
 * persist the assistant's full message on stream end.
 *
 * SSE event shapes:
 *   data: {"type":"delta","text":"..."}\n\n
 *   data: {"type":"done","count":N}\n\n
 *   data: {"type":"error","message":"..."}\n\n
 */
export async function streamProjectChatTurn(projectPath, projectName, userMessage, recentRuns, res) {
  if (typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  let client;
  try {
    client = getAnthropicClient();
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
    return;
  }

  const existing = readChat('project', projectPath);
  if (existing.messages.length >= HARD_CAP_MESSAGES) {
    res.status(429).json({
      error: `Chat hard cap (${HARD_CAP_MESSAGES} messages) reached. Convert to a proposal or start a new chat.`,
    });
    return;
  }

  const trimmedUser = userMessage.trim();
  appendChatMessage('project', projectPath, {
    role: 'user',
    content: trimmedUser,
    ts: new Date().toISOString(),
  });

  const ctx = buildProjectChatContext(projectPath, projectName, recentRuns);
  const systemPrompt = buildSystemPrompt('project', ctx);

  // Convert stored messages (now including the new user message) into the
  // SDK's expected shape. We tolerate the legacy shape from Wave 2D-style
  // messages (also {role, content}).
  const stored = readChat('project', projectPath).messages;
  const sdkMessages = stored.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));

  // Open SSE stream.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Disable buffering for nginx proxies (no-op locally).
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  let assistantText = '';
  try {
    const stream = client.messages.stream({
      model: CHAT_MODEL,
      max_tokens: CHAT_MAX_TOKENS,
      system: [
        // Wave 3B v1 caches just the system prompt. First-N-turns caching is
        // a Wave 4 optimization.
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      messages: sdkMessages,
    });

    stream.on('text', (text) => {
      assistantText += text;
      send({ type: 'delta', text });
    });

    await stream.finalMessage();
  } catch (e) {
    const msg = e?.message ?? String(e);
    send({ type: 'error', message: msg });
    res.end();
    return;
  }

  if (assistantText.length === 0) {
    send({ type: 'error', message: 'Assistant returned an empty response. Try rephrasing.' });
    res.end();
    return;
  }

  appendChatMessage('project', projectPath, {
    role: 'assistant',
    content: assistantText,
    ts: new Date().toISOString(),
  });

  const count = stored.length + 1;
  send({ type: 'done', count, nearLimit: count >= SOFT_CAP_MESSAGES });
  res.end();
}

export const CHAT_LIMITS = { soft: SOFT_CAP_MESSAGES, hard: HARD_CAP_MESSAGES };
