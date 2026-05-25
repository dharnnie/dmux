import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sheet from './Sheet';
import Button from './Button';
import { Input } from './Field';
import { useToast } from './Toasts';
import styles from './AdoptSheet.module.css';

/**
 * AdoptSheet — Wave 2C Slice 2.
 *
 * Single-step sheet. The user pastes an absolute path to a git repo and
 * (optionally) overrides the auto-derived project name. Submit kicks off
 * the long-running adoption POST and starts polling /api/adopt/progress
 * with a client-generated correlationId so the UI shows live stage labels
 * while discovery is running (~30-60s).
 *
 * On success: closes, toasts, navigates to the proposal review page where
 * the user approves/edits/discards the starter team like any other
 * proposal.
 */
export default function AdoptSheet({ open, onClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState(null);  // server's stage string, or null
  const [pathError, setPathError] = useState(null);
  const pollRef = useRef(null);
  const correlationRef = useRef(null);

  // Reset when re-opened.
  useEffect(() => {
    if (!open) return;
    setPath('');
    setName('');
    setSubmitting(false);
    setStage(null);
    setPathError(null);
    correlationRef.current = null;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [open]);

  // Cleanup poll on unmount.
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const placeholderName = derivedName(path);
  const submittable = path.trim().length > 0 && path.trim().startsWith('/');

  const startProgressPoll = (correlationId) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/adopt/progress/${correlationId}`);
        if (!res.ok) return;
        const body = await res.json();
        setStage(body.stage);
        if (body.stage === 'done' || body.stage === 'error') {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        // Network blip — keep polling.
      }
    }, 1000);
  };

  const handleSubmit = async () => {
    if (!submittable) return;
    const correlationId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `adopt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    correlationRef.current = correlationId;
    setSubmitting(true);
    setStage('validating');
    setPathError(null);
    startProgressPoll(correlationId);

    try {
      const res = await fetch('/api/adopt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: path.trim(),
          name: name.trim() || undefined,
          correlationId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 400 → surface against the path field; everything else → toast.
        if (res.status === 400) {
          setPathError(body.error || 'Invalid path');
          setSubmitting(false);
          setStage(null);
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          return;
        }
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const recsCount = body.recommendedSkills?.length ?? 0;
      const recsSuffix = recsCount > 0 ? ` ${recsCount} skill${recsCount === 1 ? '' : 's'} also recommended.` : '';
      toast(`Adopted ${body.projectName} — review the starter team.${recsSuffix}`, 'success');
      onClose();
      navigate(`/projects/${body.projectName}/runs/${body.proposalId}`);
    } catch (e) {
      toast(`Adoption failed: ${e.message}`, 'error');
      setSubmitting(false);
      setStage(null);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  };

  const footer = submitting ? null : (
    <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <span className={styles.footerSpacer} />
      <Button variant="primary" onClick={handleSubmit} disabled={!submittable}>
        Adopt
      </Button>
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={submitting ? `Adopting ${name || placeholderName || 'project'}…` : 'Adopt a repo'}
      footer={footer}
      dismissOnBackdrop={!submitting}
    >
      {submitting ? (
        <ProgressView stage={stage} />
      ) : (
        <div className={styles.form}>
          <Input
            label="Path on disk"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Users/you/code/your-repo"
            helperText="Absolute path to an existing git repository."
            error={pathError}
            required
            autoFocus
          />
          <Input
            label="Project name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholderName || 'derived from path'}
            helperText="Defaults to the directory name. Must be unique in your project list."
          />

          <div className={styles.next}>
            <span className={styles.nextLabel}>What happens next</span>
            <ul className={styles.nextList}>
              <li>We register the project</li>
              <li>A discovery agent reads the repo (~30–60s)</li>
              <li>We write <code>CLAUDE.md</code> and stage a starter team for your review</li>
            </ul>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function ProgressView({ stage }) {
  // Group server stages into the three user-facing phases the wireframe
  // shows. Stage transitions are mapped to glyphs: done (✓), active (⟳),
  // pending (·). 'error' falls through; the catch in handleSubmit surfaces
  // the message via toast and the sheet exits to the form view.
  const phaseFor = (s) => {
    if (!s) return 0;
    if (s === 'validating' || s === 'registering') return 0;
    if (s === 'discovering') return 1;
    if (s === 'writing-claude-md' || s === 'creating-proposal') return 2;
    if (s === 'done') return 3;
    return 0;
  };
  const active = phaseFor(stage);

  const phases = [
    'Setting up project',
    'Discovery agent is reading your repo',
    'Writing CLAUDE.md and staging team proposal',
  ];

  return (
    <div className={styles.progress}>
      {phases.map((label, i) => {
        const glyph = i < active ? '✓' : i === active ? '⟳' : '·';
        const tone = i < active ? 'done' : i === active ? 'active' : 'pending';
        return (
          <div key={label} className={styles.progressRow} data-tone={tone}>
            <span className={styles.progressGlyph}>{glyph}</span>
            <span className={styles.progressLabel}>{label}</span>
          </div>
        );
      })}
      <p className={styles.progressHint}>This usually takes 30–60 seconds.</p>
    </div>
  );
}

function derivedName(path) {
  const trimmed = path.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const last = trimmed.split('/').pop();
  return last || '';
}
