import { Title } from '@solidjs/meta';
import { createSignal, For, onMount, Show } from 'solid-js';
import { fetchRegistry, type RegistryEntry } from '~/lib/dm-api';

function abbrev(hash: string): string {
  return `${hash.slice(0, 12)}…${hash.slice(-8)}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function KeyRow(props: { label: string; value: string }) {
  return (
    <div class='flex items-center gap-2 mt-1'>
      <span class='text-xs text-slate-400 w-12 shrink-0'>{props.label}</span>
      <span class='font-mono text-xs text-slate-500 truncate flex-1' title={props.value}>
        {abbrev(props.value)}
      </span>
      <button
        type='button'
        class='shrink-0 text-xs text-slate-300 hover:text-slate-500 cursor-pointer transition-colors'
        title='Copy'
        onClick={() => navigator.clipboard.writeText(props.value)}
      >
        copy
      </button>
    </div>
  );
}

function MailboxCard(props: { entry: RegistryEntry }) {
  return (
    <div class='bg-white border border-slate-200 rounded-lg px-4 py-3 shadow-sm'>
      <div class='flex items-start justify-between gap-4'>
        <div class='min-w-0 flex-1'>
          <div class='flex items-center gap-2'>
            <span class='text-sm font-semibold text-slate-800'>{props.entry.username}</span>
            <span class='font-mono text-xs text-slate-400'>{abbrev(props.entry.hash)}</span>
            <button
              type='button'
              class='text-xs text-slate-300 hover:text-slate-500 cursor-pointer transition-colors'
              title='Copy identity hash'
              onClick={() => navigator.clipboard.writeText(props.entry.hash)}
            >
              copy
            </button>
          </div>
          <span class='text-xs text-slate-400'>Registered {formatDate(props.entry.registeredAt)}</span>
          <div class='mt-2 border-t border-slate-100 pt-2'>
            <KeyRow label='ECDSA' value={props.entry.ecdsaPub} />
            <KeyRow label='ECDH' value={props.entry.ecdhPub} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Mailboxes() {
  const [entries, setEntries] = createSignal<RegistryEntry[] | null>(null);
  const [error, setError] = createSignal(false);

  onMount(async () => {
    try {
      setEntries(await fetchRegistry());
    } catch {
      setError(true);
    }
  });

  return (
    <>
      <Title>Mailboxes – Wett Chat</Title>
      <div class='min-h-dvh bg-slate-50 p-4 sm:p-8'>
        <div class='max-w-2xl mx-auto'>
          <h1 class='text-2xl font-semibold text-slate-800 mb-1'>Mailboxes</h1>
          <p class='text-sm text-slate-400 mb-6'>All identities that have registered with the server.</p>

          <Show when={entries() === null && !error()}>
            <p class='text-sm text-slate-400'>Loading…</p>
          </Show>

          <Show when={error()}>
            <p class='text-sm text-red-500'>Failed to load registry.</p>
          </Show>

          <Show when={entries()?.length === 0}>
            <p class='text-sm text-slate-400'>No registered mailboxes yet.</p>
          </Show>

          <Show when={(entries()?.length ?? 0) > 0}>
            <div class='flex flex-col gap-2'>
              <For each={entries() ?? []}>{(entry) => <MailboxCard entry={entry} />}</For>
            </div>
            <p class='text-xs text-slate-400 mt-4 text-right'>
              {entries()?.length} mailbox{entries()?.length === 1 ? '' : 'es'}
            </p>
          </Show>

          <div class='mt-8'>
            <a href='/' class='text-sm text-indigo-500 hover:text-indigo-700'>
              ← Back to chat
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
