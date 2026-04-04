import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import styles from './TerminalPane.module.css';

export default function TerminalPane({ session, paneIndex, agentName }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
      theme: {
        background: '#0a0a0a',
        foreground: '#fafafa',
        cursor: '#fafafa',
        cursorAccent: '#0a0a0a',
        selectionBackground: 'rgba(255, 255, 255, 0.15)',
        black: '#000000',
        red: '#ff4444',
        green: '#63ed40',
        yellow: '#ffa552',
        blue: '#0099ff',
        magenta: '#ff5492',
        cyan: '#0099ff',
        white: '#fafafa',
        brightBlack: '#555555',
        brightRed: '#ff6666',
        brightGreen: '#7fff5e',
        brightYellow: '#ffbd75',
        brightBlue: '#33adff',
        brightMagenta: '#ff7ab1',
        brightCyan: '#33adff',
        brightWhite: '#ffffff',
      },
      cursorBlink: false,
      cursorStyle: 'bar',
      disableStdin: true,
      scrollback: 200,
      convertEol: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Connect WebSocket for this pane
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'subscribe:terminal',
        session,
        pane: paneIndex,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'terminal' && data.pane === paneIndex) {
          term.reset();
          term.write(data.content);
        }
      } catch { /* ignore */ }
    };

    // Handle resize
    const onResize = () => fit.fit();
    const observer = new ResizeObserver(onResize);
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'unsubscribe:terminal',
          session,
          pane: paneIndex,
        }));
      }
      ws.close();
      term.dispose();
    };
  }, [session, paneIndex]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.name}>{agentName}</span>
        <span className={styles.paneLabel}>pane {paneIndex}</span>
      </div>
      <div className={styles.terminal} ref={containerRef} />
    </div>
  );
}
