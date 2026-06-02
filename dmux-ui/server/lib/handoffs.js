/**
 * Handoff artifact readers — Wave 3E Slice 1.
 *
 * Read-only — agents (not dmux) write the artifacts inside their runs.
 * Slice 1 ships plan only; review.md follows in Slice 2.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parsePlanArtifact } from '../../../dmux-core/src/handoffs.js';

function handoffPath(projectPath, runId, name) {
  return join(projectPath, '.dmux', 'runs', runId, 'handoffs', `${name}.md`);
}

/**
 * Read and parse the plan artifact for a run. Returns the
 * parsePlanArtifact result, or null if no plan.md exists.
 *
 * The result always carries the raw markdown when present, even if the
 * JSON appendix is malformed — see parsePlanArtifact's permissive policy.
 */
export function readPlanArtifact(projectPath, runId) {
  const path = handoffPath(projectPath, runId, 'plan');
  if (!existsSync(path)) return null;
  let text;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (e) {
    return { markdown: '', structured: null, parseError: `read failed: ${e.message}` };
  }
  return parsePlanArtifact(text);
}
