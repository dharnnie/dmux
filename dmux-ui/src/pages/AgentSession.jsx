import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import AgentForm from '../components/AgentForm';
import YamlPreview from '../components/YamlPreview';
import StatusTable from '../components/StatusTable';
import useAgentStatus from '../hooks/useAgentStatus';
import styles from './AgentSession.module.css';

const DEFAULT_CONFIG = {
  session: '',
  worktree_base: '..',
  main_pane: true,
  namespace_branches: false,
  on_complete: { test: false, push: false, pr: false },
  agents: [],
};

function configToYaml(config) {
  let yaml = `session: ${config.session || 'my-agents'}\n`;
  yaml += `worktree_base: ${config.worktree_base || '..'}\n`;
  yaml += `main_pane: ${config.main_pane}\n`;

  if (config.namespace_branches) {
    yaml += `namespace_branches: true\n`;
  }

  const globalOc = [];
  if (config.on_complete.test) globalOc.push('test');
  if (config.on_complete.push) globalOc.push('push');
  if (config.on_complete.pr) globalOc.push('pr');
  if (globalOc.length > 0) {
    yaml += `on_complete:\n`;
    for (const item of globalOc) {
      yaml += `  - ${item}\n`;
    }
  }

  yaml += `\nagents:\n`;

  for (const agent of config.agents) {
    if (!agent.name) continue;
    yaml += `  - name: ${agent.name}\n`;
    if (agent.role === 'review') {
      yaml += `    role: review\n`;
    } else if (agent.branch) {
      yaml += `    branch: ${agent.branch}\n`;
    }
    if (agent.task) {
      yaml += `    task: "${agent.task}"\n`;
    }
    if (agent.auto_accept) {
      yaml += `    auto_accept: true\n`;
    }
    if (agent.depends_on) {
      yaml += `    depends_on:\n`;
      for (const dep of agent.depends_on.split(',').map((d) => d.trim()).filter(Boolean)) {
        yaml += `      - ${dep}\n`;
      }
    }
    if (agent.scope) {
      yaml += `    scope:\n`;
      for (const s of agent.scope.split(',').map((d) => d.trim()).filter(Boolean)) {
        yaml += `      - ${s}\n`;
      }
    }
    if (agent.context) {
      yaml += `    context:\n`;
      for (const c of agent.context.split(',').map((d) => d.trim()).filter(Boolean)) {
        yaml += `      - ${c}\n`;
      }
    }

    const oc = [];
    if (agent.on_complete.test) oc.push('test');
    if (agent.on_complete.push) oc.push('push');
    if (agent.on_complete.pr) oc.push('pr');
    if (oc.length > 0) {
      yaml += `    on_complete:\n`;
      for (const item of oc) {
        yaml += `      - ${item}\n`;
      }
    }
  }

  return yaml;
}

// Adapts the normalized config from dmux-core's parser into the local form-state
// shape this component currently uses (comma-separated strings for path lists,
// object form for on_complete). This is a transitional shim — the agent editor
// refactor in Wave 2A replaces the form internals with real list editors and
// removes this adapter.
function parsedConfigToFormState(parsed) {
  const oncListToObj = (list) => ({
    test: list.includes('test'),
    push: list.includes('push'),
    pr: list.includes('pr'),
  });

  return {
    session: parsed.session,
    worktree_base: parsed.worktree_base,
    main_pane: parsed.main_pane,
    namespace_branches: parsed.namespace_branches,
    on_complete: oncListToObj(parsed.on_complete),
    agents: parsed.agents.map((a) => ({
      name: a.name,
      branch: a.branch,
      task: a.task,
      role: a.role,
      auto_accept: a.auto_accept,
      depends_on: a.depends_on.join(', '),
      scope: a.scope.join(', '),
      context: a.context.join(', '),
      // null on the parsed side means "inherit global"; the form represents that
      // as all-false. Wave 2A's editor refactor will surface inheritance properly.
      on_complete: oncListToObj(a.on_complete ?? []),
    })),
  };
}

export default function AgentSession() {
  const { name } = useParams();
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [message, setMessage] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const agentStatus = useAgentStatus(name);

  useEffect(() => {
    // Load existing config via the dmux-core-backed parsed endpoint.
    // The endpoint returns 404 if no .dmux-agents.yml exists, 422 with
    // {error, field, agent} on validation failures, or 200 with the normalized
    // config object.
    fetch(`/api/projects/${name}/agents-config-parsed`)
      .then(async (r) => {
        if (r.ok) {
          const parsed = await r.json();
          setConfig(parsedConfigToFormState(parsed));
          return;
        }
        if (r.status === 404) {
          setConfig({
            ...DEFAULT_CONFIG,
            session: `${name}-agents`,
            on_complete: { ...DEFAULT_CONFIG.on_complete },
            agents: [],
          });
          return;
        }
        if (r.status === 422) {
          const body = await r.json();
          const where = body.agent ? `agent '${body.agent}': ` : '';
          setMessage(`Config invalid — ${where}${body.error}`);
        }
      })
      .catch((e) => setMessage(`Couldn't load config: ${e.message}`));

    // Check if agents are running
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

  const handleSave = () => {
    setMessage('Saving...');
    fetch(`/api/projects/${name}/agents-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: yaml,
    })
      .then((r) => r.json())
      .then((data) => {
        setMessage(data.ok ? 'Config saved.' : `Error: ${data.error}`);
      })
      .catch((e) => setMessage(`Error: ${e.message}`));
  };

  const handleSaveAndStart = () => {
    setMessage('Saving and starting agents...');
    fetch(`/api/projects/${name}/agents-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: yaml,
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          setMessage(`Error saving: ${data.error}`);
          return;
        }
        return fetch(`/api/projects/${name}/agents/start`, { method: 'POST' });
      })
      .then((r) => r && r.json())
      .then((data) => {
        if (data) {
          setMessage(data.ok ? 'Agents started! Check your terminal.' : `Error: ${data.error}`);
          if (data.ok) setIsRunning(true);
        }
      })
      .catch((e) => setMessage(`Error: ${e.message}`));
  };

  const handleCleanup = () => {
    setMessage('Cleaning up...');
    fetch(`/api/projects/${name}/agents/cleanup`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        setMessage(data.ok ? 'Cleanup complete.' : `Error: ${data.error}`);
        if (data.ok) setIsRunning(false);
      })
      .catch((e) => setMessage(`Error: ${e.message}`));
  };

  return (
    <div className={styles.page}>
      <Link to={`/projects/${name}`} className={styles.backLink}>
        &#8592; {name}
      </Link>

      <div className={styles.header}>
        <h1 className={styles.title}>Agent Configuration</h1>
        <div className={styles.subtitle}>{name}</div>
      </div>

      {isRunning ? (
        <>
          <StatusTable {...agentStatus} />
          <div className={styles.bottomBar}>
            <button className={styles.btnOutline} onClick={handleCleanup}>
              Cleanup
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.layout}>
            <div className={styles.formPanel}>
              <AgentForm config={config} onChange={setConfig} />
              <div className={styles.bottomBar}>
                <button className={styles.btnOutline} onClick={handleSave}>
                  Save Config
                </button>
                <button className={styles.btnPink} onClick={handleSaveAndStart}>
                  Save & Start
                </button>
              </div>
            </div>
            <div className={styles.previewPanel}>
              <YamlPreview yaml={yaml} />
            </div>
          </div>
        </>
      )}

      {message && <div className={styles.message}>{message}</div>}
    </div>
  );
}
