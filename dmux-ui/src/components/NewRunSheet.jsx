import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sheet from './Sheet';
import Button from './Button';
import { Select, Textarea } from './Field';
import FormFromSchema from './FormFromSchema';
import { useToast } from './Toasts';
import styles from './NewRunSheet.module.css';

/**
 * NewRunSheet — Section 4.6.
 *
 * Two paths:
 *   - Quick: 'path' → 'skill' [→ 'inputs'] → 'review' → POST skill apply +
 *     start. Ends at /projects/:name with a running run.
 *   - Smart (Wave 2B PR 3): 'path' → 'smart-prompt' → POST /api/projects/
 *     :name/proposals (planner). Ends at /projects/:name/runs/:proposalId
 *     where the user reviews + approves the proposed team.
 *
 * Props:
 *   open, onClose — standard Sheet controls
 *   initialProject — project name to pre-select
 */
export default function NewRunSheet({ open, onClose, initialProject = null }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState('path');
  const [path, setPath] = useState(null);
  const [project, setProject] = useState(initialProject);
  const [skill, setSkill] = useState(null);
  const [inputValues, setInputValues] = useState({});
  const [inputErrors, setInputErrors] = useState({});
  const [projects, setProjects] = useState([]);
  const [skills, setSkills] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [renderedPreview, setRenderedPreview] = useState(null);
  const [smartPrompt, setSmartPrompt] = useState('');
  const [prdContent, setPrdContent] = useState('');
  const [prdFilename, setPrdFilename] = useState('');

  // Reset internal state every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setStep('path');
    setPath(null);
    setProject(initialProject);
    setSkill(null);
    setInputValues({});
    setInputErrors({});
    setSubmitting(false);
    setRenderedPreview(null);
    setSmartPrompt('');
    setPrdContent('');
    setPrdFilename('');
  }, [open, initialProject]);

  useEffect(() => {
    if (!open) return;
    fetch('/api/projects').then((r) => r.json()).then(setProjects).catch(() => setProjects([]));
    fetch('/api/skills').then((r) => r.json()).then(setSkills).catch(() => setSkills([]));
  }, [open]);

  const hasInputs = Boolean(skill?.inputs && skill.inputs.length > 0);

  // Step index for the progress dots. Smart and PRD paths are 2 steps total
  // (path → input → off to proposal review). Quick is 3 steps with 'inputs'
  // folded into step 2 visually.
  const isSmart = path === 'smart';
  const isPrd = path === 'prd';
  const totalSteps = isSmart || isPrd ? 2 : 3;
  const titleStepNum =
    step === 'path' ? 1 :
    step === 'smart-prompt' ? 2 :
    step === 'prd-input' ? 2 :
    step === 'skill' ? 2 :
    step === 'inputs' ? 2 :
    3;
  const titleLabel = {
    path: 'Choose path',
    'smart-prompt': 'Describe the work',
    'prd-input': 'From PRD',
    skill: 'Pick skill',
    inputs: 'Fill inputs',
    review: 'Review',
  }[step] ?? '';
  const title = `Step ${titleStepNum} of ${totalSteps} — ${titleLabel}`;
  const isReview = step === 'review' || step === 'smart-prompt' || step === 'prd-input';

  const handleBack = () => {
    if (submitting) return;
    if (step === 'review') setStep(hasInputs ? 'inputs' : 'skill');
    else if (step === 'inputs') setStep('skill');
    else if (step === 'skill') setStep('path');
    else if (step === 'smart-prompt') setStep('path');
    else if (step === 'prd-input') setStep('path');
  };

  const handleInputsContinue = () => {
    setInputErrors({});
    setStep('review');
  };

  const handlePrdSubmit = async () => {
    if (!project || !prdContent.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${project}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prdContent,
          source: 'prd',
          prdMarkdown: prdContent,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Planner failed (HTTP ${res.status})`);
      }
      toast(`Proposal ready from ${prdFilename || 'PRD'} — review the planned team.`, 'success');
      onClose();
      navigate(`/projects/${project}/runs/${body.proposalId}`);
    } catch (e) {
      toast(`Planner: ${e.message}`, 'error');
      setSubmitting(false);
    }
  };

  const handleSmartSubmit = async () => {
    if (!project || !smartPrompt.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${project}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: smartPrompt.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Planner failed (HTTP ${res.status})`);
      }
      toast(`Proposal ready — review the planned team.`, 'success');
      onClose();
      navigate(`/projects/${project}/runs/${body.proposalId}`);
    } catch (e) {
      toast(`Planner: ${e.message}`, 'error');
      setSubmitting(false);
    }
  };

  const handleSaveAndRun = async () => {
    if (!project || !skill) return;
    setSubmitting(true);
    setInputErrors({});
    try {
      const applyRes = await fetch(`/api/projects/${project}/skills/${skill.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: inputValues }),
      });
      const applyBody = await applyRes.json().catch(() => ({}));
      if (applyRes.status === 422) {
        // Skill validation failed (missing required, malformed, etc.). Surface
        // the error against the offending input and bounce back to that step.
        if (applyBody.input) {
          setInputErrors({ [applyBody.input]: applyBody.message });
          setStep(hasInputs ? 'inputs' : 'review');
          setSubmitting(false);
          toast(applyBody.message || 'Skill validation failed', 'error');
          return;
        }
        throw new Error(applyBody.message || 'Skill validation failed');
      }
      if (!applyRes.ok || !applyBody.ok) {
        throw new Error(applyBody.message || applyBody.error || `Apply failed (HTTP ${applyRes.status})`);
      }
      setRenderedPreview(applyBody.config ?? null);

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

  // Footer per step.
  let footer = null;
  if (step === 'skill') {
    footer = (
      <>
        <span className={styles.footerSpacer} />
        <Button variant="secondary" onClick={handleBack}>← Back</Button>
      </>
    );
  } else if (step === 'smart-prompt') {
    footer = (
      <>
        <Button variant="secondary" onClick={handleBack} disabled={submitting}>
          ← Back
        </Button>
        <span className={styles.footerSpacer} />
        <Button
          variant="primary"
          onClick={handleSmartSubmit}
          loading={submitting}
          disabled={!project || !smartPrompt.trim()}
        >
          {submitting ? 'Planning…' : 'Plan team →'}
        </Button>
      </>
    );
  } else if (step === 'prd-input') {
    footer = (
      <>
        <Button variant="secondary" onClick={handleBack} disabled={submitting}>
          ← Back
        </Button>
        <span className={styles.footerSpacer} />
        <Button
          variant="primary"
          onClick={handlePrdSubmit}
          loading={submitting}
          disabled={!project || !prdContent.trim()}
        >
          {submitting ? 'Planning…' : 'Plan team →'}
        </Button>
      </>
    );
  } else if (step === 'inputs') {
    footer = (
      <>
        <Button variant="secondary" onClick={handleBack}>← Back</Button>
        <span className={styles.footerSpacer} />
        <Button variant="primary" onClick={handleInputsContinue}>
          Review →
        </Button>
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
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => (
          <span
            key={n}
            className={`${styles.dot} ${n <= titleStepNum ? styles.dotActive : ''}`}
            aria-hidden="true"
          />
        ))}
      </div>

      {step === 'path' && (
        <PathStep
          onPick={(p) => {
            setPath(p);
            if (p === 'smart') setStep('smart-prompt');
            else if (p === 'prd') setStep('prd-input');
            else setStep('skill');
          }}
        />
      )}

      {step === 'smart-prompt' && (
        <SmartPromptStep
          projects={projects}
          project={project}
          onProjectChange={setProject}
          prompt={smartPrompt}
          onPromptChange={setSmartPrompt}
          submitting={submitting}
        />
      )}

      {step === 'prd-input' && (
        <PrdInputStep
          projects={projects}
          project={project}
          onProjectChange={setProject}
          content={prdContent}
          onContentChange={setPrdContent}
          filename={prdFilename}
          onFilenameChange={setPrdFilename}
          submitting={submitting}
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
            setInputValues({});
            setInputErrors({});
            // If this skill has inputs, show the inputs step; otherwise
            // jump straight to review.
            setStep((s?.inputs ?? []).length > 0 ? 'inputs' : 'review');
          }}
          onClose={onClose}
        />
      )}

      {step === 'inputs' && skill && (
        <InputsStep
          skill={skill}
          values={inputValues}
          errors={inputErrors}
          onChange={(name, value) => {
            setInputValues((prev) => ({ ...prev, [name]: value }));
            // Clear any prior server error for this field as soon as the user edits.
            setInputErrors((prev) => {
              if (!prev[name]) return prev;
              const next = { ...prev };
              delete next[name];
              return next;
            });
          }}
        />
      )}

      {step === 'review' && (
        <ReviewStep
          project={project}
          skill={skill}
          inputValues={inputValues}
          hasInputs={hasInputs}
          renderedPreview={renderedPreview}
        />
      )}
    </Sheet>
  );
}

// ---------- Step 1: Path choice ----------

function PathStep({ onPick }) {
  return (
    <div className={styles.pathGrid}>
      <button type="button" className={styles.pathCard} onClick={() => onPick('quick')}>
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

      <button type="button" className={styles.pathCard} onClick={() => onPick('smart')}>
        <span className={styles.pathGlyph} aria-hidden="true">✨</span>
        <div className={styles.pathBody}>
          <div className={styles.pathTitle}>Smart</div>
          <div className={styles.pathDesc}>
            Describe the work in your own words and let a planner agent
            propose the team.
          </div>
          <div className={styles.pathArrow} aria-hidden="true">Describe →</div>
        </div>
      </button>

      <button type="button" className={styles.pathCard} onClick={() => onPick('prd')}>
        <span className={styles.pathGlyph} aria-hidden="true">📄</span>
        <div className={styles.pathBody}>
          <div className={styles.pathTitle}>From PRD</div>
          <div className={styles.pathDesc}>
            Drop or paste a markdown spec you wrote elsewhere. The planner
            reads the whole thing and proposes a team for it.
          </div>
          <div className={styles.pathArrow} aria-hidden="true">Upload →</div>
        </div>
      </button>
    </div>
  );
}

// ---------- Step 2 (PRD): From PRD ----------

function PrdInputStep({
  projects, project, onProjectChange,
  content, onContentChange,
  filename, onFilenameChange,
  submitting,
}) {
  const [dragging, setDragging] = useState(false);

  const ingestFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      onContentChange(text);
      onFilenameChange(file.name);
    } catch {
      // Read failure — surface silently; the textarea is still available.
    }
  };

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    if (file) ingestFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) ingestFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => setDragging(false);

  return (
    <div className={styles.prdStep}>
      <Select
        label="Project"
        value={project ?? ''}
        onChange={(e) => onProjectChange(e.target.value || null)}
        disabled={submitting}
        helperText="The planner reads this project's file tree + your PRD as context."
      >
        <option value="">— pick a project —</option>
        {projects.map((p) => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </Select>

      <div
        className={`${styles.prdDropZone} ${dragging ? styles.prdDropZoneActive : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        Drop a <code>.md</code> file here, or paste content below.
        <label className={styles.prdFileLabel}>
          Pick a file…
          <input
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            onChange={handleFileInput}
            disabled={submitting}
            className={styles.prdFileInput}
          />
        </label>
        {filename && <span className={styles.prdFileName}>📄 {filename}</span>}
      </div>

      <Textarea
        label="PRD or feature spec (markdown)"
        value={content}
        onChange={(e) => {
          onContentChange(e.target.value);
          if (filename) onFilenameChange('');  // edited away from the original file
        }}
        disabled={submitting}
        rows={12}
        placeholder="# Feature name&#10;&#10;## Goal&#10;..."
        helperText={`${content.length} characters${content.length > 0 ? ` · ~${Math.ceil(content.length / 4000)} pages` : ''}`}
      />

      {submitting && (
        <p className={styles.prdHint}>
          Planner is working… this usually takes 10–30 seconds for a PRD.
        </p>
      )}
    </div>
  );
}

// ---------- Step 2 (Smart): Describe the work ----------

function SmartPromptStep({ projects, project, onProjectChange, prompt, onPromptChange, submitting }) {
  return (
    <div className={styles.smartStep}>
      <Select
        label="Project"
        value={project ?? ''}
        onChange={(e) => onProjectChange(e.target.value || null)}
        disabled={submitting}
        helperText="The planner reads this project's file tree and CLAUDE.md for context."
      >
        <option value="">— pick a project —</option>
        {projects.map((p) => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </Select>

      <Textarea
        label="What should the team do?"
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        disabled={submitting}
        rows={6}
        placeholder="e.g. Add OAuth login with tests and a security review."
        helperText="The planner proposes a team of agents based on this request. You'll review and approve before anything runs."
      />

      {submitting && (
        <p className={styles.smartHint}>
          Planner is working… this usually takes 5–15 seconds.
        </p>
      )}
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
                  {s.inputs?.length > 0 && ` · ${s.inputs.length} input${s.inputs.length === 1 ? '' : 's'}`}
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

// ---------- Step 2b: Fill inputs ----------

function InputsStep({ skill, values, errors, onChange }) {
  return (
    <div className={styles.inputsStep}>
      <div className={styles.inputsHeader}>
        <span className={styles.inputsHeaderLabel}>Skill</span>
        <code className={styles.inputsHeaderValue}>{skill.name}</code>
      </div>
      <FormFromSchema
        schema={skill.inputs}
        values={values}
        errors={errors}
        onChange={onChange}
      />
    </div>
  );
}

// ---------- Step 3: Review ----------

function ReviewStep({ project, skill, inputValues, hasInputs, renderedPreview }) {
  // Build a compact summary of the supplied input values for the review screen.
  const filledInputs = useMemo(() => {
    if (!hasInputs) return [];
    return (skill?.inputs ?? []).map((input) => {
      const v = inputValues[input.name];
      let display;
      if (v === undefined || v === null || v === '') display = '(default)';
      else if (Array.isArray(v)) display = v.length === 0 ? '(empty)' : v.join(', ');
      else if (typeof v === 'boolean') display = v ? 'true' : 'false';
      else display = String(v);
      return { name: input.name, display };
    });
  }, [skill, inputValues, hasInputs]);

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
      {skill?.description && <p className={styles.reviewDesc}>{skill.description}</p>}

      {hasInputs && filledInputs.length > 0 && (
        <div className={styles.reviewInputs}>
          <span className={styles.reviewLabel}>Inputs</span>
          <ul className={styles.reviewInputList}>
            {filledInputs.map((row) => (
              <li key={row.name}>
                <code className={styles.reviewInputName}>{row.name}</code>
                <span className={styles.reviewInputArrow} aria-hidden="true">=</span>
                <span className={styles.reviewInputValue}>{row.display}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {renderedPreview && (
        <details className={styles.reviewYaml}>
          <summary>Show generated .dmux-agents.yml</summary>
          <pre>{renderedPreview}</pre>
        </details>
      )}

      <div className={styles.reviewWarning} role="alert">
        <strong>⚠ This will overwrite the existing <code>.dmux-agents.yml</code></strong> in {project} and immediately start agents in a fresh tmux session.
      </div>
    </div>
  );
}
