import { useState } from 'react';
import { Input, Textarea, Select } from './Field';
import RadioGroup from './RadioGroup';
import Checkbox from './Checkbox';
import ListEditor from './ListEditor';
import Button from './Button';
import styles from './AgentCardEditor.module.css';

const MODELS_BY_PROVIDER = {
  claude: ['opus', 'sonnet', 'haiku'],
  gemini: ['pro', 'flash'],
};

const ROLES = [
  { value: 'plan', label: 'Plan' },
  { value: 'build', label: 'Build' },
  { value: 'review', label: 'Review' },
];

const ROLE_HINT = {
  plan: 'Plan agents are read-only — they produce a plan file consumed by downstream build agents.',
  build: 'Build agents work in a git worktree on their own branch and can write within their scope.',
  review: 'Review agents read changes from upstream agents and surface findings; no worktree.',
};

/**
 * Collapsible per-agent editor card. When collapsed, shows a summary line
 * (name · role · model · depends_on). When expanded, shows the full form.
 */
export default function AgentCardEditor({
  agent,
  index,
  globalProvider,
  globalOnComplete,
  agentNamesForDeps,
  defaultExpanded = false,
  validationError,
  onChange,
  onRemove,
}) {
  const [open, setOpen] = useState(defaultExpanded);

  const update = (key, value) => onChange({ ...agent, [key]: value });
  const updateOnComplete = (key, value) =>
    update('on_complete', { ...agent.on_complete, [key]: value });

  const resolvedProvider = agent.provider || globalProvider || 'claude';
  const modelOptions = MODELS_BY_PROVIDER[resolvedProvider] ?? [];

  const showBranch = agent.role === 'build';
  const scopeDisabled = agent.role === 'plan' || agent.role === 'review';

  // Other agents in this config (exclude self) — for depends_on suggestions
  const depSuggestions = agentNamesForDeps.filter((n) => n !== agent.name && n !== '');

  return (
    <div className={`${styles.card} ${validationError ? styles.cardError : ''}`}>
      <button
        type="button"
        className={styles.summary}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.arrow} aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className={styles.summaryName}>
          {agent.name || <span className={styles.placeholder}>Agent {index + 1}</span>}
        </span>
        <span className={styles.summaryRole}>{agent.role}</span>
        {agent.model && <span className={styles.summaryModel}>{agent.model}</span>}
        {agent.depends_on?.length > 0 && (
          <span className={styles.summaryDeps}>
            depends on: {agent.depends_on.join(', ')}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.body}>
          {validationError && (
            <div className={styles.errorBanner} role="alert">
              {validationError}
            </div>
          )}

          <Input
            label="Name"
            value={agent.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="planner"
            helperText="Used in branch names and run output paths."
            required
          />

          <RadioGroup
            label="Role"
            value={agent.role}
            onChange={(v) => update('role', v)}
            options={ROLES}
            helperText={ROLE_HINT[agent.role]}
          />

          <div className={styles.row}>
            <Select
              label="Provider"
              value={agent.provider || ''}
              onChange={(e) => {
                const next = e.target.value;
                // Reset model if the new provider doesn't support the current one
                const validModels = MODELS_BY_PROVIDER[next || globalProvider || 'claude'] ?? [];
                update('provider', next);
                if (agent.model && !validModels.includes(agent.model)) {
                  update('model', '');
                }
              }}
              helperText={`Inherits global (${globalProvider || 'claude'}) when blank.`}
            >
              <option value="">— inherit —</option>
              <option value="claude">claude</option>
              <option value="gemini">gemini</option>
            </Select>

            <Select
              label="Model"
              value={agent.model || ''}
              onChange={(e) => update('model', e.target.value)}
              helperText={`Provider default when blank.`}
            >
              <option value="">— default —</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </div>

          {showBranch && (
            <Input
              label="Branch"
              value={agent.branch}
              onChange={(e) => update('branch', e.target.value)}
              placeholder="feature/auth"
              helperText="Git branch this agent works on. Created on Save & Run if missing."
            />
          )}

          <Textarea
            label="Task"
            value={agent.task}
            onChange={(e) => update('task', e.target.value)}
            placeholder="Describe what this agent should do..."
            rows={4}
          />

          <ListEditor
            label="Depends on"
            items={agent.depends_on}
            onChange={(items) => update('depends_on', items)}
            placeholder={depSuggestions.length > 0 ? 'pick an agent name' : '(no other agents)'}
            addLabel="Add dependency"
            suggestions={depSuggestions}
            helperText="This agent waits for the listed agents to complete before starting."
          />

          <ListEditor
            label="Scope"
            items={agent.scope}
            onChange={(items) => update('scope', items)}
            placeholder="src/auth/"
            addLabel="Add path"
            helperText={
              scopeDisabled
                ? `Scope is ignored for ${agent.role} agents (no worktree to write to).`
                : 'Files / directories this agent may modify.'
            }
            disabled={scopeDisabled}
          />

          <ListEditor
            label="Context"
            items={agent.context}
            onChange={(items) => update('context', items)}
            placeholder="src/types/"
            addLabel="Add path"
            helperText="Files / directories the agent may read but not modify."
          />

          <div className={styles.checkboxRow}>
            <Checkbox
              label="Auto-accept"
              checked={agent.auto_accept}
              onChange={(e) => update('auto_accept', e.target.checked)}
            />
          </div>

          <div className={styles.ocBlock}>
            <span className={styles.ocLabel}>On complete</span>
            <div className={styles.ocRow}>
              <Checkbox
                label="Test"
                checked={agent.on_complete.test}
                onChange={(e) => updateOnComplete('test', e.target.checked)}
              />
              <Checkbox
                label="Push"
                checked={agent.on_complete.push}
                onChange={(e) => updateOnComplete('push', e.target.checked)}
              />
              <Checkbox
                label="PR"
                checked={agent.on_complete.pr}
                onChange={(e) => updateOnComplete('pr', e.target.checked)}
              />
              <span className={styles.ocHint}>
                {agent.on_complete.test || agent.on_complete.push || agent.on_complete.pr
                  ? 'Overrides global on-complete defaults.'
                  : `Inherits global (${formatGlobalOc(globalOnComplete)}).`}
              </span>
            </div>
          </div>

          <div className={styles.footer}>
            <Button variant="danger" size="sm" onClick={onRemove}>
              Remove agent
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatGlobalOc(g) {
  const parts = [];
  if (g?.test) parts.push('test');
  if (g?.push) parts.push('push');
  if (g?.pr) parts.push('pr');
  return parts.length > 0 ? parts.join(', ') : 'none';
}
