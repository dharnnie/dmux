import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import Button from './Button';
import ConvertToProposalModal from './ConvertToProposalModal';
import { useToast } from './Toasts';
import styles from './ChatSurface.module.css';

/**
 * ChatSurface — Wave 3B Slice 1.
 *
 * Generalized chat component used by project-scoped (this slice) and
 * dmux-global (Slice 2) chats. Scope-specific bits (apiBase URL, label) are
 * props so the component stays scope-agnostic.
 *
 * Dispatch is via `claude --print` on the server (same auth path as Wave 2D
 * per-proposal chat — Max subscription via the Claude Code CLI, no separate
 * API key). Non-streaming: optimistic user-message append, then "thinking…"
 * placeholder while the server waits, then the full assistant message.
 *
 * Props:
 *   apiBase         — e.g. '/api/chat/project/<name>'
 *   scopeLabel      — short heading label
 *   subtitle        — optional one-liner under the heading
 *   defaultProject  — for the Convert modal; pre-selected target project
 *                     (locked when lockProject=true)
 *   lockProject     — true for project-scoped chats; user can't change target
 */
export default function ChatSurface({
  apiBase,
  scopeLabel,
  subtitle,
  defaultProject = null,
  lockProject = false,
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [state, setState] = useState(null);  // initial GET response
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
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

  // Scroll to bottom when messages change or while we're waiting on a reply.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [state?.count, sending]);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;

    // Optimistic: append user message immediately.
    const ts = new Date().toISOString();
    const optimisticUser = { role: 'user', content: trimmed, ts };
    setState((prev) => ({
      ...prev,
      messages: [...(prev?.messages ?? []), optimisticUser],
      count: (prev?.count ?? 0) + 1,
    }));
    setDraft('');
    setSending(true);

    try {
      const res = await fetch(`${apiBase}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState((prev) => ({
          ...prev,
          messages: prev.messages.slice(0, -1),
          count: prev.count - 1,
        }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, body.message],
        count: body.count,
        nearLimit: body.nearLimit,
        atHardCap: body.atHardCap,
      }));
    } catch (e) {
      toast(`Chat: ${e.message}`, 'error');
    } finally {
      setSending(false);
    }
  };

  if (state === null) {
    return <p className={styles.loading}>Loading chat…</p>;
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
        {sending && <Message role="assistant" content="…" thinking />}
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
          disabled={sending || state.atHardCap}
        />
        <div className={styles.composerRow}>
          <span className={styles.counter} data-tone={state.nearLimit ? 'warn' : 'normal'}>
            {state.count} / 100 messages
            {state.nearLimit && !state.atHardCap ? ' · approaching limit' : ''}
          </span>
          <span className={styles.composerSpacer} />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConvertOpen(true)}
            disabled={sending || state.count === 0}
          >
            Convert to proposal
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            loading={sending}
            disabled={!draft.trim() || state.atHardCap}
          >
            Send
          </Button>
        </div>
        <p className={styles.composerHint}>⌘/Ctrl + Enter to send</p>
      </div>

      <ConvertToProposalModal
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        defaultProject={defaultProject}
        lockProject={lockProject}
        convertEndpoint={`${apiBase}/convert`}
        onSuccess={({ proposalId, projectName }) => {
          setConvertOpen(false);
          toast(`Proposal staged on ${projectName} — review the planned team.`, 'success');
          navigate(`/projects/${projectName}/runs/${proposalId}`);
        }}
      />
    </div>
  );
}

function Message({ role, content, hint, thinking }) {
  return (
    <div className={styles.message} data-role={role}>
      <div className={styles.messageHeader}>
        {role === 'user' ? 'You' : 'Assistant'}
        {hint && <span className={styles.messageHint}> · {hint}</span>}
      </div>
      <div className={`${styles.messageBody} ${thinking ? styles.thinking : ''}`}>
        {role === 'assistant' ? (
          <ReactMarkdown>{content}</ReactMarkdown>
        ) : (
          <p>{content}</p>
        )}
      </div>
    </div>
  );
}
