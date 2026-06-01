import { useEffect, useState } from 'react';

/**
 * useMcpCatalogue — Wave 3D Slice 2 (+ Slice 3 backend flag).
 *
 * Fetches /api/mcp/catalogue once on mount. Returns:
 *   catalogue       — array of catalogue entries
 *   byName          — Map for O(1) lookups
 *   secretsBackend  — 'keychain' on macOS, 'env' elsewhere. UI uses this to
 *                     switch credential input affordance (paste actual
 *                     secret vs paste env-var name).
 *   ready           — true once the fetch resolves
 */
export default function useMcpCatalogue() {
  const [catalogue, setCatalogue] = useState([]);
  const [secretsBackend, setSecretsBackend] = useState('env');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/mcp/catalogue')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        if (body && Array.isArray(body.catalogue)) {
          setCatalogue(body.catalogue);
          setSecretsBackend(body.secretsBackend === 'keychain' ? 'keychain' : 'env');
        } else if (Array.isArray(body)) {
          // Tolerate the pre-Slice-3 shape just in case.
          setCatalogue(body);
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  const byName = new Map(catalogue.map((e) => [e.name, e]));
  return { catalogue, byName, secretsBackend, ready };
}
