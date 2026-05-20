import { describe, it, expect } from 'vitest';
import { parseAgentsConfig, ConfigError, MODELS_BY_PROVIDER } from '../src/config.js';

describe('parseAgentsConfig', () => {
  describe('minimal valid config', () => {
    it('parses a single-agent config with defaults filled in', () => {
      const yaml = `
session: my-agents
agents:
  - name: auth
    task: implement auth
`;
      const config = parseAgentsConfig(yaml);
      expect(config.session).toBe('my-agents');
      expect(config.worktree_base).toBe('..');
      expect(config.main_pane).toBe(true);
      expect(config.namespace_branches).toBe(false);
      expect(config.notifications).toBe(true);
      expect(config.provider).toBe('claude');
      expect(config.on_complete).toEqual([]);
      expect(config.agents).toHaveLength(1);

      const agent = config.agents[0];
      expect(agent.name).toBe('auth');
      expect(agent.role).toBe('build');
      expect(agent.branch).toBe('');
      expect(agent.task).toBe('implement auth');
      expect(agent.provider).toBe(null);
      expect(agent.auto_accept).toBe(false);
      expect(agent.scope).toEqual([]);
      expect(agent.context).toEqual([]);
      expect(agent.depends_on).toEqual([]);
      expect(agent.on_complete).toBe(null); // null = inherit global
    });
  });

  describe('example-style config (matches dmux-agents.example.yml)', () => {
    it('parses the full example shape correctly', () => {
      const yaml = `
session: my-api-agents
worktree_base: ..
main_pane: true

agents:
  - name: auth
    branch: feature/auth
    task: "implement JWT authentication with refresh tokens"
    scope:
      - src/auth/
      - src/middleware/auth.ts
    context:
      - src/types/
  - name: catalog
    branch: feature/catalog
    task: "build product listing API"
  - name: reviewer
    role: review
    task: "review changes"
    depends_on:
      - auth
      - catalog
`;
      const config = parseAgentsConfig(yaml);
      expect(config.agents).toHaveLength(3);

      const auth = config.agents[0];
      expect(auth.name).toBe('auth');
      expect(auth.scope).toEqual(['src/auth/', 'src/middleware/auth.ts']);
      expect(auth.context).toEqual(['src/types/']);

      const reviewer = config.agents[2];
      expect(reviewer.role).toBe('review');
      expect(reviewer.depends_on).toEqual(['auth', 'catalog']);
    });
  });

  describe('roles', () => {
    it('accepts plan, build, and review', () => {
      for (const role of ['plan', 'build', 'review']) {
        const yaml = `
session: s
agents:
  - name: a
    role: ${role}
    task: t
`;
        expect(parseAgentsConfig(yaml).agents[0].role).toBe(role);
      }
    });

    it('rejects unknown roles', () => {
      const yaml = `
session: s
agents:
  - name: a
    role: orchestrator
    task: t
`;
      expect(() => parseAgentsConfig(yaml)).toThrow(/must be one of/);
    });
  });

  describe('on_complete', () => {
    it('accepts global on_complete as a list', () => {
      const yaml = `
session: s
on_complete:
  - test
  - push
agents:
  - name: a
    task: t
`;
      expect(parseAgentsConfig(yaml).on_complete).toEqual(['test', 'push']);
    });

    it('accepts per-agent on_complete as override', () => {
      const yaml = `
session: s
on_complete:
  - test
agents:
  - name: a
    task: t
    on_complete:
      - pr
`;
      const config = parseAgentsConfig(yaml);
      expect(config.on_complete).toEqual(['test']);
      expect(config.agents[0].on_complete).toEqual(['pr']);
    });

    it('agent.on_complete is null when not set (signals inherit-global)', () => {
      const yaml = `
session: s
on_complete:
  - test
agents:
  - name: a
    task: t
`;
      expect(parseAgentsConfig(yaml).agents[0].on_complete).toBe(null);
    });

    it('rejects unknown on_complete shorthands', () => {
      const yaml = `
session: s
on_complete:
  - deploy
agents:
  - name: a
    task: t
`;
      expect(() => parseAgentsConfig(yaml)).toThrow(/must be in/);
    });
  });

  describe('model', () => {
    it('defaults model to null when unset (inherit provider default)', () => {
      const yaml = `
session: s
agents:
  - name: a
    task: t
`;
      expect(parseAgentsConfig(yaml).agents[0].model).toBe(null);
    });

    it('accepts valid claude models', () => {
      for (const model of ['opus', 'sonnet', 'haiku']) {
        const yaml = `
session: s
agents:
  - name: a
    task: t
    model: ${model}
`;
        expect(parseAgentsConfig(yaml).agents[0].model).toBe(model);
      }
    });

    it('accepts valid gemini models when agent provider is gemini', () => {
      for (const model of ['pro', 'flash']) {
        const yaml = `
session: s
agents:
  - name: a
    task: t
    provider: gemini
    model: ${model}
`;
        expect(parseAgentsConfig(yaml).agents[0].model).toBe(model);
      }
    });

    it('rejects model that does not match the agent provider', () => {
      // opus is claude-only; not valid for a gemini agent.
      const yaml = `
session: s
agents:
  - name: a
    task: t
    provider: gemini
    model: opus
`;
      expect(() => parseAgentsConfig(yaml)).toThrow(/must be one of \(gemini\)/);
    });

    it('rejects model that does not match the top-level provider when agent provider is unset', () => {
      const yaml = `
session: s
provider: gemini
agents:
  - name: a
    task: t
    model: opus
`;
      expect(() => parseAgentsConfig(yaml)).toThrow(/must be one of \(gemini\)/);
    });

    it('exposes MODELS_BY_PROVIDER for UI consumption', () => {
      expect(MODELS_BY_PROVIDER.claude).toEqual(['opus', 'sonnet', 'haiku']);
      expect(MODELS_BY_PROVIDER.gemini).toEqual(['pro', 'flash']);
    });

    it('rejects unknown model strings even when provider is valid', () => {
      const yaml = `
session: s
agents:
  - name: a
    task: t
    model: turbo-3000
`;
      expect(() => parseAgentsConfig(yaml)).toThrow(/must be one of/);
    });
  });

  describe('providers', () => {
    it('defaults global provider to claude', () => {
      const yaml = `
session: s
agents:
  - name: a
    task: t
`;
      expect(parseAgentsConfig(yaml).provider).toBe('claude');
    });

    it('accepts gemini and claude', () => {
      const yaml = `
session: s
provider: gemini
agents:
  - name: a
    task: t
    provider: claude
`;
      const config = parseAgentsConfig(yaml);
      expect(config.provider).toBe('gemini');
      expect(config.agents[0].provider).toBe('claude');
    });

    it('rejects unknown providers', () => {
      const yaml = `
session: s
provider: openai
agents:
  - name: a
    task: t
`;
      expect(() => parseAgentsConfig(yaml)).toThrow(/must be one of/);
    });
  });

  describe('lists', () => {
    it('accepts list form for scope/context/depends_on', () => {
      const yaml = `
session: s
agents:
  - name: a
    task: t
    scope:
      - src/a/
      - src/b/
`;
      expect(parseAgentsConfig(yaml).agents[0].scope).toEqual(['src/a/', 'src/b/']);
    });

    it('accepts inline comma-separated form as a convenience', () => {
      const yaml = `
session: s
agents:
  - name: a
    task: t
    scope: "src/a/, src/b/"
`;
      expect(parseAgentsConfig(yaml).agents[0].scope).toEqual(['src/a/', 'src/b/']);
    });
  });

  describe('dependency validation', () => {
    it('rejects depends_on referencing a missing agent', () => {
      const yaml = `
session: s
agents:
  - name: a
    task: t
    depends_on:
      - ghost
`;
      expect(() => parseAgentsConfig(yaml)).toThrow(/unknown agent 'ghost'/);
    });

    it('rejects self-dependency', () => {
      const yaml = `
session: s
agents:
  - name: a
    task: t
    depends_on:
      - a
`;
      expect(() => parseAgentsConfig(yaml)).toThrow(/cannot depend on itself/);
    });

    it('rejects cycles', () => {
      const yaml = `
session: s
agents:
  - name: a
    task: t
    depends_on:
      - b
  - name: b
    task: t
    depends_on:
      - a
`;
      expect(() => parseAgentsConfig(yaml)).toThrow(/Dependency cycle detected/);
    });

    it('rejects duplicate agent names', () => {
      const yaml = `
session: s
agents:
  - name: a
    task: t
  - name: a
    task: t
`;
      expect(() => parseAgentsConfig(yaml)).toThrow(/Duplicate agent name/);
    });
  });

  describe('required fields', () => {
    it('throws if session is missing', () => {
      const yaml = `
agents:
  - name: a
    task: t
`;
      expect(() => parseAgentsConfig(yaml)).toThrow(/'session' is required/);
    });

    it('throws if agents is missing or empty', () => {
      expect(() => parseAgentsConfig('session: s\n')).toThrow(/non-empty list/);
      expect(() => parseAgentsConfig('session: s\nagents: []\n')).toThrow(/non-empty list/);
    });

    it('throws if an agent has no name', () => {
      const yaml = `
session: s
agents:
  - task: t
`;
      expect(() => parseAgentsConfig(yaml)).toThrow(/'name' is required/);
    });
  });

  describe('error shape', () => {
    it('exposes field and agent on ConfigError', () => {
      const yaml = `
session: s
agents:
  - name: a
    role: bogus
    task: t
`;
      try {
        parseAgentsConfig(yaml);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        expect(e.field).toBe('role');
        expect(e.agent).toBe('a');
      }
    });
  });
});
