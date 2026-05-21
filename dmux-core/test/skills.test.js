import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { parseSkillYaml, applyInputs, SkillSchemaError } from '../src/skills.js';

const baseSkill = `
name: tdd-feature
description: TDD pipeline for a single feature
tags: [tdd, build]
provider: claude
inputs:
  - name: feature_name
    type: text
    description: Short feature name
    required: true
  - name: files_in_scope
    type: paths
    description: Files the engineer may modify
  - name: with_review
    type: boolean
    default: true
agents:
  - name: planner
    role: plan
    task: "Plan {{feature_name}} for {{project_name}}."
    model: sonnet
  - name: engineer
    branch: feature/{{feature_name}}
    task: "Implement {{feature_name}} per the plan."
    scope: "{{files_in_scope}}"
    depends_on: [planner]
`;

describe('parseSkillYaml', () => {
  it('parses a full skill with inputs', () => {
    const skill = parseSkillYaml(baseSkill);
    expect(skill.name).toBe('tdd-feature');
    expect(skill.description).toBe('TDD pipeline for a single feature');
    expect(skill.tags).toEqual(['tdd', 'build']);
    expect(skill.provider).toBe('claude');
    expect(skill.inputs).toHaveLength(3);
    expect(skill.inputs[0]).toMatchObject({
      name: 'feature_name',
      type: 'text',
      required: true,
    });
    expect(skill.inputs[2]).toMatchObject({
      name: 'with_review',
      type: 'boolean',
      default: true,
    });
    expect(skill.agents).toHaveLength(2);
    expect(skill.rawYaml).toBe(baseSkill);
  });

  it('parses a skill with no inputs (backward compat)', () => {
    const skill = parseSkillYaml(`
name: code-review
agents:
  - name: reviewer
    role: review
    task: Review.
`);
    expect(skill.inputs).toEqual([]);
  });

  it('rejects skill with no name', () => {
    expect(() => parseSkillYaml(`agents: [{ name: a, task: t }]`)).toThrow(/name.*required/i);
  });

  it('rejects skill with no agents', () => {
    expect(() => parseSkillYaml(`name: x`)).toThrow(/at least one agent/);
  });

  it('rejects unknown input type', () => {
    expect(() =>
      parseSkillYaml(`
name: x
inputs:
  - name: foo
    type: nonsense
agents:
  - name: a
    task: t
`),
    ).toThrow(/unknown type/);
  });

  it('rejects reserved input name', () => {
    expect(() =>
      parseSkillYaml(`
name: x
inputs:
  - name: project_name
    type: text
agents:
  - name: a
    task: t
`),
    ).toThrow(/reserved/);
  });

  it('rejects duplicate input names', () => {
    expect(() =>
      parseSkillYaml(`
name: x
inputs:
  - name: foo
    type: text
  - name: foo
    type: text
agents:
  - name: a
    task: t
`),
    ).toThrow(/duplicate/i);
  });

  it('rejects select input without choices', () => {
    expect(() =>
      parseSkillYaml(`
name: x
inputs:
  - name: env
    type: select
agents:
  - name: a
    task: t
`),
    ).toThrow(/non-empty .choices/);
  });
});

describe('applyInputs — embedded substitution', () => {
  it('substitutes embedded placeholders in string fields', () => {
    const skill = parseSkillYaml(baseSkill);
    const out = applyInputs(skill, {
      feature_name: 'oauth',
      files_in_scope: ['src/auth/'],
    }, { project_name: 'dmux' });
    const parsed = yaml.load(out);
    expect(parsed[0].task).toBe('Plan oauth for dmux.');
    expect(parsed[1].branch).toBe('feature/oauth');
    expect(parsed[1].task).toBe('Implement oauth per the plan.');
  });

  it('stringifies lists as comma-separated in embedded substitution', () => {
    const skill = parseSkillYaml(`
name: t
inputs:
  - name: paths
    type: paths
agents:
  - name: a
    task: "Watch: {{paths}}"
`);
    const out = applyInputs(skill, { paths: ['src/a/', 'src/b/'] });
    expect(yaml.load(out)[0].task).toBe('Watch: src/a/, src/b/');
  });

  it('stringifies booleans as true/false in embedded substitution', () => {
    const skill = parseSkillYaml(`
name: t
inputs:
  - name: flag
    type: boolean
    default: true
agents:
  - name: a
    task: "Flag={{flag}}"
`);
    const out = applyInputs(skill, {});
    expect(yaml.load(out)[0].task).toBe('Flag=true');
  });
});

describe('applyInputs — whole-string placeholders expand natively', () => {
  it('expands a paths input as a YAML list', () => {
    const skill = parseSkillYaml(baseSkill);
    const out = applyInputs(skill, {
      feature_name: 'oauth',
      files_in_scope: ['src/auth/', 'src/middleware/'],
    }, { project_name: 'dmux' });
    const parsed = yaml.load(out);
    expect(parsed[1].scope).toEqual(['src/auth/', 'src/middleware/']);
  });

  it('expands a boolean input as a YAML boolean', () => {
    const skill = parseSkillYaml(`
name: t
inputs:
  - name: flag
    type: boolean
    default: true
agents:
  - name: a
    auto_accept: "{{flag}}"
    task: t
`);
    const out = applyInputs(skill, {});
    expect(yaml.load(out)[0].auto_accept).toBe(true);
  });
});

describe('applyInputs — defaults + required', () => {
  it('uses defaults when value not provided', () => {
    const skill = parseSkillYaml(baseSkill);
    const out = applyInputs(skill, {
      feature_name: 'oauth',
    }, { project_name: 'dmux' });
    // files_in_scope has no default → empty list; with_review default true
    expect(yaml.load(out)[1].scope).toEqual([]);
  });

  it('throws when a required input is missing', () => {
    const skill = parseSkillYaml(baseSkill);
    expect(() => applyInputs(skill, {}, { project_name: 'dmux' })).toThrow(/Required input/);
  });

  it('coerces string-csv to array for paths', () => {
    const skill = parseSkillYaml(baseSkill);
    const out = applyInputs(skill, {
      feature_name: 'oauth',
      files_in_scope: 'src/a/, src/b/',
    }, { project_name: 'dmux' });
    expect(yaml.load(out)[1].scope).toEqual(['src/a/', 'src/b/']);
  });
});

describe('applyInputs — error surfaces', () => {
  it('throws on unknown placeholder', () => {
    const skill = parseSkillYaml(`
name: t
agents:
  - name: a
    task: "Look at {{undeclared}}"
`);
    expect(() => applyInputs(skill, {})).toThrow(/unknown placeholder/);
  });

  it('throws on reserved placeholder use without context', () => {
    // {{project_name}} is reserved — if context doesn't supply it, error.
    const skill = parseSkillYaml(`
name: t
agents:
  - name: a
    task: "Work on {{project_name}}"
`);
    expect(() => applyInputs(skill, {})).toThrow(/has no value/);
  });

  it('SkillSchemaError carries input + field context', () => {
    const skill = parseSkillYaml(baseSkill);
    try {
      applyInputs(skill, {}, { project_name: 'dmux' });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SkillSchemaError);
      expect(e.input).toBe('feature_name');
    }
  });
});

describe('reserved placeholders', () => {
  it('{{project_name}} substitutes from ctx', () => {
    const skill = parseSkillYaml(`
name: t
agents:
  - name: a
    task: "Working on {{project_name}}"
`);
    const out = applyInputs(skill, {}, { project_name: 'my-api' });
    expect(yaml.load(out)[0].task).toBe('Working on my-api');
  });
});
