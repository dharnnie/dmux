import { useEffect, useState } from 'react';

/**
 * useActivity — Wave 4A Slice 2.
 *
 * Fetches /api/activity (cross-project god-view aggregate) and polls every
 * 3s. Returns { summary, ready } where summary mirrors the server payload:
 *   { activeRunCount, activeAgents, lastEventTs, recentlyCompleted }.
 *
 * Polling continues indefinitely — the page is always live. Unmount stops
 * the interval cleanly.
 */
export default function useActivity() {
  const [summary, setSummary] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const res = await fetch('/api/activity');
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        setSummary(body);
        setReady(true);
      } catch {
        if (!cancelled) setReady(true);
      }
    };

    fetchOnce();
    const intervalId = setInterval(fetchOnce, 3000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  return { summary, ready };
}
