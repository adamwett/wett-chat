import { createEffect, createSignal, For, Show } from 'solid-js';
import type { DmStore } from '~/lib/dm-store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function abbrev(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  dm: DmStore;
  /** When set, the panel opens/switches to that peer's conversation. */
  openPeer?: string;
  onClose?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DmPanel(props: Props) {
  const [selected, setSelected] = createSignal<string | null>(null);
  const [input, setInput] = createSignal('');
  const [newTarget, setNewTarget] = createSignal('');
  const [sending, setSending] = createSignal(false);
  const [sendError, setSendError] = createSignal('');

  // ── React to openPeer prop ───────────────────────────────────────────────────

  createEffect(() => {
    const peer = props.openPeer;
    if (peer) openConv(peer);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  async function openConv(peerHash: string): Promise<void> {
    setSelected(peerHash);
    await props.dm.openConv(peerHash);
  }

  // ── Send ─────────────────────────────────────────────────────────────────────

  async function send(): Promise<void> {
    const text = input().trim();
    const peer = selected();
    if (!text || !peer) return;

    setSendError('');
    setSending(true);
    try {
      const err = await props.dm.send(peer, text);
      if (err) {
        setSendError(err);
      } else {
        setInput('');
      }
    } catch (err) {
      setSendError(String(err));
    } finally {
      setSending(false);
    }
  }

  // ── Open new DM ──────────────────────────────────────────────────────────────

  async function startNew(e: Event): Promise<void> {
    e.preventDefault();
    const hash = newTarget().trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      setSendError('Enter a valid 64-character identity hash.');
      return;
    }
    setNewTarget('');
    setSendError('');
    await openConv(hash);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const selectedConv = () => props.dm.convs.find((c) => c.peerHash === selected()) ?? null;

  return (
    <div class='flex flex-col h-full bg-white border-l border-slate-200 w-full sm:w-80'>
      {/* Panel header */}
      <div class='flex items-center gap-2 px-3 py-2 border-b border-slate-200 shrink-0'>
        <Show when={selected()}>
          <button
            type='button'
            class='text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer'
            onClick={() => {
              setSelected(null);
              setSendError('');
            }}
          >
            ←
          </button>
        </Show>
        <span class='font-semibold text-slate-800 text-sm flex-1 truncate'>
          {selected() ? `DM · ${abbrev(selected() ?? '')}` : 'Direct messages'}
        </span>
        <button
          type='button'
          class='text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer'
          onClick={props.onClose}
        >
          ✕
        </button>
      </div>

      {/* My identity hash */}
      <div class='px-3 py-1.5 bg-slate-50 border-b border-slate-100 shrink-0'>
        <span class='text-xs text-slate-400'>Your ID: </span>
        <button
          type='button'
          class='text-xs font-mono text-slate-500 cursor-pointer hover:text-indigo-500 transition-colors'
          title='Click to copy'
          onClick={() => navigator.clipboard.writeText(props.dm.identityHash)}
        >
          {abbrev(props.dm.identityHash)}
        </button>
      </div>

      {/* Body */}
      <Show
        when={selected()}
        fallback={
          /* ── Conversation list ── */
          <div class='flex flex-col flex-1 overflow-hidden'>
            <div class='flex-1 overflow-y-auto'>
              <Show
                when={props.dm.convs.length > 0}
                fallback={<p class='text-xs text-slate-400 text-center mt-8 px-4'>No conversations yet.</p>}
              >
                <For each={props.dm.convs}>
                  {(conv) => {
                    const last = () => conv.messages.at(-1);
                    return (
                      <button
                        type='button'
                        class='w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer'
                        onClick={() => openConv(conv.peerHash)}
                      >
                        <div class='text-xs font-mono text-slate-600 truncate'>{abbrev(conv.peerHash)}</div>
                        <div class='text-xs text-slate-400 truncate mt-0.5'>
                          {last() ? (last()?.text ?? '(encrypted)') : 'No messages yet'}
                        </div>
                      </button>
                    );
                  }}
                </For>
              </Show>
            </div>

            {/* New DM form */}
            <div class='shrink-0 border-t border-slate-200 p-3'>
              <form onSubmit={startNew} class='flex flex-col gap-2'>
                <input
                  class='w-full px-2 py-1.5 rounded border border-slate-200 text-xs font-mono placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400'
                  placeholder='Peer identity hash (64 hex chars)'
                  value={newTarget()}
                  onInput={(e) => setNewTarget(e.currentTarget.value)}
                  maxLength={64}
                />
                <button
                  type='submit'
                  class='py-1.5 bg-indigo-500 text-white rounded text-xs font-medium hover:bg-indigo-600 transition-colors cursor-pointer'
                >
                  Open conversation
                </button>
              </form>
              <Show when={sendError()}>
                <p class='text-xs text-red-500 mt-1'>{sendError()}</p>
              </Show>
            </div>
          </div>
        }
      >
        {/* ── Active conversation ── */}
        <div class='flex flex-col flex-1 overflow-hidden'>
          {/* Key fetch states */}
          <Show when={selectedConv()?.peerPubKeys === undefined}>
            <div class='text-xs text-slate-400 bg-slate-50 px-3 py-1.5 border-b border-slate-100'>
              Looking up peer keys…
            </div>
          </Show>
          <Show when={selectedConv()?.peerPubKeys === null}>
            <div class='text-xs text-amber-600 bg-amber-50 px-3 py-1.5 border-b border-amber-100'>
              Peer not registered — they need to open the app first.
            </div>
          </Show>

          {/* Messages */}
          <div class='flex-1 overflow-y-auto p-3 space-y-1'>
            <For each={selectedConv()?.messages ?? []}>
              {(msg) => (
                <div class={`flex ${msg.mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    class={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs ${
                      msg.mine ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    {msg.text !== null ? (
                      <span>{msg.text}</span>
                    ) : (
                      <span class='italic opacity-60'>failed to decrypt</span>
                    )}
                    <Show when={!msg.mine && msg.verified !== null}>
                      <span class='ml-1 opacity-60' title={msg.verified ? 'Signature verified' : 'Signature invalid!'}>
                        {msg.verified ? '✓' : '⚠'}
                      </span>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>

          {/* Compose */}
          <div class='shrink-0 border-t border-slate-200 p-2 flex flex-col gap-1'>
            <div class='flex gap-2'>
              <input
                class='flex-1 px-2 py-1.5 rounded border border-slate-200 text-xs bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50'
                placeholder='Type a message…'
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={sending() || !selectedConv()?.peerPubKeys}
              />
              <button
                type='button'
                class='px-3 py-1.5 bg-indigo-500 text-white text-xs font-medium rounded hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer'
                onClick={send}
                disabled={sending() || !input().trim() || !selectedConv()?.peerPubKeys}
              >
                Send
              </button>
            </div>
            <Show when={sendError()}>
              <p class='text-xs text-red-500'>{sendError()}</p>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
