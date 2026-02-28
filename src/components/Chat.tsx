import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';

type ServerMessage =
  | { type: 'join'; user: string; timestamp: number }
  | { type: 'leave'; user: string; timestamp: number }
  | { type: 'message'; user: string; text: string; timestamp: number }
  | { type: 'error'; text: string };

type Status = 'connecting' | 'connected' | 'disconnected';

interface Props {
  room: string;
  username: string;
}

export default function Chat(props: Props) {
  const [messages, setMessages] = createSignal<ServerMessage[]>([]);
  const [status, setStatus] = createSignal<Status>('connecting');
  const [input, setInput] = createSignal('');
  let ws: WebSocket | null = null;
  let bottomRef: HTMLDivElement | undefined;

  onMount(() => {
    const base = (import.meta.env.VITE_CHAT_WS_URL ?? 'ws://localhost:8787').replace(/\/$/, '');
    ws = new WebSocket(`${base}/ws/${encodeURIComponent(props.room)}`);

    ws.onopen = () => {
      setStatus('connected');
      ws?.send(JSON.stringify({ type: 'join', user: props.username }));
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      setMessages((prev) => [...prev, msg]);
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
          {(msg) => (
            <Show
              when={msg.type === 'message'}
              fallback={
                <div style={{ color: '#999', 'font-size': '0.8em', margin: '0.25rem 0', 'font-style': 'italic' }}>
                  {msg.type === 'join'
                    ? `${(msg as any).user} joined`
                    : msg.type === 'leave'
                      ? `${(msg as any).user} left`
                      : `error: ${(msg as any).text}`}
                </div>
              }
            >
              <div style={{ margin: '0.35rem 0' }}>
                <strong>{(msg as any).user}: </strong>
                <span>{(msg as any).text}</span>
              </div>
            </Show>
          )}
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
          type='submit'
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
