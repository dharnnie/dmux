import { useEffect, useState } from 'react';
import Sheet from './Sheet';
import Button from './Button';
import { Select } from './Field';
import styles from './ConvertToProposalModal.module.css';

/**
 * ConvertToProposalModal — Wave 3B Slice 3.
 *
 * Asks the user to confirm converting the current chat to a proposal.
 * For project-scoped chats the target project is pre-selected and the
 * picker is locked. For global-scoped chats the user picks.
 *
 * Props:
 *   open           — controls visibility
 *   onClose        — called on cancel / dismiss
 *   defaultProject — string project name; pre-selected when scope='project'
 *   lockProject    — when true, the picker is disabled (project-scope)
 *   convertEndpoint — relative URL to POST to (e.g. '/api/chat/global/convert')
 *   onSuccess      — ({ proposalId, projectName }) => void
 */
export default function ConvertToProposalModal({
  open,
  onClose,
  defaultProject = null,
  lockProject = false,
  convertEndpoint,
  onSuccess,
}) {
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(defaultProject);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setProject(defaultProject);
    setSubmitting(false);
    setError(null);
  }, [open, defaultProject]);

  // Fetch the registry for the picker.
  useEffect(() => {
    if (!open || lockProject) return;
    fetch('/api/projects')
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [open, lockProject]);

  const handleSubmit = async () => {
    if (!project || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(convertEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lockProject ? {} : { targetProject: project }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      onSuccess?.({ proposalId: body.proposalId, projectName: body.projectName });
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={submitting}>
        Cancel
      </Button>
      <span style={{ flex: 1 }} />
      <Button
        variant="primary"
        onClick={handleSubmit}
        loading={submitting}
        disabled={!project || submitting}
      >
        {submitting ? 'Planning…' : 'Convert'}
      </Button>
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="Convert this chat to a proposal?"
      footer={footer}
      dismissOnBackdrop={!submitting}
    >
      <div className={styles.body}>
        <Select
          label="Project"
          value={project ?? ''}
          onChange={(e) => setProject(e.target.value || null)}
          disabled={lockProject || submitting}
          helperText={lockProject
            ? 'Pre-selected from this chat.'
            : 'The proposal will live under this project.'}
        >
          <option value="">— pick a project —</option>
          {(lockProject && defaultProject
            ? [{ name: defaultProject }]
            : projects
          ).map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </Select>

        <p className={styles.hint}>
          This sends the full chat transcript through the planner. You'll
          review the proposed team before anything runs.
        </p>

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Sheet>
  );
}
