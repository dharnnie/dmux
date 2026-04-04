import { useState, useEffect, useRef, useCallback } from 'react';

export default function useAgentStatus(projectName) {
  const [status, setStatus] = useState({ running: false, agents: [], session: null });
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback(() => {
    if (!projectName) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: 'subscribe:status', project: projectName }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'status' && data.project === projectName) {
          setStatus({ running: data.running, agents: data.agents, session: data.session });
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 3s
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }, [projectName]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({ type: 'unsubscribe' }));
        wsRef.current.close();
      }
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  const refresh = useCallback(() => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe:status', project: projectName }));
    }
  }, [projectName]);

  return { ...status, connected, refresh };
}
