/**
 * Provider capability matrix — Wave 3C Slice 2.
 *
 * The single source of truth for what each agent-runner CLI supports.
 * Used by:
 *   - GET /api/providers — the UI reads this to populate the provider
 *     picker in the Customize panel and render the capability summary
 *     line.
 *   - docs/providers.md references the same constants when explaining
 *     how to add a new row.
 *
 * Adding a new provider:
 *   1. Add an entry here.
 *   2. Add cases to dmux.sh's provider_binary / provider_auto_accept_flag
 *      / provider_process_name.
 *   3. Extend dmux-core's VALID_PROVIDERS / VALID_MODELS_BY_PROVIDER /
 *      MODEL_ALIAS_PATTERNS.
 *   4. Run a real agent on the new provider end-to-end before shipping.
 *
 * Capabilities flagged here are the ones that meaningfully differ across
 * providers from dmux's perspective. Anything provider-agnostic (post-hoc
 * git-diff scope enforcement, signal files, changelog generation) is not
 * in the matrix — those work for any CLI that produces commits.
 */

export const PROVIDERS = [
  {
    name: 'claude',
    label: 'Claude (Anthropic)',
    binary: 'claude',
    models: ['opus', 'sonnet', 'haiku'],
    defaultModel: 'sonnet',
    capabilities: {
      autoAccept: true,           // --dangerously-skip-permissions
      perAgentModel: true,
      mcp: 'native',              // Claude Code has first-class MCP
    },
    notes: 'Default provider. dmux\'s own planner / discovery / chat also use this.',
  },
  {
    name: 'gemini',
    label: 'Gemini (Google)',
    binary: 'gemini',
    models: ['pro', 'flash'],
    defaultModel: 'pro',
    capabilities: {
      autoAccept: true,           // --yolo
      perAgentModel: true,
      mcp: 'preview',             // Gemini CLI's MCP support is in preview
    },
    notes: 'Requires the Gemini CLI to be installed and authed.',
  },
  // codex slot reserved — see docs/providers.md. Add when the OpenAI Codex
  // CLI lands as a verified end-to-end runner per Wave 3C's §4.8 decision.
];

export function getProviders() {
  return PROVIDERS;
}

export function getProvider(name) {
  return PROVIDERS.find((p) => p.name === name) ?? null;
}
