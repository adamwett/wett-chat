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
      class='inline-block font-mono text-xs text-white rounded px-1 py-px ml-1 align-middle cursor-default'
      style={{ background: sigColor(props.sig) }}
    >
      {sigLabel(props.sig)}
    </span>
  );
}

const statusColors: Record<Status, string> = {
  connected: 'text-emerald-500',
  connecting: 'text-amber-500',
  disconnected: 'text-red-500',
};

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
    <div class='flex flex-col h-screen max-w-2xl mx-auto p-4'>
      {/* Header */}
      <div class='flex items-center gap-3 mb-3 pb-3 border-b border-slate-200'>
        <span class='font-semibold text-slate-800 text-lg'>#{props.room}</span>
        <span class={`text-sm font-medium ${statusColors[status()]}`}>● {status()}</span>
        <span class='ml-auto text-sm text-slate-400'>as {props.username}</span>
      </div>

      {/* Messages */}
      <div class='flex-1 overflow-y-auto rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1'>
        <For each={messages()}>
          {(msg) => {
            if (msg.type === 'message') {
              return (
                <div class='text-sm'>
                  <span class='font-semibold text-slate-700'>{msg.user}</span>
                  <SigBadge sig={msg.signature} />
                  <span class='text-slate-400'>{': '}</span>
                  <span class='text-slate-800'>{msg.text}</span>
                </div>
              );
            }
            if (msg.type === 'join' || msg.type === 'leave') {
              return (
                <div class='text-xs text-slate-400 italic'>
                  {msg.user}
                  <SigBadge sig={msg.signature} />
                  {msg.type === 'join' ? ' joined' : ' left'}
                </div>
              );
            }
            return <div class='text-xs text-red-500'>error: {msg.text}</div>;
          }}
        </For>
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div class='flex gap-2 mt-3'>
        <input
          class='flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50'
          placeholder='Type a message…'
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={status() !== 'connected'}
        />
        <button
          type='button'
          class='px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
          onClick={send}
          disabled={status() !== 'connected'}
        >
          Send
        </button>
      </div>
    </div>
  );
}
