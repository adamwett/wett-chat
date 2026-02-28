import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { Identity } from '~/lib/crypto';
import { createDmStore } from '~/lib/dm-store';
import { CHAT_WS_URL } from '~/lib/env';
import DmPanel from './DmPanel';

type DisplayMessage =
  | { type: 'join'; user: string; signature: string; timestamp: number }
  | { type: 'leave'; user: string; signature: string; timestamp: number }
  | { type: 'message'; user: string; signature: string; text: string; timestamp: number }
  | { type: 'error'; text: string };

type ServerMessage =
  | DisplayMessage
  | { type: 'history'; messages: Array<Extract<DisplayMessage, { type: 'message' }>> };

type Status = 'connecting' | 'connected' | 'disconnected';

interface Props {
  room: string;
  username: string;
  identity: Identity;
  onDisconnect?: () => void;
}

/** Derive a stable hue from the first 3 bytes of the signature hex. */
function sigColor(sig: string): string {
  const hue = ((parseInt(sig.slice(0, 6), 16) % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 42%)`;
}

/** Short display label for a signature — first 8 hex chars. */
function sigLabel(sig: string): string {
  return sig.slice(0, 8);
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
  const [dmOpen, setDmOpen] = createSignal(false);
  const [dmPeer, setDmPeer] = createSignal<string | undefined>(undefined);
  const dm = createDmStore(props.identity);
  let ws: WebSocket | null = null;
  let bottomRef: HTMLDivElement | undefined;

  onMount(() => {
    onCleanup(dm.connect());
  });

  onMount(() => {
    ws = new WebSocket(`${CHAT_WS_URL}/ws/${encodeURIComponent(props.room)}`);

    ws.onopen = () => {
      setStatus('connected');
      // Use the canonical ECDSA public key JWK as the secret so:
      // server signature = SHA-256(secret) = SHA-256(ecdsaPubJwk) = identityHash
      ws?.send(JSON.stringify({ type: 'join', user: props.username, secret: props.identity.ecdsaPubJwkCanonical }));
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

  const openDm = (sig: string) => {
    // Don't DM yourself
    if (sig === props.identity.identityHash) return;
    setDmPeer(sig);
    setDmOpen(true);
    dm.setUnread(false);
  };

  function SigBadge(bprops: { sig: string }) {
    const isMe = bprops.sig === props.identity.identityHash;
    return (
      <button
        type='button'
        title={isMe ? `You (${bprops.sig})` : `Click to DM · ${bprops.sig}`}
        class={`inline-block font-mono text-xs text-white rounded px-1 py-px ml-1 align-middle ${isMe ? 'cursor-default' : 'cursor-pointer hover:opacity-80'}`}
        style={{ background: sigColor(bprops.sig) }}
        onClick={() => !isMe && openDm(bprops.sig)}
        disabled={isMe}
      >
        {sigLabel(bprops.sig)}
      </button>
    );
  }

  return (
    <div class='flex h-screen'>
      {/* Chat column */}
      <div class='flex flex-col flex-1 min-w-0 max-w-2xl mx-auto p-3 sm:p-4'>
        {/* Header */}
        <div class='flex items-center gap-2 sm:gap-3 mb-3 pb-3 border-b border-slate-200'>
          <span class='font-semibold text-slate-800 text-base sm:text-lg truncate max-w-[8rem] sm:max-w-none'>#{props.room}</span>
          <span class={`text-sm font-medium shrink-0 ${statusColors[status()]}`}>● {status()}</span>
          <span class='hidden sm:inline text-sm text-slate-400'>as {props.username}</span>
          <button
            type='button'
            class={`relative px-3 py-1 text-xs font-medium border rounded-md transition-colors cursor-pointer ${
              dmOpen()
                ? 'bg-indigo-50 text-indigo-600 border-indigo-200'
                : 'text-slate-500 border-slate-200 hover:bg-slate-50'
            }`}
            onClick={() => {
              setDmOpen((v) => !v);
              dm.setUnread(false);
            }}
          >
            DMs
            <Show when={dm.unread()}>
              <span class='absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full' />
            </Show>
          </button>
          <button
            type='button'
            class='ml-auto px-3 py-1 text-xs font-medium text-slate-500 border border-slate-200 rounded-md hover:bg-slate-50 hover:text-red-500 hover:border-red-200 transition-colors cursor-pointer'
            onClick={() => {
              ws?.close();
              props.onDisconnect?.();
            }}
          >
            Disconnect
          </button>
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

      {/* DM Panel */}
      <Show when={dmOpen()}>
        <div class='fixed inset-0 z-20 flex sm:relative sm:inset-auto sm:z-auto'>
          <DmPanel dm={dm} openPeer={dmPeer()} onClose={() => setDmOpen(false)} />
        </div>
      </Show>
    </div>
  );
}
