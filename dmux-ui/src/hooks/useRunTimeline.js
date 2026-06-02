import { useEffect, useState } from 'react';

/**
 * useRunTimeline — Wave 4A Slice 1.
 *
 * Fetches /api/projects/:name/runs/:runId/timeline. Polls every 3s while
 * the run is in the `running` status passed in by the caller; stops once
 * the status leaves `running` (preserving the last fetched list).
 *
 * Returns { events, malformedCount, ready }.
 */
export default function useRunTimeline(projectName, runId, runStatus) {
  const [state, setState] = useState({ events: [], malformedCount: 0 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!projectName || !runId) return;
    let cancelled = false;
    let intervalId = null;

    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/projects/${projectName}/runs/${runId}/timeline`);
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        setState({
          events: Array.isArray(body.events) ? body.events : [],
          malformedCount: typeof body.malformedCount === 'number' ? body.malformedCount : 0,
        });
        setReady(true);
      } catch {
        if (!cancelled) setReady(true);  // surface "loaded but empty"
      }
    };

    fetchOnce();
    if (runStatus === 'running') {
      intervalId = setInterval(fetchOnce, 3000);
    }
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [projectName, runId, runStatus]);

  return { ...state, ready };
}
