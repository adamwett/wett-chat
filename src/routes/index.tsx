import { Title } from '@solidjs/meta';
import { createSignal, Show } from 'solid-js';
import Chat from '~/components/Chat';

export default function Home() {
  const [joined, setJoined] = createSignal<{ room: string; username: string } | null>(null);
  let usernameRef: HTMLInputElement | undefined;
  let roomRef: HTMLInputElement | undefined;

  const join = (e: Event) => {
    e.preventDefault();
    const username = usernameRef?.value.trim().slice(0, 32);
    const room = roomRef?.value.trim().slice(0, 64);
    if (username && room) setJoined({ username, room });
  };

  return (
    <>
      <Title>Delayed Chat</Title>
      <Show
        when={joined()}
        fallback={
          <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', height: '100vh' }}>
            <form
              onSubmit={join}
              style={{ display: 'flex', 'flex-direction': 'column', gap: '0.75rem', 'min-width': '280px' }}
            >
              <h2 style={{ margin: 0 }}>Join a room</h2>
              <input
                ref={usernameRef}
                placeholder='Username'
                required
                maxLength={32}
                style={{ padding: '0.5rem', 'font-size': '1rem', 'border-radius': '4px', border: '1px solid #ccc' }}
              />
              <input
                ref={roomRef}
                placeholder='Room name'
                required
                maxLength={64}
                style={{ padding: '0.5rem', 'font-size': '1rem', 'border-radius': '4px', border: '1px solid #ccc' }}
              />
              <button
                type='submit'
                style={{
                  padding: '0.5rem',
                  'font-size': '1rem',
                  background: '#6366f1',
                  color: 'white',
                  border: 'none',
                  'border-radius': '4px',
                  cursor: 'pointer',
                }}
              >
                Join
              </button>
            </form>
          </div>
        }
      >
        {(info) => <Chat room={info().room} username={info().username} />}
      </Show>
    </>
  );
}
