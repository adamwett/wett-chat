/**
 * Thin client for the DmMailbox Durable Object HTTP + WebSocket API.
 * All payloads are opaque to the server — no crypto here.
 */

export interface RemotePubKeys {
  ecdsaPub: string; // JSON-serialized ECDSA public key JWK
  ecdhPub: string;  // JSON-serialized ECDH public key JWK
}

/** A message as stored in a mailbox — includes direction and conversation partner. */
export interface MailboxMessage {
  direction: 'in' | 'out';
  /** The conversation partner's identity hash (sender for 'in', recipient for 'out'). */
  peer: string;
  /** The actual sender's identity hash (always set). */
  from: string;
  ciphertext: string; // base64
  iv: string;         // base64
  sig: string;        // base64 ECDSA signature
  timestamp: number;
}

export type DmServerEvent =
  | { type: 'keys'; ecdsaPub: string | null; ecdhPub: string | null }
  | { type: 'dm'; direction: 'in' | 'out'; peer: string; from: string; ciphertext: string; iv: string; sig: string; timestamp: number };

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

/** Fetch all messages (sent and received) from the caller's own mailbox. */
export async function fetchMailboxMessages(
  identityHash: string,
  serverUrl = DEFAULT_URL,
): Promise<MailboxMessage[]> {
  try {
    const res = await fetch(`${httpBase(serverUrl)}/dm/${identityHash}/messages`);
    if (!res.ok) return [];
    return res.json() as Promise<MailboxMessage[]>;
  } catch {
    return [];
  }
}

/**
 * Send an encrypted DM via the caller's own mailbox DO.
 * The DO stores it as 'out' and forwards it to the recipient's DO.
 */
export async function sendDm(
  myHash: string,
  recipientHash: string,
  payload: { ciphertext: string; iv: string; sig: string },
  serverUrl = DEFAULT_URL,
): Promise<void> {
  await fetch(`${httpBase(serverUrl)}/dm/${myHash}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: recipientHash, from: myHash, ...payload }),
  });
}

/** Open a WebSocket to the caller's mailbox to receive live inbound DMs. */
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
