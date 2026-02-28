// @refresh reload
import { mount, StartClient } from '@solidjs/start/client';

// biome-ignore  lint/style/noNonNullAssertion: its ok
mount(() => <StartClient />, document.getElementById('app')!);
