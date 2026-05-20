import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import styles from './PlanViewer.module.css';

/**
 * PlanViewer — renders a plan-role agent's markdown output, or the upstream
 * plan that a build/review agent consumed (if any). Reads from the server's
 * agent plan endpoint at /api/projects/:name/runs/:runId/agents/:agentName/plan.
 *
 * Empty states:
 *   - Plan-role agents that haven't written a plan yet: "Plan not written
 *     yet." (active runs)
 *   - Build/review agents with no upstream plan: "No plan for this agent —
 *     it didn't depend on a plan-role agent." (per Section 4.9 copy)
 */
export default function PlanViewer({ projectName, runId, agentName, agentRole, hasUpstreamPlan }) {
  const [plan, setPlan] = useState(null); // null = loading, {} = no plan, { content, path } = loaded
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectName}/runs/${runId}/agents/${agentName}/plan`)
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 404) {
          setPlan({});
          return;
        }
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          setError(body.error || `HTTP ${r.status}`);
          return;
        }
        const body = await r.json();
        setPlan(body);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [projectName, runId, agentName]);

  if (error) {
    return <div className={styles.error}>Couldn't load plan: {error}</div>;
  }

  if (plan === null) {
    return <div className={styles.muted}>Loading…</div>;
  }

  if (!plan.content) {
    if (agentRole === 'plan') {
      return (
        <div className={styles.empty}>
          <p>Plan not written yet.</p>
          <p className={styles.hint}>
            Plan-role agents write to <code>.dmux/runs/{runId}/plans/{agentName}.md</code> as
            they finish. The convention isn't yet implemented in the spawn
            prompt — that ships in a follow-up slice.
          </p>
        </div>
      );
    }
    if (!hasUpstreamPlan) {
      return (
        <div className={styles.empty}>
          <p>No plan for this agent — it didn't depend on a plan-role agent.</p>
        </div>
      );
    }
    return (
      <div className={styles.empty}>
        <p>Upstream plan not available.</p>
        <p className={styles.hint}>
          This agent depends on a plan-role agent that hasn't produced its plan file.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <code className={styles.path}>{plan.path}</code>
      </header>
      <article className={styles.markdown}>
        <ReactMarkdown>{plan.content}</ReactMarkdown>
      </article>
    </div>
  );
}
