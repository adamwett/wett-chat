import { Title } from '@solidjs/meta';
import { createSignal, For, Show } from 'solid-js';
import Chat from '~/components/Chat';

type RoomEntry = { room: string; username: string };

/** Read the persisted secret from localStorage, or generate + store a new one. */
function getOrCreateSecret(): string {
  const existing = localStorage.getItem('chat_secret');
  if (existing) return existing;

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  localStorage.setItem('chat_secret', secret);
  return secret;
}

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

export default function Home() {
  const [joined, setJoined] = createSignal<{ room: string; username: string; secret: string } | null>(null);
  const [roomHistory, setRoomHistory] = createSignal<RoomEntry[]>(getRoomHistory());
  let usernameRef: HTMLInputElement | undefined;
  let roomRef: HTMLInputElement | undefined;

  const joinWith = (room: string, username: string) => {
    const secret = getOrCreateSecret();
    saveRoomEntry({ room, username });
    setRoomHistory(getRoomHistory());
    setJoined({ username, room, secret });
  };

  const join = (e: Event) => {
    e.preventDefault();
    const username = usernameRef?.value.trim().slice(0, 32);
    const room = roomRef?.value.trim().slice(0, 64);
    if (username && room) joinWith(room, username);
  };

  const disconnect = () => setJoined(null);

  return (
    <>
      <Title>Delayed Chat</Title>
      <Show
        when={joined()}
        fallback={
          <div class='flex flex-col items-center justify-center min-h-screen bg-slate-50 gap-6 px-4'>
            <div class='bg-white rounded-xl border border-slate-200 shadow-sm p-8 w-full max-w-sm'>
              <h2 class='text-xl font-semibold text-slate-800 mb-6'>Join a room</h2>
              <form onSubmit={join} class='flex flex-col gap-3'>
                <input
                  ref={usernameRef}
                  placeholder='Username'
                  required
                  maxLength={32}
                  class='px-3 py-2 rounded-lg border border-slate-200 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400'
                />
                <input
                  ref={roomRef}
                  placeholder='Room name'
                  required
                  maxLength={64}
                  class='px-3 py-2 rounded-lg border border-slate-200 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400'
                />
                <button
                  type='submit'
                  class='mt-1 py-2 bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-600 transition-colors cursor-pointer'
                >
                  Join
                </button>
              </form>
            </div>

            <Show when={roomHistory().length > 0}>
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
                          onClick={() => joinWith(entry.room, entry.username)}
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
          <Chat
            room={info().room}
            username={info().username}
            secret={info().secret}
            onDisconnect={disconnect}
          />
        )}
      </Show>
    </>
  );
}
