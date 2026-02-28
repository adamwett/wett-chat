import { Title } from '@solidjs/meta';
import { createSignal, Show } from 'solid-js';
import Chat from '~/components/Chat';

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

export default function Home() {
  const [joined, setJoined] = createSignal<{ room: string; username: string; secret: string } | null>(null);
  let usernameRef: HTMLInputElement | undefined;
  let roomRef: HTMLInputElement | undefined;

  const join = (e: Event) => {
    e.preventDefault();
    const username = usernameRef?.value.trim().slice(0, 32);
    const room = roomRef?.value.trim().slice(0, 64);
    if (username && room) setJoined({ username, room, secret: getOrCreateSecret() });
  };

  return (
    <>
      <Title>Delayed Chat</Title>
      <Show
        when={joined()}
        fallback={
          <div class='flex items-center justify-center min-h-screen bg-slate-50'>
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
          </div>
        }
      >
        {(info) => <Chat room={info().room} username={info().username} secret={info().secret} />}
      </Show>
    </>
  );
}
