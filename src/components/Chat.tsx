import { createSignal, For, onCleanup, onMount } from 'solid-js';

type DisplayMessage =
  | { type: 'join'; user: string; signature: string; timestamp: number }
  | { type: 'leave'; user: string; signature: string; timestamp: number }
  | { type: 'message'; user: string; signature: string; text: string; timestamp: number }
  | { type: 'error'; text: string };

type ServerMessage = DisplayMessage | { type: 'history'; messages: Array<Extract<DisplayMessage, { type: 'message' }>> };

type Status = 'connecting' | 'connected' | 'disconnected';

interface Props {
  room: string;
  username: string;
  secret: string;
}

/** Derive a stable hue from the first 3 bytes of the signature hex. */
function sigColor(sig: string): string {
  const hue = (parseInt(sig.slice(0, 6), 16) % 360 + 360) % 360;
  return `hsl(${hue}, 65%, 42%)`;
}

/** Short display label for a signature — first 8 hex chars. */
function sigLabel(sig: string): string {
  return sig.slice(0, 8);
}

function SigBadge(props: { sig: string }) {
  return (
    <span
      title={`Signature: ${props.sig}`}
      style={{
        display: 'inline-block',
        'font-family': 'monospace',
        'font-size': '0.7em',
        background: sigColor(props.sig),
        color: 'white',
        'border-radius': '3px',
        padding: '1px 4px',
        'margin-left': '4px',
        'vertical-align': 'middle',
        cursor: 'default',
      }}
    >
      {sigLabel(props.sig)}
    </span>
  );
}

export default function Chat(props: Props) {
  const [messages, setMessages] = createSignal<DisplayMessage[]>([]);
  const [status, setStatus] = createSignal<Status>('connecting');
  const [input, setInput] = createSignal('');
  let ws: WebSocket | null = null;
  let bottomRef: HTMLDivElement | undefined;

  onMount(() => {
    const base = (import.meta.env.VITE_CHAT_WS_URL ?? 'ws://localhost:8787').replace(/\/$/, '');
    ws = new WebSocket(`${base}/ws/${encodeURIComponent(props.room)}`);

    ws.onopen = () => {
      setStatus('connected');
      ws!.send(JSON.stringify({ type: 'join', user: props.username, secret: props.secret }));
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      if (msg.type === 'history') {
        setMessages(msg.messages);
      } else {
        setMessages((prev) => [...prev, msg]);
      }
      setTimeout(() => bottomRef?.scrollIntoView({ behavior: 'smooth' }), 0);
    };

    ws.onclose = () => setStatus('disconnected');
    ws.onerror = () => setStatus('disconnected');

    onCleanup(() => {
      ws?.close();
      ws = null;
    });
  });

  const send = () => {
    const text = input().trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'message', text }));
    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        height: '100vh',
        'max-width': '640px',
        margin: '0 auto',
        padding: '1rem',
        'box-sizing': 'border-box',
      }}
    >
      <div style={{ 'margin-bottom': '0.5rem' }}>
        <strong>#{props.room}</strong>{' '}
        <span
          style={{
            color: status() === 'connected' ? 'green' : status() === 'connecting' ? 'orange' : 'red',
            'font-size': '0.85em',
          }}
        >
          ● {status()}
        </span>
        <span style={{ 'margin-left': '1rem', color: '#666', 'font-size': '0.85em' }}>as {props.username}</span>
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          border: '1px solid #ccc',
          'border-radius': '4px',
          padding: '0.75rem',
          background: '#fafafa',
        }}
      >
        <For each={messages()}>
          {(msg) => {
            if (msg.type === 'message') {
              return (
                <div style={{ margin: '0.35rem 0' }}>
                  <strong>{msg.user}</strong>
                  <SigBadge sig={msg.signature} />
                  {': '}
                  <span>{msg.text}</span>
                </div>
              );
            }
            if (msg.type === 'join' || msg.type === 'leave') {
              return (
                <div style={{ color: '#999', 'font-size': '0.8em', margin: '0.25rem 0', 'font-style': 'italic' }}>
                  {msg.user}
                  <SigBadge sig={msg.signature} />
                  {msg.type === 'join' ? ' joined' : ' left'}
                </div>
              );
            }
            // error
            return (
              <div style={{ color: 'red', 'font-size': '0.8em', margin: '0.25rem 0' }}>
                error: {msg.text}
              </div>
            );
          }}
        </For>
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', 'margin-top': '0.5rem' }}>
        <input
          style={{ flex: 1, padding: '0.5rem', 'border-radius': '4px', border: '1px solid #ccc', 'font-size': '1rem' }}
          placeholder='Type a message…'
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={status() !== 'connected'}
        />
        <button
          type='button'
          style={{
            padding: '0.5rem 1rem',
            'border-radius': '4px',
            border: 'none',
            background: '#6366f1',
            color: 'white',
            cursor: 'pointer',
          }}
          onClick={send}
          disabled={status() !== 'connected'}
        >
          Send
        </button>
      </div>
    </div>
  );
}
