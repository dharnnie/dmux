import styles from './AgentForm.module.css';

const EMPTY_AGENT = {
  name: '',
  branch: '',
  task: '',
  role: 'build',
  auto_accept: false,
  depends_on: '',
  scope: '',
  context: '',
  on_complete: { test: false, push: false, pr: false },
};

export default function AgentForm({ config, onChange }) {
  const updateField = (key, value) => {
    onChange({ ...config, [key]: value });
  };

  const updateAgent = (index, key, value) => {
    const agents = [...config.agents];
    agents[index] = { ...agents[index], [key]: value };
    onChange({ ...config, agents });
  };

  const updateAgentOnComplete = (index, key, value) => {
    const agents = [...config.agents];
    agents[index] = {
      ...agents[index],
      on_complete: { ...agents[index].on_complete, [key]: value },
    };
    onChange({ ...config, agents });
  };

  const addAgent = () => {
    onChange({ ...config, agents: [...config.agents, { ...EMPTY_AGENT, on_complete: { ...EMPTY_AGENT.on_complete } }] });
  };

  const removeAgent = (index) => {
    const agents = config.agents.filter((_, i) => i !== index);
    onChange({ ...config, agents });
  };

  return (
    <div className={styles.form}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Session Settings</div>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Session Name</label>
            <input
              className={styles.input}
              value={config.session}
              onChange={(e) => updateField('session', e.target.value)}
              placeholder="my-project-agents"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Worktree Base</label>
            <input
              className={styles.input}
              value={config.worktree_base}
              onChange={(e) => updateField('worktree_base', e.target.value)}
              placeholder=".."
            />
          </div>
        </div>
        <div className={styles.checkboxGroup}>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={config.main_pane}
              onChange={(e) => updateField('main_pane', e.target.checked)}
            />
            Main integration pane
          </label>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={config.namespace_branches}
              onChange={(e) => updateField('namespace_branches', e.target.checked)}
            />
            Namespace branches
          </label>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Global on_complete</div>
        <div className={styles.checkboxGroup}>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={config.on_complete.test}
              onChange={(e) =>
                updateField('on_complete', { ...config.on_complete, test: e.target.checked })
              }
            />
            Test
          </label>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={config.on_complete.push}
              onChange={(e) =>
                updateField('on_complete', { ...config.on_complete, push: e.target.checked })
              }
            />
            Push
          </label>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={config.on_complete.pr}
              onChange={(e) =>
                updateField('on_complete', { ...config.on_complete, pr: e.target.checked })
              }
            />
            PR
          </label>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Agents</div>

        {config.agents.map((agent, i) => (
          <div key={i} className={styles.agentCard}>
            <div className={styles.agentHeader}>
              <span className={styles.agentTitle}>
                {agent.name || `Agent ${i + 1}`}
              </span>
              <button
                className={styles.removeBtn}
                onClick={() => removeAgent(i)}
              >
                Remove
              </button>
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Name</label>
                <input
                  className={styles.input}
                  value={agent.name}
                  onChange={(e) => updateAgent(i, 'name', e.target.value)}
                  placeholder="auth"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Role</label>
                <select
                  className={styles.select}
                  value={agent.role}
                  onChange={(e) => updateAgent(i, 'role', e.target.value)}
                >
                  <option value="build">build</option>
                  <option value="review">review</option>
                </select>
              </div>
            </div>

            {agent.role !== 'review' && (
              <div className={styles.field}>
                <label className={styles.label}>Branch</label>
                <input
                  className={styles.input}
                  value={agent.branch}
                  onChange={(e) => updateAgent(i, 'branch', e.target.value)}
                  placeholder="feature/auth"
                />
              </div>
            )}

            <div className={styles.fieldFull}>
              <label className={styles.label}>Task</label>
              <textarea
                className={styles.textarea}
                value={agent.task}
                onChange={(e) => updateAgent(i, 'task', e.target.value)}
                placeholder="Describe what this agent should do..."
              />
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Depends On (comma-separated)</label>
                <input
                  className={styles.input}
                  value={agent.depends_on}
                  onChange={(e) => updateAgent(i, 'depends_on', e.target.value)}
                  placeholder="auth, catalog"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Scope (comma-separated paths)</label>
                <input
                  className={styles.input}
                  value={agent.scope}
                  onChange={(e) => updateAgent(i, 'scope', e.target.value)}
                  placeholder="src/auth/, src/middleware/"
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Context (comma-separated read-only paths)</label>
              <input
                className={styles.input}
                value={agent.context}
                onChange={(e) => updateAgent(i, 'context', e.target.value)}
                placeholder="src/types/"
              />
            </div>

            <div className={styles.checkboxGroup}>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={agent.auto_accept}
                  onChange={(e) => updateAgent(i, 'auto_accept', e.target.checked)}
                />
                Auto-accept
              </label>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={agent.on_complete.test}
                  onChange={(e) => updateAgentOnComplete(i, 'test', e.target.checked)}
                />
                Test
              </label>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={agent.on_complete.push}
                  onChange={(e) => updateAgentOnComplete(i, 'push', e.target.checked)}
                />
                Push
              </label>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={agent.on_complete.pr}
                  onChange={(e) => updateAgentOnComplete(i, 'pr', e.target.checked)}
                />
                PR
              </label>
            </div>
          </div>
        ))}

        <button className={styles.addBtn} onClick={addAgent}>
          + Add Agent
        </button>
      </div>
    </div>
  );
}
