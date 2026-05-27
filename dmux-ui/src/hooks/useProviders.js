import { useEffect, useState } from 'react';

/**
 * useProviders — Wave 3C Slice 2.
 *
 * Single fetch of the provider capability matrix (/api/providers). Used by
 * the Customize panel's provider picker and capability summary line.
 *
 * Returns { providers, byName, ready }:
 *   providers — array of entries from server/lib/providers.js
 *   byName    — Map from provider name → entry, for O(1) lookups
 *   ready     — true once the fetch resolves
 *
 * On fetch failure: ready stays false and providers stays empty. Callers
 * should fall back to a sane default (treat all providers as supported).
 * No retry — refresh fixes it; this isn't a hot path.
 */
export default function useProviders() {
  const [providers, setProviders] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/providers')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (cancelled) return;
        setProviders(Array.isArray(list) ? list : []);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);  // fall through with empty list
      });
    return () => { cancelled = true; };
  }, []);

  const byName = new Map(providers.map((p) => [p.name, p]));
  return { providers, byName, ready };
}
