import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import useAgentStatus from '../hooks/useAgentStatus';
import StatusTable from '../components/StatusTable';
import AgentCardEditor from '../components/AgentCardEditor';
import Card, { CardTitle } from '../components/Card';
import Disclosure from '../components/Disclosure';
import Button from '../components/Button';
import Checkbox from '../components/Checkbox';
import { Input } from '../components/Field';
import { useToast } from '../components/Toasts';
import styles from './AgentSession.module.css';

// ---------------- shape + serialization ----------------

const EMPTY_AGENT = () => ({
  name: '',
  branch: '',
  task: '',
  role: 'build',
  provider: '',
  model: '',
  auto_accept: false,
  depends_on: [],
  scope: [],
  context: [],
  on_complete: { test: false, push: false, pr: false },
});

const DEFAULT_CONFIG = () => ({
  session: '',
  worktree_base: '..',
  main_pane: true,
  namespace_branches: false,
  provider: 'claude',
  on_complete: { test: false, push: false, pr: false },
  agents: [],
});

function ocObjToList(o) {
  const list = [];
  if (o?.test) list.push('test');
  if (o?.push) list.push('push');
  if (o?.pr) list.push('pr');
  return list;
}

function ocListToObj(list) {
  return {
    test: list?.includes('test') ?? false,
    push: list?.includes('push') ?? false,
    pr: list?.includes('pr') ?? false,
  };
}

function configToYaml(c) {
  let y = `session: ${c.session || 'my-agents'}\n`;
  y += `worktree_base: ${c.worktree_base || '..'}\n`;
  y += `main_pane: ${c.main_pane}\n`;
  if (c.namespace_branches) y += `namespace_branches: true\n`;
  if (c.provider && c.provider !== 'claude') y += `provider: ${c.provider}\n`;

  const globalOc = ocObjToList(c.on_complete);
  if (globalOc.length > 0) {
    y += `on_complete:\n`;
    for (const item of globalOc) y += `  - ${item}\n`;
  }

  y += `\nagents:\n`;
  for (const a of c.agents) {
    if (!a.name) continue;
    y += `  - name: ${a.name}\n`;
    if (a.role !== 'build') y += `    role: ${a.role}\n`;
    if (a.role === 'build' && a.branch) y += `    branch: ${a.branch}\n`;
    if (a.task) y += `    task: ${JSON.stringify(a.task)}\n`;
    if (a.provider) y += `    provider: ${a.provider}\n`;
    if (a.model) y += `    model: ${a.model}\n`;
    if (a.auto_accept) y += `    auto_accept: true\n`;
    if (a.depends_on?.length > 0) {
      y += `    depends_on:\n`;
      for (const d of a.depends_on) y += `      - ${d}\n`;
    }
    if (a.scope?.length > 0) {
      y += `    scope:\n`;
      for (const s of a.scope) y += `      - ${s}\n`;
    }
    if (a.context?.length > 0) {
      y += `    context:\n`;
      for (const ctx of a.context) y += `      - ${ctx}\n`;
    }
    const oc = ocObjToList(a.on_complete);
    if (oc.length > 0) {
      y += `    on_complete:\n`;
      for (const item of oc) y += `      - ${item}\n`;
    }
  }
  return y;
}

function parsedConfigToFormState(parsed) {
  return {
    session: parsed.session,
    worktree_base: parsed.worktree_base,
    main_pane: parsed.main_pane,
    namespace_branches: parsed.namespace_branches,
    provider: parsed.provider || 'claude',
    on_complete: ocListToObj(parsed.on_complete),
    agents: parsed.agents.map((a) => ({
      name: a.name,
      branch: a.branch || '',
      task: a.task || '',
      role: a.role,
      provider: a.provider || '',
      model: a.model || '',
      auto_accept: a.auto_accept,
      depends_on: a.depends_on ?? [],
      scope: a.scope ?? [],
      context: a.context ?? [],
      // null on the parsed side = inherit; render as all-false
      on_complete: ocListToObj(a.on_complete ?? []),
    })),
  };
}

// ---------------- dependency layers ----------------

function computeLayers(agents) {
  const names = new Set(agents.map((a) => a.name).filter(Boolean));
  const depMap = new Map(
    agents.map((a) => [a.name, (a.depends_on ?? []).filter((d) => names.has(d))]),
  );
  const depth = new Map();

  const getDepth = (name, stack = new Set()) => {
    if (depth.has(name)) return depth.get(name);
    if (stack.has(name)) return 0; // cycle protection — surface as layer 0
    stack.add(name);
    const deps = depMap.get(name) ?? [];
    const d = deps.length === 0 ? 0 : Math.max(...deps.map((dep) => getDepth(dep, stack) + 1));
    depth.set(name, d);
    stack.delete(name);
    return d;
  };

  agents.forEach((a) => a.name && getDepth(a.name));

  const grouped = new Map();
  agents.forEach((a) => {
    if (!a.name) return;
    const d = depth.get(a.name) ?? 0;
    if (!grouped.has(d)) grouped.set(d, []);
    grouped.get(d).push(a);
  });

  return [...grouped.entries()].sort(([a], [b]) => a - b).map(([d, list]) => ({ depth: d, agents: list }));
}

// ---------------- the page ----------------

export default function AgentSession() {
  const { name } = useParams();
  const toast = useToast();
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(DEFAULT_CONFIG); // last-saved snapshot for Discard
  const [showYaml, setShowYaml] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [validationError, setValidationError] = useState(null);
  const [saving, setSaving] = useState(false);
  const agentStatus = useAgentStatus(name);

  useEffect(() => {
    fetch(`/api/projects/${name}/agents-config-parsed`)
      .then(async (r) => {
        if (r.ok) {
          const parsed = await r.json();
          const form = parsedConfigToFormState(parsed);
          setConfig(form);
          setSaved(form);
          return;
        }
        if (r.status === 404) {
          const fresh = { ...DEFAULT_CONFIG(), session: `${name}-agents` };
          setConfig(fresh);
          setSaved(fresh);
          return;
        }
        if (r.status === 422) {
          const body = await r.json();
          setValidationError({ ...body, scope: 'load' });
        }
      })
      .catch((e) => toast(`Couldn't load config: ${e.message}`, 'error'));

    fetch(`/api/projects/${name}/agents/status`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.output && !data.output.includes('not running')) {
          setIsRunning(true);
        }
      })
      .catch(() => {});
  }, [name]);

  const yaml = useMemo(() => configToYaml(config), [config]);
  const layers = useMemo(() => computeLayers(config.agents), [config.agents]);
  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(saved), [config, saved]);
  const agentNames = useMemo(() => config.agents.map((a) => a.name), [config.agents]);

  // ---------------- handlers ----------------

  const updateAgent = (idx, next) => {
    const agents = [...config.agents];
    agents[idx] = next;
    setConfig({ ...config, agents });
  };

  const addAgent = () => {
    setConfig({ ...config, agents: [...config.agents, EMPTY_AGENT()] });
  };

  const removeAgent = (idx) => {
    const agents = config.agents.filter((_, i) => i !== idx);
    setConfig({ ...config, agents });
  };

  const handleDiscard = () => {
    if (!dirty) return;
    if (!confirm('Discard all unsaved changes?')) return;
    setConfig(saved);
    setValidationError(null);
  };

  const save = async ({ andRun = false } = {}) => {
    setSaving(true);
    setValidationError(null);
    try {
      const writeRes = await fetch(`/api/projects/${name}/agents-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: yaml,
      });
      const writeData = await writeRes.json();
      if (!writeData.ok) throw new Error(writeData.error || 'Save failed');

      // Re-parse to validate via dmux-core (catches cycles, unknown deps, etc.)
      const parseRes = await fetch(`/api/projects/${name}/agents-config-parsed`);
      if (parseRes.status === 422) {
        const body = await parseRes.json();
        setValidationError({ ...body, scope: 'save' });
        toast(`Config saved but has errors: ${body.error}`, 'warning');
        setSaving(false);
        return;
      }

      setSaved(config);
      toast(andRun ? 'Saved. Starting agents...' : 'Config saved', 'success');

      if (andRun) {
        const startRes = await fetch(`/api/projects/${name}/agents/start`, { method: 'POST' });
        const startData = await startRes.json();
        if (startData.ok) {
          toast('Run started', 'success');
          setIsRunning(true);
        } else {
          toast(startData.error || 'Failed to start agents', 'error');
        }
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCleanup = () => {
    fetch(`/api/projects/${name}/agents/cleanup`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        toast(data.ok ? 'Cleanup complete' : data.error || 'Cleanup failed', data.ok ? 'success' : 'error');
        if (data.ok) setIsRunning(false);
      })
      .catch((e) => toast(e.message, 'error'));
  };

  // ---------------- render ----------------

  if (isRunning) {
    return (
      <div className={styles.page}>
        <Link to={`/projects/${name}`} className={styles.backLink}>
          ← {name}
        </Link>
        <header className={styles.header}>
          <h1 className={styles.title}>Agent run in progress</h1>
          <div className={styles.subtitle}>{name}</div>
        </header>
        <StatusTable {...agentStatus} />
        <div className={styles.bottomBar}>
          <Button variant="secondary" onClick={handleCleanup}>
            Cleanup
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Link to={`/projects/${name}`} className={styles.backLink}>
        ← {name}
      </Link>

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Agent Configuration</h1>
          <div className={styles.subtitle}>{name}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowYaml((v) => !v)}>
          {showYaml ? 'Hide YAML' : 'Show YAML'}
        </Button>
      </header>

      {validationError && validationError.scope === 'load' && (
        <div className={styles.banner} role="alert">
          <strong>Loaded config has errors.</strong>{' '}
          {validationError.agent ? `Agent '${validationError.agent}': ` : ''}
          {validationError.error}
        </div>
      )}

      <div className={styles.sections}>
        <Card header={<CardTitle>Session</CardTitle>}>
          <div className={styles.sessionGrid}>
            <Input
              label="Session name"
              value={config.session}
              onChange={(e) => setConfig({ ...config, session: e.target.value })}
              placeholder="my-project-agents"
              helperText="Used by tmux as the session name."
              required
            />
            <Input
              label="Worktree base"
              value={config.worktree_base}
              onChange={(e) => setConfig({ ...config, worktree_base: e.target.value })}
              placeholder=".."
              helperText="Where per-agent git worktrees get created, relative to the project."
            />
          </div>
          <div className={styles.checkboxRow}>
            <Checkbox
              label="Main integration pane"
              checked={config.main_pane}
              onChange={(e) => setConfig({ ...config, main_pane: e.target.checked })}
            />
            <Checkbox
              label="Namespace branches with git username"
              checked={config.namespace_branches}
              onChange={(e) => setConfig({ ...config, namespace_branches: e.target.checked })}
            />
          </div>
          <div className={styles.ocBlock}>
            <span className={styles.ocLabel}>On complete (default for all agents)</span>
            <div className={styles.ocRow}>
              <Checkbox
                label="Test"
                checked={config.on_complete.test}
                onChange={(e) =>
                  setConfig({ ...config, on_complete: { ...config.on_complete, test: e.target.checked } })
                }
              />
              <Checkbox
                label="Push"
                checked={config.on_complete.push}
                onChange={(e) =>
                  setConfig({ ...config, on_complete: { ...config.on_complete, push: e.target.checked } })
                }
              />
              <Checkbox
                label="PR"
                checked={config.on_complete.pr}
                onChange={(e) =>
                  setConfig({ ...config, on_complete: { ...config.on_complete, pr: e.target.checked } })
                }
              />
            </div>
          </div>
        </Card>

        {layers.length > 0 && (
          <Card header={<CardTitle>Execution order</CardTitle>}>
            <ol className={styles.layers}>
              {layers.map((layer) => (
                <li key={layer.depth} className={styles.layer}>
                  <span className={styles.layerNum}>Layer {layer.depth + 1}</span>
                  <span className={styles.layerNames}>
                    {layer.agents.map((a, i) => (
                      <span key={a.name || i} className={styles.layerName}>
                        {a.name || `(agent ${config.agents.indexOf(a) + 1})`}
                        <span className={styles.layerRole}>{a.role}</span>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
            <p className={styles.layersHint}>
              Agents in the same layer run in parallel. Later layers wait for earlier ones via depends_on.
            </p>
          </Card>
        )}

        <Card header={<CardTitle>Agents ({config.agents.length})</CardTitle>}>
          {config.agents.length === 0 ? (
            <div className={styles.emptyAgents}>
              <p>No agents yet.</p>
              <Button variant="primary" size="sm" onClick={addAgent}>
                + Add agent
              </Button>
            </div>
          ) : (
            <>
              <div className={styles.agentsList}>
                {config.agents.map((agent, i) => (
                  <AgentCardEditor
                    key={i}
                    agent={agent}
                    index={i}
                    globalProvider={config.provider}
                    globalOnComplete={config.on_complete}
                    agentNamesForDeps={agentNames}
                    defaultExpanded={!agent.name}
                    validationError={
                      validationError && validationError.agent === agent.name
                        ? `${validationError.field ?? ''} ${validationError.error}`.trim()
                        : null
                    }
                    onChange={(next) => updateAgent(i, next)}
                    onRemove={() => removeAgent(i)}
                  />
                ))}
              </div>
              <div className={styles.addRow}>
                <Button variant="secondary" size="sm" onClick={addAgent}>
                  + Add agent
                </Button>
              </div>
            </>
          )}
        </Card>

        {showYaml && (
          <Card header={<CardTitle>.dmux-agents.yml preview</CardTitle>}>
            <pre className={styles.yaml}>{yaml}</pre>
          </Card>
        )}
      </div>

      <div className={styles.bottomBar}>
        <Button variant="secondary" onClick={handleDiscard} disabled={!dirty}>
          Discard changes
        </Button>
        <span className={styles.spacer} />
        <Button variant="secondary" onClick={() => save()} loading={saving} disabled={config.agents.length === 0}>
          Save config
        </Button>
        <Button variant="primary" onClick={() => save({ andRun: true })} loading={saving} disabled={config.agents.length === 0}>
          Save & Run
        </Button>
      </div>
    </div>
  );
}
