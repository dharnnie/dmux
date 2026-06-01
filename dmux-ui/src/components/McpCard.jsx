import { useEffect, useState } from 'react';
import Card, { CardTitle } from './Card';
import Button from './Button';
import { ConfirmDialog } from './Sheet';
import AddMcpServerModal from './AddMcpServerModal';
import { useToast } from './Toasts';
import styles from './McpCard.module.css';

/**
 * McpCard — Wave 3D Slice 2.
 *
 * Renders the MCP server list for a project on Project Detail. Empty state
 * explains what MCP is; per-server rows show name + credentials count +
 * Remove. Add server button opens AddMcpServerModal.
 *
 * Props:
 *   projectName
 */
export default function McpCard({ projectName }) {
  const toast = useToast();
  const [state, setState] = useState(null);  // null=loading; { servers, error? }
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState(null);  // name being confirmed

  const refresh = () => {
    fetch(`/api/projects/${projectName}/mcp`)
      .then((r) => r.json())
      .then((body) => setState(body))
      .catch((e) => setState({ servers: [], error: e.message }));
  };

  useEffect(() => { refresh(); }, [projectName]);

  const handleRemove = async (serverName) => {
    setRemoving(null);
    try {
      const res = await fetch(`/api/projects/${projectName}/mcp/servers/${serverName}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setState(body);
      toast(`Removed ${serverName} MCP server.`, 'success');
    } catch (e) {
      toast(`Couldn't remove ${serverName}: ${e.message}`, 'error');
    }
  };

  const servers = state?.servers ?? [];
  const configError = state?.error;

  return (
    <>
      <Card header={<CardTitle>MCP</CardTitle>}>
        {state === null ? (
          <p className={styles.loading}>Loading…</p>
        ) : configError ? (
          <div className={styles.error}>
            <strong>Config error:</strong> {configError}
            <p className={styles.errorHint}>Fix or delete <code>.dmux/mcp.json</code> to clear this.</p>
          </div>
        ) : servers.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyHint}>
              No MCP servers configured. Agents in this project run without external tool access.
            </p>
            <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
              + Add server
            </Button>
          </div>
        ) : (
          <>
            <ul className={styles.list}>
              {servers.map((server) => (
                <li key={server.name} className={styles.row}>
                  <div className={styles.rowBody}>
                    <code className={styles.rowName}>{server.name}</code>
                    <span className={styles.rowMeta}>
                      {server.credentials.length === 0
                        ? 'no credentials'
                        : `${server.credentials.length} credential${server.credentials.length === 1 ? '' : 's'}`}
                      {server.credentials.length > 0 && ` (${server.credentials.map((c) => c.kind).join(', ')})`}
                    </span>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setRemoving(server.name)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <div className={styles.addRow}>
              <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
                + Add server
              </Button>
            </div>
          </>
        )}
      </Card>

      <AddMcpServerModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projectName={projectName}
        onAdded={(body) => {
          setState(body);
          setAddOpen(false);
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => handleRemove(removing)}
        title={`Remove ${removing} MCP server?`}
        message="Agents in this project will lose access to its tools. You can re-add it later from the catalogue."
        confirmLabel="Remove"
        confirmVariant="danger"
      />
    </>
  );
}
