/**
 * Thin client for the DmMailbox Durable Object HTTP + WebSocket API.
 * All payloads are opaque to the server — no crypto here.
 */

export interface RemotePubKeys {
  ecdsaPub: string; // JSON-serialized ECDSA public key JWK
  ecdhPub: string;  // JSON-serialized ECDH public key JWK
}

export interface DmEnvelope {
  from: string;       // sender's identity hash
  ciphertext: string; // base64
  iv: string;         // base64
  sig: string;        // base64 ECDSA signature
  timestamp: number;
}

export type DmServerEvent =
  | { type: 'keys'; ecdsaPub: string | null; ecdhPub: string | null }
  | { type: 'history'; messages: DmEnvelope[] }
  | ({ type: 'dm' } & DmEnvelope);

// ─── Base URL helpers ─────────────────────────────────────────────────────────

function httpBase(wsUrl: string): string {
  return wsUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://').replace(/\/$/, '');
}

function wsBase(wsUrl: string): string {
  return wsUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://').replace(/\/$/, '');
}

const DEFAULT_URL = (import.meta.env.VITE_CHAT_WS_URL as string | undefined) ?? 'ws://localhost:8787';

// ─── API ──────────────────────────────────────────────────────────────────────

/** Register the caller's public keys and username with their mailbox DO. Throws on network error. */
export async function registerMailbox(
  identityHash: string,
  ecdsaPub: string,
  ecdhPub: string,
  username: string,
  serverUrl = DEFAULT_URL,
): Promise<void> {
  const res = await fetch(`${httpBase(serverUrl)}/dm/${identityHash}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ecdsaPub, ecdhPub, username }),
  });
  if (!res.ok) throw new Error(`Registration failed: ${res.status} ${res.statusText}`);
}

/** Fetch a peer's public keys via HTTP GET to their mailbox. */
export async function fetchPubKeys(
  identityHash: string,
  serverUrl = DEFAULT_URL,
): Promise<RemotePubKeys | null> {
  try {
    const res = await fetch(`${httpBase(serverUrl)}/dm/${identityHash}/pubkey`);
    if (!res.ok) return null;
    return res.json() as Promise<RemotePubKeys>;
  } catch {
    return null;
  }
}

export interface RegistryEntry {
  hash: string;
  username: string;
  ecdsaPub: string;
  ecdhPub: string;
  registeredAt: number;
}

/** Fetch all registered identity hashes from the global registry. */
export async function fetchRegistry(serverUrl = DEFAULT_URL): Promise<RegistryEntry[]> {
  const res = await fetch(`${httpBase(serverUrl)}/registry`);
  if (!res.ok) return [];
  return res.json() as Promise<RegistryEntry[]>;
}

/** Deliver an encrypted DM blob to a recipient's mailbox. */
export async function deliverDm(
  recipientHash: string,
  payload: Pick<DmEnvelope, 'from' | 'ciphertext' | 'iv' | 'sig'>,
  serverUrl = DEFAULT_URL,
): Promise<void> {
  await fetch(`${httpBase(serverUrl)}/dm/${recipientHash}/deliver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Open a WebSocket to the caller's mailbox to receive DMs in real-time. */
export function connectMailbox(
  identityHash: string,
  onEvent: (event: DmServerEvent) => void,
  serverUrl = DEFAULT_URL,
): WebSocket {
  const ws = new WebSocket(`${wsBase(serverUrl)}/dm/${identityHash}/ws`);
  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data as string) as DmServerEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  return ws;
}
