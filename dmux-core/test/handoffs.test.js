import { describe, it, expect } from 'vitest';
import { parsePlanArtifact } from '../src/handoffs.js';

describe('parsePlanArtifact', () => {
  it('parses a well-formed plan with markdown + json appendix', () => {
    const md = `# Plan: Add OAuth

## Goal
Implement OAuth.

\`\`\`json
{
  "summary": "Add OAuth login",
  "tasks": [
    { "id": "1", "description": "Add User model", "files": ["src/models/user.js"] },
    { "id": "2", "description": "Add /auth/login", "files": ["src/routes/auth.js"] }
  ],
  "acceptanceCriteria": ["Login returns token", "Bad creds 401"]
}
\`\`\`
`;
    const result = parsePlanArtifact(md);
    expect(result.parseError).toBeUndefined();
    expect(result.structured.summary).toBe('Add OAuth login');
    expect(result.structured.tasks).toHaveLength(2);
    expect(result.structured.tasks[0]).toEqual({
      id: '1', description: 'Add User model', files: ['src/models/user.js'],
    });
    expect(result.structured.acceptanceCriteria).toEqual([
      'Login returns token', 'Bad creds 401',
    ]);
    expect(result.markdown).toBe(md);
  });

  it('picks the LAST fenced json block (agents may show examples earlier)', () => {
    const md = `# Plan

Here is an example of the kind of JSON tasks have:

\`\`\`json
{ "id": "example", "description": "example task" }
\`\`\`

The actual canonical plan is below:

\`\`\`json
{
  "summary": "Real plan",
  "tasks": [{ "description": "Do thing" }]
}
\`\`\`
`;
    const result = parsePlanArtifact(md);
    expect(result.structured.summary).toBe('Real plan');
    expect(result.structured.tasks).toHaveLength(1);
    expect(result.structured.tasks[0].description).toBe('Do thing');
  });

  it('defaults task id when missing', () => {
    const md = `# Plan
\`\`\`json
{
  "summary": "x",
  "tasks": [{"description": "first"}, {"description": "second"}]
}
\`\`\`
`;
    const r = parsePlanArtifact(md);
    expect(r.structured.tasks[0].id).toBe('1');
    expect(r.structured.tasks[1].id).toBe('2');
  });

  it('defaults files to [] when missing or wrong type', () => {
    const md = `# Plan
\`\`\`json
{
  "summary": "x",
  "tasks": [
    {"description": "a"},
    {"description": "b", "files": "src/x.js"}
  ]
}
\`\`\`
`;
    const r = parsePlanArtifact(md);
    expect(r.structured.tasks[0].files).toEqual([]);
    expect(r.structured.tasks[1].files).toEqual([]);
  });

  it('drops tasks without a description', () => {
    const md = `# Plan
\`\`\`json
{
  "summary": "x",
  "tasks": [
    {"description": "kept"},
    {},
    {"description": ""}
  ]
}
\`\`\`
`;
    const r = parsePlanArtifact(md);
    expect(r.structured.tasks).toHaveLength(1);
    expect(r.structured.tasks[0].description).toBe('kept');
  });

  it('returns parseError when no json block present', () => {
    const md = `# Plan: no appendix\n\nJust prose.`;
    const r = parsePlanArtifact(md);
    expect(r.structured).toBeNull();
    expect(r.parseError).toMatch(/no fenced/);
    expect(r.markdown).toBe(md);  // markdown still preserved
  });

  it('returns parseError when json is malformed', () => {
    const md = `# Plan
\`\`\`json
{ broken: not-valid-json
\`\`\`
`;
    const r = parsePlanArtifact(md);
    expect(r.structured).toBeNull();
    expect(r.parseError).toMatch(/JSON parse error/);
    expect(r.markdown).toBe(md);
  });

  it('returns parseError when summary is missing', () => {
    const md = `# Plan
\`\`\`json
{
  "tasks": [{"description": "x"}]
}
\`\`\`
`;
    const r = parsePlanArtifact(md);
    expect(r.structured).toBeNull();
    expect(r.parseError).toMatch(/does not match plan schema/);
  });

  it('returns parseError when tasks array is empty after filtering', () => {
    const md = `# Plan
\`\`\`json
{
  "summary": "x",
  "tasks": [{}, {"foo": "bar"}]
}
\`\`\`
`;
    const r = parsePlanArtifact(md);
    expect(r.structured).toBeNull();
  });

  it('handles non-string input cleanly', () => {
    const r = parsePlanArtifact(null);
    expect(r.structured).toBeNull();
    expect(r.parseError).toBeDefined();
  });

  it('ignores acceptanceCriteria when wrong shape', () => {
    const md = `# Plan
\`\`\`json
{
  "summary": "x",
  "tasks": [{"description": "a"}],
  "acceptanceCriteria": "should be array"
}
\`\`\`
`;
    const r = parsePlanArtifact(md);
    expect(r.structured.acceptanceCriteria).toEqual([]);
  });
});
