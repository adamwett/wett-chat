/**
 * Reactive DM store — single source of truth for conversations and the unread badge.
 * Create with `createDmStore(identity)` inside a component, then call `connect()`
 * from `onMount` to open the mailbox WebSocket.
 */

import { createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { decryptDm, encryptDm, verifyDm, type Identity } from './crypto';
import { connectMailbox, deliverDm, fetchMailboxMessages, fetchPubKeys, type DmEnvelope, type RemotePubKeys } from './dm-api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConvMessage {
  text: string | null;     // null = decryption failed
  timestamp: number;
  mine: boolean;
  verified: boolean | null; // null = in-flight
}

export interface Conversation {
  peerHash: string;
  /** undefined = not yet fetched, null = confirmed unregistered, object = ready */
  peerPubKeys: RemotePubKeys | null | undefined;
  messages: ConvMessage[];
}

export interface DmStore {
  /** The owner's identity hash (64 hex chars). */
  identityHash: string;
  /** Reactive conversations array — use directly in SolidJS templates. */
  convs: Conversation[];
  /** Whether any unread DMs have arrived since the panel was last opened. */
  unread: () => boolean;
  setUnread: (v: boolean) => void;
  /** Ensure a conversation exists and lazily fetch the peer's public keys. */
  openConv: (peerHash: string) => Promise<void>;
  /** Process an incoming DM envelope (decrypt, verify, append to conversation). */
  receiveEnvelope: (env: DmEnvelope) => Promise<void>;
  /** Encrypt and send a message to `peerHash`. Returns an error string, or null on success. */
  send: (peerHash: string, text: string) => Promise<string | null>;
  /**
   * Open the mailbox WebSocket. Call this from `onMount` and pass the returned
   * cleanup function to `onCleanup`.
   */
  connect: () => () => void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createDmStore(identity: Identity): DmStore {
  const [convs, setConvs] = createStore<Conversation[]>([]);
  const [unread, setUnread] = createSignal(false);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function convIndex(peerHash: string): number {
    return convs.findIndex((c) => c.peerHash === peerHash);
  }

  function ensureConv(peerHash: string): void {
    if (convIndex(peerHash) === -1) {
      setConvs((prev) => [...prev, { peerHash, peerPubKeys: undefined, messages: [] }]);
    }
  }

  // ── Public methods ───────────────────────────────────────────────────────────

  async function openConv(peerHash: string): Promise<void> {
    ensureConv(peerHash);
    const idx = convIndex(peerHash);
    if (idx !== -1 && convs[idx].peerPubKeys === undefined) {
      const keys = await fetchPubKeys(peerHash);
      setConvs(convIndex(peerHash), 'peerPubKeys', keys ?? null);
    }
  }

  async function receiveEnvelope(env: DmEnvelope): Promise<void> {
    ensureConv(env.from);

    let peerKeys = convs[convIndex(env.from)]?.peerPubKeys;
    if (!peerKeys) {
      peerKeys = await fetchPubKeys(env.from);
      const idx = convIndex(env.from);
      if (idx !== -1) setConvs(idx, 'peerPubKeys', peerKeys);
    }

    const msgIdx = convs[convIndex(env.from)].messages.length;
    setConvs(
      convIndex(env.from),
      'messages',
      (msgs) => [...msgs, { text: null, timestamp: env.timestamp, mine: false, verified: null }],
    );

    let text: string | null = null;
    let verified: boolean | null = null;

    try {
      text = await decryptDm(env.ciphertext, env.iv, peerKeys!.ecdhPub, identity);
    } catch {
      text = null;
    }

    if (peerKeys) {
      verified = await verifyDm(
        env.from,
        identity.identityHash,
        env.ciphertext,
        env.iv,
        env.sig,
        peerKeys.ecdsaPub,
      );
    }

    const ci = convIndex(env.from);
    setConvs(ci, 'messages', msgIdx, produce((m) => {
      m.text = text;
      m.verified = verified;
    }));
  }

  async function send(peerHash: string, text: string): Promise<string | null> {
    const ci = convIndex(peerHash);
    let peerKeys = ci !== -1 ? convs[ci].peerPubKeys : null;
    if (!peerKeys) {
      peerKeys = await fetchPubKeys(peerHash);
      if (ci !== -1) setConvs(ci, 'peerPubKeys', peerKeys);
    }
    if (!peerKeys) return 'Peer not registered — they need to open the app first.';

    const encrypted = await encryptDm(text, peerHash, peerKeys.ecdhPub, identity);
    await deliverDm(peerHash, { from: identity.identityHash, ...encrypted });

    ensureConv(peerHash);
    setConvs(convIndex(peerHash), 'messages', (msgs) => [
      ...msgs,
      { text, timestamp: Date.now(), mine: true, verified: true },
    ]);
    return null;
  }

  function connect(): () => void {
    // Fetch stored messages via HTTP so history is available immediately and
    // doesn't depend on the WS handshake timing.
    fetchMailboxMessages(identity.identityHash).then(async (messages) => {
      for (const env of messages) await receiveEnvelope(env);
    });

    // WS handles only live incoming DMs after history is loaded.
    const ws = connectMailbox(identity.identityHash, async (event) => {
      if (event.type === 'dm') {
        await receiveEnvelope(event);
        setUnread(true);
      }
      // 'history' and 'keys' events are intentionally ignored — HTTP handles history.
    });
    return () => ws.close();
  }

  return { identityHash: identity.identityHash, convs, unread, setUnread, openConv, receiveEnvelope, send, connect };
}
