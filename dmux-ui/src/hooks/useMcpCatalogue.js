import { useEffect, useState } from 'react';

/**
 * useMcpCatalogue — Wave 3D Slice 2.
 *
 * Single fetch of the static MCP server catalogue (/api/mcp/catalogue) on
 * mount, cached for the session. Used by AddMcpServerModal to render the
 * picker + the per-server credential / arg form.
 *
 * Returns { catalogue, byName, ready }.
 */
export default function useMcpCatalogue() {
  const [catalogue, setCatalogue] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/mcp/catalogue')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (cancelled) return;
        setCatalogue(Array.isArray(list) ? list : []);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  const byName = new Map(catalogue.map((e) => [e.name, e]));
  return { catalogue, byName, ready };
}
