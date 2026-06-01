/**
 * MCP server catalogue — Wave 3D Slice 2.
 *
 * The static list of MCP servers dmux knows how to install via the UI. Each
 * entry tells the add-server modal which fields to render (credentials +
 * positional args) and tells the server how to build the .dmux/mcp.json
 * block when the user clicks Save.
 *
 * v1 ships github + filesystem. Add a third (Linear / Notion / Slack) by
 * appending one entry here — no other code changes needed.
 *
 * Entry shape:
 *   name             — slug used as the server's key in mcp.json
 *   label            — display string for the picker
 *   description      — short one-line description
 *   installCommand   — typically 'npx'
 *   installArgs      — fixed args prepended to argParams when launching
 *   requiredCredentials — [{ envKey, label, helpText, helpUrl? }]
 *   argParams        — [{ name, label, helpText, defaultValue }] —
 *                       positional args appended to installArgs at save
 */

export const MCP_CATALOGUE = [
  {
    name: 'github',
    label: 'GitHub',
    description: "Read repos, issues, PRs through Anthropic's official GitHub MCP server.",
    installCommand: 'npx',
    installArgs: ['-y', '@modelcontextprotocol/server-github'],
    requiredCredentials: [
      {
        envKey: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'Personal Access Token',
        helpText: 'A token with repo + issues access. dmux references the env var by name; you keep the actual secret out of the project.',
        helpUrl: 'https://github.com/settings/tokens',
      },
    ],
    argParams: [],
  },
  {
    name: 'filesystem',
    label: 'Filesystem',
    description: 'Sandboxed filesystem reads under a path you pick.',
    installCommand: 'npx',
    installArgs: ['-y', '@modelcontextprotocol/server-filesystem'],
    requiredCredentials: [],
    argParams: [
      {
        name: 'sandboxPath',
        label: 'Sandbox path',
        helpText: 'Agents will only see files under this path. Absolute paths recommended.',
        defaultValue: '',
      },
    ],
  },
];

export function getCatalogue() {
  return MCP_CATALOGUE;
}

export function getCatalogueEntry(name) {
  return MCP_CATALOGUE.find((e) => e.name === name) ?? null;
}
