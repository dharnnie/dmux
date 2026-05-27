import { useMemo, useState } from 'react';
import Card, { CardTitle } from './Card';
import { Input, Select } from './Field';
import useProviders from '../hooks/useProviders';
import styles from './CustomizePanel.module.css';

/**
 * CustomizePanel — Wave 2D Slice 3 + Wave 3C Slice 2.
 *
 * Inline panel for renaming agents and overriding their provider + model
 * before approving a proposal. Narrow on purpose: heavier edits (task,
 * scope, branch, depends_on) still route to the existing Edit-before-running
 * flow.
 *
 * Wave 3C adds a provider picker per agent. Changing provider implicitly
 * resets the model to that provider's default since model namespaces don't
 * overlap (claude/sonnet vs gemini/pro).
 *
 * Props:
 *   agents: the proposal's current agents
 *   onSubmit: ({ renames, modelOverrides, providerOverrides }) => void
 *   onCancel: () => void
 *   submitting: boolean
 */
export default function CustomizePanel({ agents, onSubmit, onCancel, submitting }) {
  const { providers, byName, ready } = useProviders();

  // Initialize drafts from the current proposal. Keyed by ORIGINAL name so
  // identity is stable even as the user types in the rename field.
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(agents.map((a) => [a.name, {
      newName: a.name,
      provider: a.provider || 'claude',
      model: a.model || 'sonnet',
    }])),
  );

  const errors = useMemo(() => validate(agents, drafts), [agents, drafts]);
  const hasErrors = Object.values(errors).some(Boolean);

  const updateDraft = (originalName, patch) => {
    setDrafts((prev) => ({
      ...prev,
      [originalName]: { ...prev[originalName], ...patch },
    }));
  };

  const handleProviderChange = (originalName, newProvider) => {
    // Reset model to the new provider's default (model namespaces don't
    // overlap, so the old model would be invalid).
    const providerEntry = byName.get(newProvider);
    const defaultModel = providerEntry?.defaultModel ?? null;
    updateDraft(originalName, { provider: newProvider, model: defaultModel });
  };

  const handleSubmit = () => {
    if (hasErrors || submitting) return;
    const renames = [];
    const modelOverrides = [];
    const providerOverrides = [];
    for (const a of agents) {
      const draft = drafts[a.name];
      if (!draft) continue;
      if (draft.newName.trim() !== a.name) {
        renames.push({ from: a.name, to: draft.newName.trim() });
      }
      const origProvider = a.provider || 'claude';
      if (draft.provider !== origProvider) {
        providerOverrides.push({ agent: a.name, provider: draft.provider });
      }
      if (draft.model !== a.model) {
        modelOverrides.push({ agent: a.name, model: draft.model });
      }
    }
    onSubmit({ renames, modelOverrides, providerOverrides });
  };

  // Build the capability summary for any non-default providers in play.
  const nonDefaultProviders = useMemo(() => {
    if (!ready) return [];
    const inUse = new Set(Object.values(drafts).map((d) => d.provider));
    inUse.delete('claude');
    return [...inUse].map((name) => byName.get(name)).filter(Boolean);
  }, [drafts, ready, byName]);

  return (
    <Card header={<CardTitle>Customize before running</CardTitle>}>
      <p className={styles.hint}>
        Rename agents and pick provider + model. Heavier edits (task, scope, branch) — use <strong>Edit before running</strong> instead.
      </p>

      <div className={styles.rows}>
        {agents.map((a) => {
          const draft = drafts[a.name] ?? { newName: a.name, provider: 'claude', model: 'sonnet' };
          const providerEntry = byName.get(draft.provider);
          const modelOptions = providerEntry?.models ?? [draft.model];
          const err = errors[a.name];
          return (
            <div key={a.name} className={styles.row}>
              <div className={styles.rowMeta}>
                <code className={styles.origName}>{a.name}</code>
                <span className={styles.role}>{a.role}</span>
              </div>
              <div className={styles.rowFields}>
                <Input
                  label="Name"
                  value={draft.newName}
                  onChange={(e) => updateDraft(a.name, { newName: e.target.value })}
                  error={err}
                  disabled={submitting}
                />
                <Select
                  label="Provider"
                  value={draft.provider}
                  onChange={(e) => handleProviderChange(a.name, e.target.value)}
                  disabled={submitting || !ready}
                >
                  {(providers.length > 0 ? providers : [{ name: draft.provider, label: draft.provider }]).map((p) => (
                    <option key={p.name} value={p.name}>{p.label || p.name}</option>
                  ))}
                </Select>
                <Select
                  label="Model"
                  value={draft.model ?? ''}
                  onChange={(e) => updateDraft(a.name, { model: e.target.value })}
                  disabled={submitting}
                >
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </Select>
              </div>
            </div>
          );
        })}
      </div>

      {nonDefaultProviders.length > 0 && (
        <div className={styles.capLine}>
          <span className={styles.capLineLabel}>Capabilities:</span>
          {nonDefaultProviders.map((p) => (
            <span key={p.name} className={styles.capChip}>
              <strong>{p.name}</strong>:
              {' '}
              {p.capabilities?.autoAccept ? 'auto-accept ✓' : 'auto-accept ✗'}
              {' · '}
              MCP {p.capabilities?.mcp || 'n/a'}
              {p.notes && <span className={styles.capChipNote}> — {p.notes}</span>}
            </span>
          ))}
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.cancel}
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.primary}
          onClick={handleSubmit}
          disabled={hasErrors || submitting}
        >
          {submitting ? 'Saving & approving…' : 'Save & Approve'}
        </button>
      </div>
    </Card>
  );
}

function validate(agents, drafts) {
  const errs = {};
  const seen = new Map();
  for (const a of agents) {
    const draft = drafts[a.name];
    if (!draft) continue;
    const name = draft.newName.trim();
    if (!name) {
      errs[a.name] = 'Name is required';
      continue;
    }
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) {
      errs[a.name] = 'Use A–Z, a–z, 0–9, _, - (max 32 chars)';
      continue;
    }
    if (seen.has(name)) {
      errs[a.name] = `Collides with the renamed '${seen.get(name)}'`;
      continue;
    }
    seen.set(name, a.name);
  }
  return errs;
}
