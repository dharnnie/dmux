import { describe, it, expect } from 'vitest';
import { parseCatalogueManifest, CatalogueError } from '../src/catalogue.js';

describe('parseCatalogueManifest', () => {
  it('parses a well-formed manifest', () => {
    const yaml = `version: 1
skills:
  - name: react-tdd
    description: TDD-driven React component generation
    author: dharnnie
    tags: [react, tdd, frontend]
    raw_url: https://raw.githubusercontent.com/dharnnie/dmux-skills/main/react-tdd/skill.yml
  - name: go-api
    description: Scaffold a Go HTTP API
    raw_url: https://example.com/go-api/skill.yml
`;
    const result = parseCatalogueManifest(yaml);
    expect(result.version).toBe(1);
    expect(result.skills).toHaveLength(2);
    expect(result.skills[0]).toEqual({
      name: 'react-tdd',
      description: 'TDD-driven React component generation',
      author: 'dharnnie',
      tags: ['react', 'tdd', 'frontend'],
      raw_url: 'https://raw.githubusercontent.com/dharnnie/dmux-skills/main/react-tdd/skill.yml',
    });
    // Optional fields default
    expect(result.skills[1].author).toBeNull();
    expect(result.skills[1].tags).toEqual([]);
  });

  it('also accepts JSON (since YAML is a superset)', () => {
    const json = `{"version": 1, "skills": [{"name": "x", "description": "y", "raw_url": "https://e.com/x.yml"}]}`;
    const result = parseCatalogueManifest(json);
    expect(result.skills[0].name).toBe('x');
  });

  it('rejects empty input', () => {
    expect(() => parseCatalogueManifest('')).toThrow(CatalogueError);
    expect(() => parseCatalogueManifest('   ')).toThrow(/empty/);
  });

  it('rejects unsupported version', () => {
    const yaml = `version: 99\nskills: []`;
    expect(() => parseCatalogueManifest(yaml)).toThrow(/Unsupported manifest version/);
  });

  it('rejects non-array skills', () => {
    const yaml = `version: 1\nskills: not-array`;
    expect(() => parseCatalogueManifest(yaml)).toThrow(/'skills' must be an array/);
  });

  it("rejects names that aren't lowercase slugs", () => {
    const yaml = `version: 1
skills:
  - name: BadName
    description: x
    raw_url: https://e.com/x.yml
`;
    expect(() => parseCatalogueManifest(yaml)).toThrow(/'name' must be a lowercase slug/);
  });

  it('rejects missing description', () => {
    const yaml = `version: 1
skills:
  - name: react
    raw_url: https://e.com/x.yml
`;
    expect(() => parseCatalogueManifest(yaml)).toThrow(/'description' is required/);
  });

  it('rejects non-http raw_url', () => {
    const yaml = `version: 1
skills:
  - name: react
    description: x
    raw_url: file:///etc/passwd
`;
    expect(() => parseCatalogueManifest(yaml)).toThrow(/raw_url.*must be an http/);
  });

  it('rejects duplicate skill names', () => {
    const yaml = `version: 1
skills:
  - name: same
    description: a
    raw_url: https://e.com/a.yml
  - name: same
    description: b
    raw_url: https://e.com/b.yml
`;
    expect(() => parseCatalogueManifest(yaml)).toThrow(/Duplicate skill name/);
  });

  it('strips empty tags + non-string tags', () => {
    const yaml = `version: 1
skills:
  - name: x
    description: y
    raw_url: https://e.com/x.yml
    tags: ["ok", "", null, 42, "  spaced  "]
`;
    const result = parseCatalogueManifest(yaml);
    expect(result.skills[0].tags).toEqual(['ok', 'spaced']);
  });

  it('handles malformed YAML cleanly', () => {
    const yaml = `version: 1\n  - mismatched indentation`;
    expect(() => parseCatalogueManifest(yaml)).toThrow(CatalogueError);
  });

  it('rejects non-object top-level', () => {
    expect(() => parseCatalogueManifest('[1,2,3]')).toThrow(/must be an object/);
  });
});
