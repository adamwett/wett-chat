import { Title } from '@solidjs/meta';
import { createSignal, For, onMount, Show } from 'solid-js';
import Chat from '~/components/Chat';
import { getOrCreateIdentity, type Identity } from '~/lib/crypto';
import { registerMailbox } from '~/lib/dm-api';

// ─── Persistence helpers ──────────────────────────────────────────────────────

type RoomEntry = { room: string; username: string };

function getRoomHistory(): RoomEntry[] {
  try {
    return JSON.parse(localStorage.getItem('chat_room_history') ?? '[]');
  } catch {
    return [];
  }
}

function saveRoomEntry(entry: RoomEntry) {
  const history = getRoomHistory().filter((e) => e.room !== entry.room);
  history.unshift(entry);
  localStorage.setItem('chat_room_history', JSON.stringify(history.slice(0, 20)));
}

function getSavedUsername(): string | null {
  return localStorage.getItem('chat_username') ?? null;
}

function saveUsername(name: string) {
  localStorage.setItem('chat_username', name);
}

// ─── Home ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [identity, setIdentity] = createSignal<Identity | null>(null);
  // null = not yet registered, string = registered username
  const [registeredAs, setRegisteredAs] = createSignal<string | null>(null);
  const [registering, setRegistering] = createSignal(false);
  const [registerError, setRegisterError] = createSignal('');

  const [joined, setJoined] = createSignal<{ room: string; username: string } | null>(null);
  const [roomHistory, setRoomHistory] = createSignal<RoomEntry[]>([]);
  let usernameRef: HTMLInputElement | undefined;
  let roomRef: HTMLInputElement | undefined;

  onMount(async () => {
    setRoomHistory(getRoomHistory());
    const id = await getOrCreateIdentity();
    setIdentity(id);
    // Restore saved registration name (keys are already on the server from a previous session)
    const saved = getSavedUsername();
    if (saved) setRegisteredAs(saved);
  });

  // ── Registration ─────────────────────────────────────────────────────────────

  const register = async (e: Event) => {
    e.preventDefault();
    const username = usernameRef?.value.trim().slice(0, 32);
    if (!username) return;
    const id = identity();
    if (!id) return;

    setRegistering(true);
    setRegisterError('');
    try {
      await registerMailbox(id.identityHash, id.ecdsaPubJwkCanonical, id.ecdhPubJwk, username);
      saveUsername(username);
      setRegisteredAs(username);
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegistering(false);
    }
  };

  // ── Join room ─────────────────────────────────────────────────────────────────

  const joinWith = (room: string, username: string) => {
    saveRoomEntry({ room, username });
    setRoomHistory(getRoomHistory());
    setJoined({ username, room });
  };

  const join = (e: Event) => {
    e.preventDefault();
    const room = roomRef?.value.trim().slice(0, 64);
    const username = registeredAs();
    if (room && username) joinWith(room, username);
  };

  const disconnect = () => setJoined(null);

  const active = () => {
    const j = joined();
    const id = identity();
    return j && id ? { ...j, identity: id } : null;
  };

  return (
    <>
      <Title>Wett Chat</Title>
      <Show
        when={active()}
        fallback={
          <div class='flex flex-col items-center justify-center min-h-dvh bg-slate-50 gap-6 px-4'>
            <div class='bg-white rounded-xl border border-slate-200 shadow-sm p-8 w-full max-w-sm flex flex-col gap-6'>
              {/* ── Registration ── */}
              <div>
                <div class='flex items-center justify-between mb-4'>
                  <h2 class='text-xl font-semibold text-slate-800'>Identity</h2>
                  <a href='/mailboxes' class='text-xs text-slate-400 hover:text-indigo-500 transition-colors'>
                    Mailboxes →
                  </a>
                </div>

                <Show
                  when={registeredAs()}
                  fallback={
                    <form onSubmit={register} class='flex flex-col gap-3'>
                      <input
                        ref={usernameRef}
                        placeholder='Choose a display name'
                        required
                        maxLength={32}
                        class='px-3 py-2 rounded-lg border border-slate-200 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400'
                      />
                      <button
                        type='submit'
                        disabled={registering() || !identity()}
                        class='py-2 bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-600 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
                      >
                        {registering() ? 'Registering…' : identity() ? 'Register' : 'Loading…'}
                      </button>
                      <Show when={registerError()}>
                        <p class='text-xs text-red-500'>{registerError()}</p>
                      </Show>
                    </form>
                  }
                >
                  {(name) => (
                    <div class='flex items-center justify-between gap-3'>
                      <div>
                        <p class='text-sm font-medium text-slate-800'>{name()}</p>
                        <p class='text-xs text-slate-400 font-mono mt-0.5'>{identity()?.identityHash.slice(0, 16)}…</p>
                      </div>
                      <button
                        type='button'
                        class='text-xs text-slate-400 hover:text-slate-600 transition-colors cursor-pointer'
                        onClick={() => {
                          setRegisteredAs(null);
                          localStorage.removeItem('chat_username');
                        }}
                      >
                        change
                      </button>
                    </div>
                  )}
                </Show>
              </div>

              {/* ── Join room (only after registered) ── */}
              <Show when={registeredAs()}>
                <div class='border-t border-slate-100 pt-6'>
                  <h2 class='text-xl font-semibold text-slate-800 mb-4'>Join a room</h2>
                  <form onSubmit={join} class='flex flex-col gap-3 mb-3'>
                    <input
                      ref={roomRef}
                      placeholder='Room name'
                      required
                      maxLength={64}
                      class='px-3 py-2 rounded-lg border border-slate-200 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400'
                    />
                    <button
                      type='submit'
                      class='py-2 bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-600 transition-colors cursor-pointer'
                    >
                      Join
                    </button>
                  </form>
                  <button
                    type='button'
                    onClick={() => joinWith('global', registeredAs() ?? '')}
                    class='w-full py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors cursor-pointer'
                  >
                    Join #global
                  </button>
                </div>
              </Show>
            </div>

            {/* ── Recent rooms ── */}
            <Show when={registeredAs() && roomHistory().length > 0}>
              <div class='w-full max-w-sm'>
                <h3 class='text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1'>Recent rooms</h3>
                <div class='flex flex-col gap-1'>
                  <For each={roomHistory()}>
                    {(entry) => (
                      <div class='flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm'>
                        <div class='flex flex-col min-w-0'>
                          <span class='text-sm font-medium text-slate-800 truncate'>#{entry.room}</span>
                          <span class='text-xs text-slate-400 truncate'>as {entry.username}</span>
                        </div>
                        <button
                          type='button'
                          onClick={() => joinWith(entry.room, registeredAs() ?? '')}
                          class='ml-3 shrink-0 px-3 py-1 bg-indigo-50 text-indigo-600 text-xs font-medium rounded-md hover:bg-indigo-100 transition-colors cursor-pointer'
                        >
                          Join
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        }
      >
        {(info) => (
          <Chat room={info().room} username={info().username} identity={info().identity} onDisconnect={disconnect} />
        )}
      </Show>
    </>
  );
}
