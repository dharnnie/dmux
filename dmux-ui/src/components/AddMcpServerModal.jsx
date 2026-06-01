import { useEffect, useState } from 'react';
import Sheet from './Sheet';
import Button from './Button';
import { Input } from './Field';
import useMcpCatalogue from '../hooks/useMcpCatalogue';
import { useToast } from './Toasts';
import styles from './AddMcpServerModal.module.css';

/**
 * AddMcpServerModal — Wave 3D Slice 2.
 *
 * Two-step modal: pick a server from the catalogue → fill its required
 * credentials + args → save. Slice 2 uses env-var indirection for
 * credentials (the user types the NAME of an env var they'll set in their
 * shell); Slice 3 swaps to keychain on macOS.
 *
 * Props:
 *   open, onClose
 *   projectName  — used to address POST /api/projects/:name/mcp/servers
 *   onAdded      — called with the updated server list on successful save
 */
export default function AddMcpServerModal({ open, onClose, projectName, onAdded }) {
  const toast = useToast();
  const { catalogue, ready } = useMcpCatalogue();
  const [selectedName, setSelectedName] = useState(null);
  const [envValues, setEnvValues] = useState({});
  const [argValues, setArgValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setSelectedName(null);
    setEnvValues({});
    setArgValues({});
    setSubmitting(false);
    setError(null);
  }, [open]);

  const selected = selectedName ? catalogue.find((e) => e.name === selectedName) : null;

  const handleSubmit = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectName}/mcp/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalogueName: selected.name,
          envValues,
          argValues,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast(`Added ${selected.label} MCP server.`, 'success');
      onAdded?.(body);
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  const footer = (
    <>
      {selectedName && (
        <Button variant="ghost" size="sm" onClick={() => setSelectedName(null)} disabled={submitting}>
          ← Back
        </Button>
      )}
      <span className={styles.spacer} />
      <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
      {selectedName && (
        <Button variant="primary" onClick={handleSubmit} loading={submitting}>
          Save
        </Button>
      )}
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={selectedName ? `Configure ${selected?.label ?? selectedName}` : 'Add MCP server'}
      footer={footer}
      dismissOnBackdrop={!submitting}
    >
      {!ready ? (
        <p className={styles.loading}>Loading catalogue…</p>
      ) : selectedName ? (
        <ConfigureStep
          entry={selected}
          envValues={envValues}
          setEnvValues={setEnvValues}
          argValues={argValues}
          setArgValues={setArgValues}
          error={error}
        />
      ) : (
        <PickStep catalogue={catalogue} onPick={setSelectedName} />
      )}
    </Sheet>
  );
}

function PickStep({ catalogue, onPick }) {
  return (
    <div className={styles.pickStep}>
      <p className={styles.pickHint}>Pick from the catalogue:</p>
      <ul className={styles.pickList}>
        {catalogue.map((entry) => (
          <li key={entry.name}>
            <button type="button" className={styles.pickCard} onClick={() => onPick(entry.name)}>
              <div className={styles.pickTitle}>{entry.label}</div>
              <div className={styles.pickDesc}>{entry.description}</div>
              <div className={styles.pickMeta}>
                {entry.requiredCredentials.length === 0
                  ? 'No credentials needed'
                  : `Requires: ${entry.requiredCredentials.map((c) => c.envKey).join(', ')}`}
                {entry.argParams.length > 0 && ` · ${entry.argParams.length} param${entry.argParams.length === 1 ? '' : 's'}`}
              </div>
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.pickEscapeHatch}>
        Need a server we don't list? Hand-edit <code>.dmux/mcp.json</code> at your project root.
      </p>
    </div>
  );
}

function ConfigureStep({ entry, envValues, setEnvValues, argValues, setArgValues, error }) {
  return (
    <div className={styles.configureStep}>
      <p className={styles.configureDesc}>{entry.description}</p>

      {entry.requiredCredentials.map((cred) => (
        <Input
          key={cred.envKey}
          label={cred.envKey}
          value={envValues[cred.envKey] ?? ''}
          onChange={(e) => setEnvValues((prev) => ({ ...prev, [cred.envKey]: e.target.value }))}
          placeholder={`e.g. ${cred.envKey}`}
          helperText={cred.helpText + (cred.helpUrl ? ` Get one at ${cred.helpUrl}.` : '')}
        />
      ))}

      {entry.argParams.map((param) => (
        <Input
          key={param.name}
          label={param.label || param.name}
          value={argValues[param.name] ?? param.defaultValue ?? ''}
          onChange={(e) => setArgValues((prev) => ({ ...prev, [param.name]: e.target.value }))}
          helperText={param.helpText}
        />
      ))}

      <div className={styles.platformHint}>
        <strong>Env-var indirection (Wave 3D Slice 2).</strong> Paste the NAME of an env var you'll set in your shell, not the secret itself. Slice 3 swaps in macOS Keychain so you can paste the actual value securely.
      </div>

      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
