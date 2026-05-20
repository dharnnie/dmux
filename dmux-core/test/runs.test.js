import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  newRunId,
  createRun,
  readRun,
  listRuns,
  listAllRuns,
  markRunCleaned,
  markRunCompleted,
} from '../src/runs.js';

let projectDir;
let projectDir2;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'dmux-runs-test-'));
  projectDir2 = mkdtempSync(join(tmpdir(), 'dmux-runs-test2-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(projectDir2, { recursive: true, force: true });
});

const sampleAgents = () => [
  { name: 'planner', role: 'plan', branch: '', depends_on: [] },
  { name: 'engineer', role: 'build', branch: 'feat/x', depends_on: ['planner'] },
  { name: 'reviewer', role: 'review', branch: '', depends_on: ['engineer'] },
];

const sampleYaml = `session: test
agents:
  - name: planner
    role: plan
    task: plan
  - name: engineer
    branch: feat/x
    task: build
    depends_on:
      - planner
  - name: reviewer
    role: review
    task: review
    depends_on:
      - engineer
`;

describe('newRunId', () => {
  it('is sortable and contains the timestamp', () => {
    const a = newRunId(new Date('2026-05-20T10:00:00Z'));
    const b = newRunId(new Date('2026-05-20T11:00:00Z'));
    expect(a < b).toBe(true);
    expect(a).toMatch(/^2026-05-20T100000-[a-f0-9]{6}$/);
  });

  it('two ids in the same second still differ (random suffix)', () => {
    const now = new Date();
    const ids = new Set(Array.from({ length: 50 }, () => newRunId(now)));
    expect(ids.size).toBe(50);
  });
});

describe('createRun / readRun', () => {
  it('round-trips a basic run', () => {
    const { id, dir, signalsDir } = createRun(projectDir, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
    });
    expect(existsSync(join(dir, 'run.json'))).toBe(true);
    expect(existsSync(signalsDir)).toBe(true);

    const run = readRun(projectDir, id);
    expect(run).not.toBeNull();
    expect(run.id).toBe(id);
    expect(run.config.yaml).toBe(sampleYaml);
    expect(run.config.agents).toHaveLength(3);
    expect(run.cleaned_at).toBeNull();
    expect(run.completed_at).toBeNull();
  });

  it('records trigger metadata', () => {
    const { id } = createRun(projectDir, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
      trigger: { type: 'skill', skill_name: 'tdd-feature' },
    });
    const run = readRun(projectDir, id);
    expect(run.trigger).toEqual({ type: 'skill', skill_name: 'tdd-feature' });
  });

  it('readRun returns null when run id is unknown', () => {
    expect(readRun(projectDir, 'no-such-run')).toBeNull();
  });
});

describe('agent status derivation', () => {
  it('initial state: first agent running, downstream waiting', () => {
    const { id } = createRun(projectDir, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
    });
    const run = readRun(projectDir, id);
    expect(run.agents[0].status).toBe('running'); // planner — no deps
    expect(run.agents[1].status).toBe('waiting'); // engineer — waits for planner
    expect(run.agents[2].status).toBe('waiting'); // reviewer — waits for engineer
    expect(run.status).toBe('running');
  });

  it('signal file with exit 0 → agent completed', () => {
    const { id, signalsDir } = createRun(projectDir, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
    });
    writeFileSync(join(signalsDir, 'planner.done'), '0');
    const run = readRun(projectDir, id);
    expect(run.agents[0].status).toBe('completed');
    expect(run.agents[0].exit_code).toBe(0);
    // Downstream agent's deps are now satisfied → running
    expect(run.agents[1].status).toBe('running');
    expect(run.agents[2].status).toBe('waiting');
  });

  it('signal file with non-zero exit → agent failed', () => {
    const { id, signalsDir } = createRun(projectDir, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
    });
    writeFileSync(join(signalsDir, 'planner.done'), '1');
    const run = readRun(projectDir, id);
    expect(run.agents[0].status).toBe('failed');
    expect(run.agents[0].exit_code).toBe(1);
    expect(run.status).toBe('failed');
  });

  it('all signals success → run status completed', () => {
    const { id, signalsDir } = createRun(projectDir, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
    });
    writeFileSync(join(signalsDir, 'planner.done'), '0');
    writeFileSync(join(signalsDir, 'engineer.done'), '0');
    writeFileSync(join(signalsDir, 'reviewer.done'), '0');
    const run = readRun(projectDir, id);
    expect(run.status).toBe('completed');
  });
});

describe('markRunCleaned / markRunCompleted', () => {
  it('markRunCleaned sets cleaned_at and surfaces cleaned status', () => {
    const { id } = createRun(projectDir, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
    });
    markRunCleaned(projectDir, id);
    const run = readRun(projectDir, id);
    expect(run.cleaned_at).toBeTruthy();
    expect(run.status).toBe('cleaned');
  });

  it('agents without signals become abandoned after cleanup', () => {
    const { id, signalsDir } = createRun(projectDir, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
    });
    writeFileSync(join(signalsDir, 'planner.done'), '0');
    markRunCleaned(projectDir, id);
    const run = readRun(projectDir, id);
    expect(run.agents[0].status).toBe('completed');   // had signal
    expect(run.agents[1].status).toBe('abandoned');   // no signal
    expect(run.agents[2].status).toBe('abandoned');
  });

  it('markRunCompleted is idempotent', () => {
    const { id } = createRun(projectDir, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
    });
    markRunCompleted(projectDir, id);
    const first = JSON.parse(
      readFileSync(join(projectDir, '.dmux/runs', id, 'run.json'), 'utf-8'),
    ).completed_at;
    markRunCompleted(projectDir, id);
    const second = JSON.parse(
      readFileSync(join(projectDir, '.dmux/runs', id, 'run.json'), 'utf-8'),
    ).completed_at;
    expect(first).toBe(second);
  });
});

describe('listRuns', () => {
  it('returns newest-first', async () => {
    const { id: oldId } = createRun(projectDir, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
      now: new Date('2026-05-19T10:00:00Z'),
    });
    const { id: newId } = createRun(projectDir, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
      now: new Date('2026-05-20T10:00:00Z'),
    });
    const runs = listRuns(projectDir);
    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe(newId);
    expect(runs[1].id).toBe(oldId);
  });

  it('returns empty list when .dmux/runs does not exist', () => {
    expect(listRuns(projectDir)).toEqual([]);
  });

  it('omits the frozen YAML body — list payload stays lightweight', () => {
    const { id } = createRun(projectDir, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
    });
    const [summary] = listRuns(projectDir);
    expect(summary.id).toBe(id);
    expect(summary).not.toHaveProperty('config');
    expect(summary.agent_count).toBe(3);
  });
});

describe('listAllRuns', () => {
  it('merges runs from multiple projects, newest first', () => {
    createRun(projectDir, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
      now: new Date('2026-05-19T10:00:00Z'),
    });
    createRun(projectDir2, {
      configYaml: sampleYaml,
      agentsSummary: sampleAgents(),
      now: new Date('2026-05-20T10:00:00Z'),
    });

    const merged = listAllRuns([
      { name: 'a', path: projectDir },
      { name: 'b', path: projectDir2 },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].project).toBe('b');
    expect(merged[1].project).toBe('a');
  });

  it('does not throw if a project path does not exist yet', () => {
    expect(() =>
      listAllRuns([
        { name: 'phantom', path: '/no/such/dir' },
      ]),
    ).not.toThrow();
  });
});
