import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import Button from './Button';
import { useToast } from './Toasts';
import styles from './ProposalChat.module.css';

/**
 * ProposalChat — Wave 2D Slice 1.
 *
 * Proposal-scoped chat with the discovery agent. Fetches history on mount,
 * sends a user message and waits for the assistant reply (~30-90s), shows
 * a "Regenerate proposal with this chat" button once the user has said
 * anything.
 *
 * Props:
 *   projectName, proposalId — scope the chat to this proposal
 *   onProposalChange — fired after a successful regenerate so the parent
 *     can re-fetch the run to reflect updated agents
 */
export default function ProposalChat({ projectName, proposalId, onProposalChange }) {
  const toast = useToast();
  const [state, setState] = useState(null);  // { greeting, messages, count, nearLimit, atHardCap }
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const scrollRef = useRef(null);

  // Fetch chat history on mount and whenever the proposal id changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectName}/runs/${proposalId}/chat`);
        if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
        const body = await res.json();
        if (!cancelled) setState(body);
      } catch (e) {
        if (!cancelled) toast(`Couldn't load chat: ${e.message}`, 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [projectName, proposalId, toast]);

  // Scroll to bottom whenever messages change (or while we're awaiting an
  // assistant reply).
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [state?.count, sending]);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending || regenerating) return;
    setSending(true);
    try {
      // Optimistic append of the user message; the server-rendered reply
      // arrives via the response and is appended on success.
      const ts = new Date().toISOString();
      const optimistic = {
        ...state,
        messages: [...(state?.messages ?? []), { role: 'user', content: trimmed, ts }],
        count: (state?.count ?? 0) + 1,
      };
      setState(optimistic);
      setDraft('');

      const res = await fetch(`/api/projects/${projectName}/runs/${proposalId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Roll back the optimistic user message on error.
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
      toast(`Chat failed: ${e.message}`, 'error');
    } finally {
      setSending(false);
    }
  };

  const handleRegenerate = async () => {
    if (regenerating || sending) return;
    setRegenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectName}/runs/${proposalId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast('Proposal regenerated — switch to the Review tab to see the new team.', 'success');
      onProposalChange?.();
    } catch (e) {
      toast(`Regenerate failed: ${e.message}`, 'error');
    } finally {
      setRegenerating(false);
    }
  };

  if (state === null) {
    return <p className={styles.loading}>Loading chat…</p>;
  }

  const userTurns = state.messages.filter((m) => m.role === 'user').length;
  const canRegenerate = userTurns > 0 && !state.atHardCap;

  return (
    <div className={styles.chat}>
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
          placeholder={state.atHardCap ? 'Chat limit reached — start a new proposal to keep going.' : 'Ask discovery a question…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={sending || regenerating || state.atHardCap}
        />
        <div className={styles.composerRow}>
          <span className={styles.counter} data-tone={state.nearLimit ? 'warn' : 'normal'}>
            {state.count} / 25 messages{state.nearLimit && !state.atHardCap ? ' · approaching limit' : ''}
          </span>
          <span className={styles.composerSpacer} />
          {canRegenerate && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRegenerate}
              loading={regenerating}
              disabled={sending}
            >
              Regenerate proposal with this chat
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            loading={sending}
            disabled={!draft.trim() || regenerating || state.atHardCap}
          >
            Send
          </Button>
        </div>
        <p className={styles.composerHint}>⌘/Ctrl + Enter to send</p>
      </div>
    </div>
  );
}

function Message({ role, content, hint, thinking }) {
  return (
    <div className={styles.message} data-role={role}>
      <div className={styles.messageHeader}>
        {role === 'user' ? 'You' : 'Discovery'}
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
