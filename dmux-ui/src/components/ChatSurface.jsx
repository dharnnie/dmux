import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import Button from './Button';
import { useToast } from './Toasts';
import styles from './ChatSurface.module.css';

/**
 * ChatSurface — Wave 3B Slice 1.
 *
 * Generalized chat component used by both project-scoped (this slice) and
 * dmux-global (Slice 2) chats. The scope-specific bits — fetch URL, post
 * URL, greeting, "convert to proposal" wiring — are all passed in as props
 * so this component stays scope-agnostic.
 *
 * Streaming: POSTs to `${apiBase}/message`, parses the SSE response with
 * native fetch + ReadableStream (EventSource only supports GET). Each
 * `data: {...}` frame is one of:
 *   { type: 'delta', text }
 *   { type: 'done',  count, nearLimit }
 *   { type: 'error', message }
 *
 * Props:
 *   apiBase       — e.g. '/api/chat/project/<name>'
 *   scopeLabel    — short label for the heading ("Project chat" / "dmux Chat")
 *   subtitle      — optional one-liner under the heading
 */
export default function ChatSurface({ apiBase, scopeLabel, subtitle }) {
  const toast = useToast();
  const [state, setState] = useState(null);  // initial GET response
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [pendingText, setPendingText] = useState('');  // assistant streaming buffer
  const scrollRef = useRef(null);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiBase);
        if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
        const body = await res.json();
        if (!cancelled) setState(body);
      } catch (e) {
        if (!cancelled) toast(`Couldn't load chat: ${e.message}`, 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, toast]);

  // Scroll to bottom when messages change or streaming text grows.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [state?.count, pendingText, streaming]);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || streaming) return;
    if (!state?.apiKeyConfigured) {
      toast('Set ANTHROPIC_API_KEY in your shell, then restart `dmux ui`.', 'error');
      return;
    }

    // Optimistic: append user message immediately.
    const ts = new Date().toISOString();
    const optimisticUser = { role: 'user', content: trimmed, ts };
    setState((prev) => ({
      ...prev,
      messages: [...(prev?.messages ?? []), optimisticUser],
      count: (prev?.count ?? 0) + 1,
    }));
    setDraft('');
    setStreaming(true);
    setPendingText('');

    let res;
    try {
      res = await fetch(`${apiBase}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
    } catch (e) {
      rollbackUser();
      toast(`Network: ${e.message}`, 'error');
      setStreaming(false);
      return;
    }

    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      rollbackUser();
      toast(`Chat failed: ${body.error || `HTTP ${res.status}`}`, 'error');
      setStreaming(false);
      return;
    }

    // Parse SSE manually. We POSTed, so EventSource isn't usable.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    let finished = false;
    let errorMessage = null;

    while (!finished) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (e) {
        errorMessage = e.message;
        break;
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      // SSE frames are separated by a blank line.
      const frames = buffer.split('\n\n');
      buffer = frames.pop();  // keep the trailing partial
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        let evt;
        try {
          evt = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (evt.type === 'delta') {
          accumulated += evt.text;
          setPendingText(accumulated);
        } else if (evt.type === 'done') {
          finished = true;
          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: 'assistant', content: accumulated, ts: new Date().toISOString() },
            ],
            count: evt.count,
            nearLimit: evt.nearLimit,
          }));
          setPendingText('');
        } else if (evt.type === 'error') {
          errorMessage = evt.message;
          finished = true;
        }
      }
    }

    setStreaming(false);
    if (errorMessage) {
      // The user message stays appended; the failed assistant turn is
      // dropped. The user can re-send or rephrase.
      setPendingText('');
      toast(`Chat: ${errorMessage}`, 'error');
    }

    function rollbackUser() {
      setState((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -1),
        count: prev.count - 1,
      }));
    }
  };

  if (state === null) {
    return <p className={styles.loading}>Loading chat…</p>;
  }

  if (!state.apiKeyConfigured) {
    return <ApiKeyMissingPanel />;
  }

  return (
    <div className={styles.chat}>
      <header className={styles.header}>
        <div className={styles.headerLabel}>{scopeLabel}</div>
        {subtitle && <div className={styles.headerSubtitle}>{subtitle}</div>}
      </header>

      <div className={styles.messages} ref={scrollRef}>
        <Message role="assistant" content={state.greeting} hint="opener" />
        {state.messages.map((m, i) => (
          <Message key={i} role={m.role} content={m.content} />
        ))}
        {streaming && (
          <Message
            role="assistant"
            content={pendingText || '▌'}
            thinking={!pendingText}
            streaming
          />
        )}
      </div>

      <div className={styles.composer}>
        <textarea
          className={styles.input}
          rows={2}
          placeholder={state.atHardCap
            ? 'Chat too long — start a new chat or convert this one to a proposal.'
            : 'Ask anything about this project…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={streaming || state.atHardCap}
        />
        <div className={styles.composerRow}>
          <span className={styles.counter} data-tone={state.nearLimit ? 'warn' : 'normal'}>
            {state.count} / 100 messages
            {state.nearLimit && !state.atHardCap ? ' · approaching limit' : ''}
          </span>
          <span className={styles.composerSpacer} />
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            loading={streaming}
            disabled={!draft.trim() || state.atHardCap}
          >
            Send
          </Button>
        </div>
        <p className={styles.composerHint}>⌘/Ctrl + Enter to send</p>
      </div>
    </div>
  );
}

function Message({ role, content, hint, thinking, streaming }) {
  return (
    <div className={styles.message} data-role={role}>
      <div className={styles.messageHeader}>
        {role === 'user' ? 'You' : 'Assistant'}
        {hint && <span className={styles.messageHint}> · {hint}</span>}
      </div>
      <div className={`${styles.messageBody} ${thinking ? styles.thinking : ''}`}>
        {role === 'assistant' ? (
          <ReactMarkdown>{content + (streaming && !thinking ? '▌' : '')}</ReactMarkdown>
        ) : (
          <p>{content}</p>
        )}
      </div>
    </div>
  );
}

function ApiKeyMissingPanel() {
  return (
    <div className={styles.apiKeyPanel}>
      <h2>Chat needs an ANTHROPIC_API_KEY</h2>
      <p>
        dmux chat uses the Anthropic SDK directly so it can stream responses
        and stay efficient on long sessions. Set the env var in the shell
        that runs <code>dmux ui</code>:
      </p>
      <pre className={styles.apiKeyCode}>export ANTHROPIC_API_KEY=sk-ant-...</pre>
      <p>
        Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>.
      </p>
      <p className={styles.apiKeyHint}>
        Everything else in dmux works without this — only chat requires it.
      </p>
    </div>
  );
}
