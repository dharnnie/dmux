import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import Card, { CardTitle } from './Card';
import Disclosure from './Disclosure';
import styles from './HandoffsCard.module.css';

/**
 * HandoffsCard — Wave 3E Slice 1.
 *
 * Renders the plan + review artifacts written by plan-role / review-role
 * agents during a run. Slice 1 ships plan only; review wires up in Slice 2.
 *
 * Each artifact is a Disclosure showing the markdown body via
 * react-markdown plus a structured view of the JSON appendix (task list
 * for plan, findings table for review).
 *
 * The card hides itself entirely when no artifacts exist — Run Detail
 * stays clean for the common no-plan / no-review case.
 */
export default function HandoffsCard({ projectName, runId }) {
  const [state, setState] = useState(null);  // { plan, review }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectName}/runs/${runId}/handoffs`)
      .then((r) => (r.ok ? r.json() : { plan: null, review: null }))
      .then((body) => { if (!cancelled) setState(body); })
      .catch(() => { if (!cancelled) setState({ plan: null, review: null }); });
    return () => { cancelled = true; };
  }, [projectName, runId]);

  if (!state) return null;
  const { plan, review } = state;
  if (!plan && !review) return null;  // hide the card when nothing to show

  return (
    <Card header={<CardTitle>Handoffs</CardTitle>}>
      {plan && <PlanDisclosure plan={plan} />}
      {review && <ReviewDisclosure review={review} />}
    </Card>
  );
}

const VERDICT_TONE = {
  approve: 'green',
  request_changes: 'orange',
  block: 'red',
};

const SEVERITY_TONE = {
  low: 'muted',
  medium: 'orange',
  high: 'red',
  critical: 'red',
};

function ReviewDisclosure({ review }) {
  const verdict = review.structured?.verdict ?? null;
  const findingCount = review.structured?.findings?.length ?? 0;
  const title = (
    <span>
      <span className={styles.icon}>⚖️</span> Review
      {verdict && (
        <span className={styles.verdictChip} data-tone={VERDICT_TONE[verdict] || 'muted'}>
          {verdict.replace('_', ' ')}
        </span>
      )}
      {findingCount > 0 && (
        <span className={styles.titleCount}> · {findingCount} finding{findingCount === 1 ? '' : 's'}</span>
      )}
    </span>
  );

  return (
    <Disclosure title={title}>
      <div className={styles.body}>
        {review.parseError && (
          <div className={styles.warning}>
            <strong>Structured view unavailable.</strong> {review.parseError}. The
            markdown body below is still rendered as the agent wrote it.
          </div>
        )}

        <div className={styles.markdown}>
          <ReactMarkdown>{review.markdown || '(empty review file)'}</ReactMarkdown>
        </div>

        {review.structured && review.structured.findings.length > 0 && (
          <ReviewFindings findings={review.structured.findings} />
        )}
      </div>
    </Disclosure>
  );
}

function ReviewFindings({ findings }) {
  return (
    <div className={styles.structured}>
      <h4 className={styles.structuredHeader}>Findings</h4>
      <table className={styles.findingsTable}>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Location</th>
            <th>Comment</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f, i) => (
            <tr key={i}>
              <td>
                <span className={styles.severityChip} data-tone={SEVERITY_TONE[f.severity] || 'muted'}>
                  {f.severity}
                </span>
              </td>
              <td className={styles.findingLoc}>
                <code>{f.file}{f.line != null ? `:${f.line}` : ''}</code>
              </td>
              <td>{f.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlanDisclosure({ plan }) {
  const taskCount = plan.structured?.tasks?.length ?? 0;
  const title = (
    <span>
      <span className={styles.icon}>📋</span> Plan
      {plan.structured && (
        <span className={styles.titleMeta}> · {plan.structured.summary}</span>
      )}
      {taskCount > 0 && (
        <span className={styles.titleCount}> · {taskCount} task{taskCount === 1 ? '' : 's'}</span>
      )}
    </span>
  );

  return (
    <Disclosure title={title}>
      <div className={styles.body}>
        {plan.parseError && (
          <div className={styles.warning}>
            <strong>Structured view unavailable.</strong> {plan.parseError}. The
            markdown body below is still rendered as the agent wrote it.
          </div>
        )}

        <div className={styles.markdown}>
          <ReactMarkdown>{plan.markdown || '(empty plan file)'}</ReactMarkdown>
        </div>

        {plan.structured && (
          <PlanStructured plan={plan.structured} />
        )}
      </div>
    </Disclosure>
  );
}

function PlanStructured({ plan }) {
  return (
    <div className={styles.structured}>
      <h4 className={styles.structuredHeader}>Tasks</h4>
      <ol className={styles.taskList}>
        {plan.tasks.map((task) => (
          <li key={task.id} className={styles.task}>
            <span className={styles.taskDesc}>{task.description}</span>
            {task.files.length > 0 && (
              <div className={styles.taskFiles}>
                {task.files.map((f) => (
                  <code key={f} className={styles.fileChip}>{f}</code>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>

      {plan.acceptanceCriteria.length > 0 && (
        <>
          <h4 className={styles.structuredHeader}>Acceptance criteria</h4>
          <ul className={styles.acList}>
            {plan.acceptanceCriteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
