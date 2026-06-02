import { useEffect, useState } from 'react';

/**
 * useSkillsCatalogue — Wave 3F Slice 2.
 *
 * Fetches the remote skill catalogue once on mount via /api/skills/catalogue.
 * Exposes a refresh() that POSTs /api/skills/refresh-catalogue and updates
 * the same state.
 *
 * Returns { catalogue, fetchedAt, url, warning, ready, refresh, refreshing }.
 *   catalogue.skills — array of catalogue entries
 *   fetchedAt        — ISO string of last successful fetch, or null
 *   warning          — non-null string when the server fell back to a
 *                      stale cache (UI should surface it)
 *   ready            — true once the first fetch resolves
 *   refresh          — () => Promise<void>; sets warning on failure but
 *                      keeps the previous catalogue rendered
 *   refreshing       — true while a refresh is in flight
 */
export default function useSkillsCatalogue() {
  const [catalogue, setCatalogue] = useState({ version: 1, skills: [] });
  const [fetchedAt, setFetchedAt] = useState(null);
  const [url, setUrl] = useState(null);
  const [warning, setWarning] = useState(null);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const applyResponse = (body) => {
    if (!body) return;
    setCatalogue(body.catalogue ?? { version: 1, skills: [] });
    setFetchedAt(body.fetchedAt ?? null);
    setUrl(body.url ?? null);
    setWarning(body.warning ?? null);
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/skills/catalogue')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        applyResponse(body);
        setReady(true);
      })
      .catch(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch('/api/skills/refresh-catalogue', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        applyResponse(body);
      } else {
        // Server returned cached payload alongside the error — render the
        // stale list with a warning rather than going blank.
        if (body.cached) applyResponse(body.cached);
        setWarning(body.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setWarning(e.message);
    } finally {
      setRefreshing(false);
    }
  };

  return { catalogue, fetchedAt, url, warning, ready, refresh, refreshing };
}
