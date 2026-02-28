import { createSignal } from 'solid-js';

export default function Counter() {
  const [count, setCount] = createSignal(0);
  return (
    <button
      class='px-8 py-3 text-indigo-700 bg-indigo-50 rounded-full border-2 border-transparent w-48 tabular-nums cursor-pointer font-medium transition-colors hover:bg-indigo-100 focus:outline-none focus:border-indigo-500 active:bg-indigo-200'
      onClick={() => setCount(count() + 1)}
      type='button'
    >
      Clicks: {count()}
    </button>
  );
}
