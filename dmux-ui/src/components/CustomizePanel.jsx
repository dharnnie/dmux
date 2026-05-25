import { useMemo, useState } from 'react';
import Card, { CardTitle } from './Card';
import { Input, Select } from './Field';
import styles from './CustomizePanel.module.css';

const MODEL_OPTIONS = ['opus', 'sonnet', 'haiku'];

/**
 * CustomizePanel — Wave 2D Slice 3.
 *
 * Inline panel for renaming agents and overriding their model before
 * approving a proposal. Narrow on purpose: heavier edits (task, scope,
 * branch, depends_on) still route to the existing Edit-before-running flow.
 *
 * Props:
 *   agents: the proposal's current agents (name + model used as defaults)
 *   onSubmit: ({ renames, modelOverrides }) => void  — caller handles the
 *             customize POST + then-approve flow
 *   onCancel: () => void
 *   submitting: boolean
 *
 * The panel manages its own draft state. Each agent row has an editable
 * name input and a model select. Rename collisions and invalid names are
 * caught client-side; the server still validates as a backstop.
 */
export default function CustomizePanel({ agents, onSubmit, onCancel, submitting }) {
  // Initialize drafts from the current proposal. Keyed by ORIGINAL name so
  // identity is stable even as the user types in the rename field.
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(agents.map((a) => [a.name, { newName: a.name, model: a.model || 'sonnet' }])),
  );

  const errors = useMemo(() => validate(agents, drafts), [agents, drafts]);
  const hasErrors = Object.values(errors).some(Boolean);

  const updateDraft = (originalName, patch) => {
    setDrafts((prev) => ({
      ...prev,
      [originalName]: { ...prev[originalName], ...patch },
    }));
  };

  const handleSubmit = () => {
    if (hasErrors || submitting) return;
    const renames = [];
    const modelOverrides = [];
    for (const a of agents) {
      const draft = drafts[a.name];
      if (!draft) continue;
      if (draft.newName.trim() !== a.name) {
        renames.push({ from: a.name, to: draft.newName.trim() });
      }
      if (draft.model !== a.model) {
        modelOverrides.push({ agent: a.name, model: draft.model });
      }
    }
    onSubmit({ renames, modelOverrides });
  };

  return (
    <Card header={<CardTitle>Customize before running</CardTitle>}>
      <p className={styles.hint}>
        Rename agents and pick models. Heavier edits (task, scope, branch) — use <strong>Edit before running</strong> instead.
      </p>

      <div className={styles.rows}>
        {agents.map((a) => {
          const draft = drafts[a.name] ?? { newName: a.name, model: a.model || 'sonnet' };
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
                  label="Model"
                  value={draft.model}
                  onChange={(e) => updateDraft(a.name, { model: e.target.value })}
                  disabled={submitting}
                >
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </Select>
              </div>
            </div>
          );
        })}
      </div>

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
