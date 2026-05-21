import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sheet from './Sheet';
import Button from './Button';
import { Select } from './Field';
import { useToast } from './Toasts';
import styles from './NewRunSheet.module.css';

/**
 * NewRunSheet — Section 4.6 (Wave 2A skeleton).
 *
 * Three-step Wizard inside the Sheet primitive:
 *   1. Path choice (Quick now; Smart shows "Coming in Wave 2B")
 *   2. Pick skill (project select + skill cards)
 *   3. Review + Save & Run
 *
 * On Save & Run:
 *   - POST /api/projects/:name/skills/:skill — writes .dmux-agents.yml
 *   - POST /api/projects/:name/agents/start with { trigger } body — the
 *     bash side picks up the trigger via env and records it on the Run
 *   - Navigate to /projects/:name so the user sees the new run in History
 *
 * Props:
 *   open, onClose — standard Sheet controls
 *   initialProject — project name to pre-select (passes through Step 2)
 */
export default function NewRunSheet({ open, onClose, initialProject = null }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState('path');
  const [path, setPath] = useState(null); // 'quick' | 'smart'
  const [project, setProject] = useState(initialProject);
  const [skill, setSkill] = useState(null);
  const [projects, setProjects] = useState([]);
  const [skills, setSkills] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  // Reset internal state every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setStep('path');
    setPath(null);
    setProject(initialProject);
    setSkill(null);
    setSubmitting(false);
  }, [open, initialProject]);

  useEffect(() => {
    if (!open) return;
    fetch('/api/projects').then((r) => r.json()).then(setProjects).catch(() => setProjects([]));
    fetch('/api/skills').then((r) => r.json()).then(setSkills).catch(() => setSkills([]));
  }, [open]);

  const stepIndex = step === 'path' ? 1 : step === 'skill' ? 2 : 3;
  const stepLabel = step === 'path' ? 'Choose path' : step === 'skill' ? 'Pick skill' : 'Review';
  const title = `Step ${stepIndex} of 3 — ${stepLabel}`;
  const isReview = step === 'review';

  const handleBack = () => {
    if (submitting) return;
    if (step === 'review') setStep('skill');
    else if (step === 'skill') setStep('path');
  };

  const handleSaveAndRun = async () => {
    if (!project || !skill) return;
    setSubmitting(true);
    try {
      // 1. Apply the skill — writes .dmux-agents.yml in the project
      const applyRes = await fetch(`/api/projects/${project}/skills/${skill.name}`, { method: 'POST' });
      const applyBody = await applyRes.json().catch(() => ({}));
      if (!applyRes.ok || !applyBody.ok) {
        throw new Error(applyBody.message || applyBody.error || `Apply failed (HTTP ${applyRes.status})`);
      }

      // 2. Start agents with the trigger so the new Run records it
      const startRes = await fetch(`/api/projects/${project}/agents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: { type: 'skill', skill_name: skill.name } }),
      });
      const startBody = await startRes.json().catch(() => ({}));
      if (!startRes.ok || !startBody.ok) {
        throw new Error(startBody.error || `Start failed (HTTP ${startRes.status})`);
      }

      toast(`Run started — ${skill.name} on ${project}`, 'success');
      onClose();
      navigate(`/projects/${project}`);
    } catch (e) {
      toast(`Couldn't start run: ${e.message}`, 'error');
      setSubmitting(false);
    }
  };

  // Footer changes per step. Step 1 has no footer (cards advance), step 2
  // gets [Back] (cards advance), step 3 gets [Back] [Save & Run].
  let footer = null;
  if (step === 'skill') {
    footer = (
      <>
        <span className={styles.footerSpacer} />
        <Button variant="secondary" onClick={handleBack}>← Back</Button>
      </>
    );
  } else if (step === 'review') {
    footer = (
      <>
        <Button variant="secondary" onClick={handleBack} disabled={submitting}>
          ← Back
        </Button>
        <span className={styles.footerSpacer} />
        <Button variant="primary" onClick={handleSaveAndRun} loading={submitting}>
          Save & Run
        </Button>
      </>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={title}
      footer={footer}
      dismissOnBackdrop={!isReview}
    >
      <div className={styles.steps}>
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`${styles.dot} ${n <= stepIndex ? styles.dotActive : ''}`}
            aria-hidden="true"
          />
        ))}
      </div>

      {step === 'path' && (
        <PathStep
          onPick={(p) => {
            setPath(p);
            setStep('skill');
          }}
        />
      )}

      {step === 'skill' && (
        <SkillStep
          projects={projects}
          project={project}
          onProjectChange={setProject}
          skills={skills}
          onPickSkill={(s) => {
            setSkill(s);
            setStep('review');
          }}
          onClose={onClose}
        />
      )}

      {step === 'review' && (
        <ReviewStep project={project} skill={skill} />
      )}
    </Sheet>
  );
}

// ---------- Step 1: Path choice ----------

function PathStep({ onPick }) {
  return (
    <div className={styles.pathGrid}>
      <button
        type="button"
        className={styles.pathCard}
        onClick={() => onPick('quick')}
      >
        <span className={styles.pathGlyph} aria-hidden="true">⚡</span>
        <div className={styles.pathBody}>
          <div className={styles.pathTitle}>Quick</div>
          <div className={styles.pathDesc}>
            Pick a skill and launch. Best when an existing skill matches what
            you want to do.
          </div>
          <div className={styles.pathArrow} aria-hidden="true">Choose →</div>
        </div>
      </button>

      <button
        type="button"
        className={`${styles.pathCard} ${styles.pathCardDisabled}`}
        disabled
        aria-disabled="true"
      >
        <span className={styles.pathGlyph} aria-hidden="true">✨</span>
        <div className={styles.pathBody}>
          <div className={styles.pathTitle}>Smart</div>
          <div className={styles.pathDesc}>
            Describe the work in your own words and let a planner agent
            propose the team.
          </div>
          <div className={styles.pathSoon}>Coming in Wave 2B</div>
        </div>
      </button>
    </div>
  );
}

// ---------- Step 2: Pick skill ----------

function SkillStep({ projects, project, onProjectChange, skills, onPickSkill, onClose }) {
  return (
    <div className={styles.skillStep}>
      <Select
        label="Project"
        value={project ?? ''}
        onChange={(e) => onProjectChange(e.target.value || null)}
        helperText="The skill will overwrite this project's .dmux-agents.yml."
      >
        <option value="">— pick a project —</option>
        {projects.map((p) => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </Select>

      {skills.length === 0 ? (
        <div className={styles.empty}>No skills available.</div>
      ) : (
        <ul className={styles.skillList}>
          {skills.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                className={`${styles.skillCard} ${!project ? styles.skillCardDisabled : ''}`}
                onClick={() => project && onPickSkill(s)}
                disabled={!project}
              >
                <div className={styles.skillTop}>
                  <span className={styles.skillName}>{s.name}</span>
                  <span className={styles.skillProvider}>{s.provider}</span>
                </div>
                <div className={styles.skillDesc}>{s.description}</div>
                <div className={styles.skillMeta}>
                  {s.installed ? 'installed' : 'built-in'}
                  {s.tags?.length > 0 && ` · ${s.tags.join(', ')}`}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.altRow}>
        <span className={styles.altLabel}>Or use the existing config</span>
        <Button
          variant="ghost"
          size="sm"
          to={project ? `/projects/${project}/agents` : undefined}
          disabled={!project}
          onClick={onClose}
        >
          Edit .dmux-agents.yml →
        </Button>
      </div>
    </div>
  );
}

// ---------- Step 3: Review ----------

function ReviewStep({ project, skill }) {
  return (
    <div className={styles.reviewStep}>
      <div className={styles.reviewRow}>
        <span className={styles.reviewLabel}>Project</span>
        <code className={styles.reviewValue}>{project}</code>
      </div>
      <div className={styles.reviewRow}>
        <span className={styles.reviewLabel}>Skill</span>
        <code className={styles.reviewValue}>{skill?.name}</code>
      </div>
      {skill?.description && (
        <p className={styles.reviewDesc}>{skill.description}</p>
      )}
      <div className={styles.reviewWarning} role="alert">
        <strong>⚠ This will overwrite the existing <code>.dmux-agents.yml</code></strong> in {project} and immediately start agents in a fresh tmux session.
      </div>
    </div>
  );
}
