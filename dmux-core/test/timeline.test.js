import { describe, it, expect } from 'vitest';
import {
  parseTimelineEvent,
  readTimeline,
  TIMELINE_EVENT_TYPES,
} from '../src/timeline.js';

describe('parseTimelineEvent', () => {
  it('parses a well-formed event', () => {
    const line = JSON.stringify({
      ts: '2026-06-02T18:14:22.103Z',
      type: 'agent_started',
      agent: 'planner',
      summary: 'Agent planner started',
      data: {},
    });
    const r = parseTimelineEvent(line);
    expect(r.event).toEqual({
      ts: '2026-06-02T18:14:22.103Z',
      type: 'agent_started',
      agent: 'planner',
      summary: 'Agent planner started',
      data: {},
    });
  });

  it('treats missing agent as null', () => {
    const line = JSON.stringify({
      ts: '2026-06-02T18:14:22.103Z',
      type: 'run_started',
      summary: 'Run started',
    });
    const r = parseTimelineEvent(line);
    expect(r.event.agent).toBeNull();
    expect(r.event.data).toEqual({});
  });

  it('treats empty-string agent as null', () => {
    const line = JSON.stringify({
      ts: '2026-06-02T18:14:22.103Z',
      type: 'run_started',
      agent: '',
      summary: 'Run started',
    });
    expect(parseTimelineEvent(line).event.agent).toBeNull();
  });

  it('coerces non-object data to {}', () => {
    const line = JSON.stringify({
      ts: '2026-06-02T18:14:22.103Z',
      type: 't',
      summary: 's',
      data: 'not an object',
    });
    expect(parseTimelineEvent(line).event.data).toEqual({});
  });

  it('rejects malformed JSON', () => {
    expect(parseTimelineEvent('{ not json').error).toMatch(/JSON parse error/);
  });

  it('rejects missing ts', () => {
    const line = JSON.stringify({ type: 't', summary: 's' });
    expect(parseTimelineEvent(line).error).toMatch(/'ts'/);
  });

  it('rejects missing type', () => {
    const line = JSON.stringify({ ts: 'x', summary: 's' });
    expect(parseTimelineEvent(line).error).toMatch(/'type'/);
  });

  it('rejects missing summary', () => {
    const line = JSON.stringify({ ts: 'x', type: 't' });
    expect(parseTimelineEvent(line).error).toMatch(/'summary'/);
  });

  it('rejects arrays and non-objects', () => {
    expect(parseTimelineEvent('[]').error).toMatch(/must be a JSON object/);
    expect(parseTimelineEvent('"string"').error).toMatch(/must be a JSON object/);
  });

  it('rejects empty / non-string inputs', () => {
    expect(parseTimelineEvent('').error).toMatch(/empty/);
    expect(parseTimelineEvent(null).error).toBeDefined();
  });
});

describe('readTimeline', () => {
  it('parses multiple lines in order', () => {
    const text = [
      JSON.stringify({ ts: 't1', type: 'run_started', summary: 'run started' }),
      JSON.stringify({ ts: 't2', type: 'agent_started', agent: 'p', summary: 'planner started' }),
    ].join('\n');
    const r = readTimeline(text);
    expect(r.events).toHaveLength(2);
    expect(r.events[0].ts).toBe('t1');
    expect(r.events[1].agent).toBe('p');
    expect(r.malformedCount).toBe(0);
  });

  it('counts malformed lines and continues', () => {
    const text = [
      JSON.stringify({ ts: 't1', type: 'ok', summary: 'ok' }),
      '{ broken',
      '{ "ts": "t3" }',  // missing type + summary
      JSON.stringify({ ts: 't4', type: 'ok2', summary: 'ok2' }),
    ].join('\n');
    const r = readTimeline(text);
    expect(r.events).toHaveLength(2);
    expect(r.events[0].summary).toBe('ok');
    expect(r.events[1].summary).toBe('ok2');
    expect(r.malformedCount).toBe(2);
  });

  it('skips empty lines silently (not malformed)', () => {
    const text = JSON.stringify({ ts: 't', type: 'x', summary: 's' }) + '\n\n\n';
    const r = readTimeline(text);
    expect(r.events).toHaveLength(1);
    expect(r.malformedCount).toBe(0);
  });

  it('handles empty input', () => {
    expect(readTimeline('').events).toEqual([]);
    expect(readTimeline(null).events).toEqual([]);
  });
});

describe('TIMELINE_EVENT_TYPES', () => {
  it('is a frozen array of known types', () => {
    expect(TIMELINE_EVENT_TYPES).toContain('run_started');
    expect(TIMELINE_EVENT_TYPES).toContain('agent_started');
    expect(TIMELINE_EVENT_TYPES).toContain('run_completed');
    expect(Object.isFrozen(TIMELINE_EVENT_TYPES)).toBe(true);
  });
});
