import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import AgentForm from '../components/AgentForm';
import YamlPreview from '../components/YamlPreview';
import StatusTable from '../components/StatusTable';
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

function parseYamlToConfig(yamlText) {
  const config = { ...DEFAULT_CONFIG, on_complete: { ...DEFAULT_CONFIG.on_complete }, agents: [] };

  const lines = yamlText.split('\n');
  let currentAgent = null;
  let inAgentsList = false;
  let inList = null; // 'scope', 'context', 'depends_on', 'on_complete', 'global_on_complete'

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Agent list item start
    const agentMatch = trimmed.match(/^-\s*name:\s*(.+)/);
    if (agentMatch) {
      if (currentAgent) config.agents.push(currentAgent);
      currentAgent = {
        name: agentMatch[1].trim().replace(/^["']|["']$/g, ''),
        branch: '', task: '', role: 'build', auto_accept: false,
        depends_on: '', scope: '', context: '',
        on_complete: { test: false, push: false, pr: false },
      };
      inAgentsList = true;
      inList = null;
      continue;
    }

    // List items
    const listItem = trimmed.match(/^-\s+(.+)/);
    if (listItem && inList) {
      const val = listItem[1].trim();
      if (inList === 'global_on_complete') {
        if (val === 'test') config.on_complete.test = true;
        if (val === 'push') config.on_complete.push = true;
        if (val === 'pr') config.on_complete.pr = true;
      } else if (currentAgent) {
        if (inList === 'scope') {
          currentAgent.scope = currentAgent.scope ? `${currentAgent.scope}, ${val}` : val;
        } else if (inList === 'context') {
          currentAgent.context = currentAgent.context ? `${currentAgent.context}, ${val}` : val;
        } else if (inList === 'depends_on') {
          currentAgent.depends_on = currentAgent.depends_on ? `${currentAgent.depends_on}, ${val}` : val;
        } else if (inList === 'on_complete') {
          if (val === 'test') currentAgent.on_complete.test = true;
          if (val === 'push') currentAgent.on_complete.push = true;
          if (val === 'pr') currentAgent.on_complete.pr = true;
        }
      }
      continue;
    }

    // Non-list-item resets inList
    if (!trimmed.startsWith('-')) inList = null;

    if (currentAgent) {
      const kv = trimmed.match(/^(\w+):\s*(.*)/);
      if (kv) {
        const [, key, rawVal] = kv;
        const val = rawVal.trim().replace(/^["']|["']$/g, '');
        switch (key) {
          case 'branch': currentAgent.branch = val; break;
          case 'task': currentAgent.task = val; break;
          case 'role': currentAgent.role = val; break;
          case 'auto_accept': currentAgent.auto_accept = val === 'true'; break;
          case 'scope': inList = 'scope'; break;
          case 'context': inList = 'context'; break;
          case 'depends_on': inList = 'depends_on'; break;
          case 'on_complete': inList = 'on_complete'; break;
        }
        continue;
      }
    }

    // Top-level keys
    const topKv = trimmed.match(/^(\w+):\s*(.*)/);
    if (topKv && !inAgentsList) {
      const [, key, rawVal] = topKv;
      const val = rawVal.trim().replace(/^["']|["']$/g, '');
      switch (key) {
        case 'session': config.session = val; break;
        case 'worktree_base': config.worktree_base = val; break;
        case 'main_pane': config.main_pane = val === 'true'; break;
        case 'namespace_branches': config.namespace_branches = val === 'true'; break;
        case 'on_complete': inList = 'global_on_complete'; break;
        case 'agents': inAgentsList = true; break;
      }
    }
  }

  if (currentAgent) config.agents.push(currentAgent);
  return config;
}

export default function AgentSession() {
  const { name } = useParams();
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [message, setMessage] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    // Try to load existing config
    fetch(`/api/projects/${name}/agents-config`)
      .then((r) => {
        if (r.ok) return r.text();
        return null;
      })
      .then((text) => {
        if (text) {
          setConfig(parseYamlToConfig(text));
        } else {
          setConfig({ ...DEFAULT_CONFIG, session: `${name}-agents`, on_complete: { ...DEFAULT_CONFIG.on_complete }, agents: [] });
        }
      });

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
          <StatusTable projectName={name} />
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
