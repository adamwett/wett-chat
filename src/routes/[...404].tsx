import { Title } from '@solidjs/meta';
import { HttpStatusCode } from '@solidjs/start';

export default function NotFound() {
  return (
    <main class='flex flex-col items-center justify-center min-h-screen text-center px-4'>
      <Title>Not Found</Title>
      <HttpStatusCode code={404} />
      <h1 class='text-6xl font-light uppercase tracking-widest text-indigo-600 mb-4'>404</h1>
      <p class='text-slate-500 max-w-xs leading-relaxed'>
        Page not found. Visit{' '}
        <a class='text-indigo-500 hover:underline' href='https://start.solidjs.com' target='_blank' rel='noopener'>
          start.solidjs.com
        </a>{' '}
        to learn how to build SolidStart apps.
      </p>
    </main>
  );
}
