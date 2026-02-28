/**
 * Reactive DM store — single source of truth for conversations and the unread badge.
 * Create with `createDmStore(identity)` inside a component, then call `connect()`
 * from `onMount` to open the mailbox WebSocket.
 */

import { createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { decryptDm, encryptDm, type Identity, verifyDm } from './crypto';
import {
  connectMailbox,
  fetchMailboxMessages,
  fetchPubKeys,
  type MailboxMessage,
  type RemotePubKeys,
  sendDm,
} from './dm-api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConvMessage {
  text: string | null; // null = decryption failed
  timestamp: number;
  mine: boolean;
  verified: boolean | null; // null = in-flight, only set for received messages
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

  async function getPeerKeys(peerHash: string): Promise<RemotePubKeys | null> {
    const idx = convIndex(peerHash);
    const cached = idx !== -1 ? convs[idx].peerPubKeys : undefined;
    if (cached !== undefined) return cached;

    const keys = await fetchPubKeys(peerHash);
    const i = convIndex(peerHash);
    if (i !== -1) setConvs(i, 'peerPubKeys', keys ?? null);
    return keys;
  }

  // ── Message processing ───────────────────────────────────────────────────────

  /**
   * Process a mailbox message (sent or received) into the conversations store.
   * Decrypts using the peer's ECDH key (ECDH is symmetric, works for both directions).
   */
  async function processMessage(msg: MailboxMessage): Promise<void> {
    const { peer, direction, from, ciphertext, iv, sig, timestamp } = msg;
    const isMine = direction === 'out';

    ensureConv(peer);
    const peerKeys = await getPeerKeys(peer);

    const msgIdx = convs[convIndex(peer)].messages.length;
    setConvs(convIndex(peer), 'messages', (msgs) => [
      ...msgs,
      { text: null, timestamp, mine: isMine, verified: isMine ? true : null },
    ]);

    let text: string | null = null;
    let verified: boolean | null = isMine ? true : null;

    try {
      // ECDH(ourPriv, theirPub) == ECDH(theirPriv, ourPub) so decryption works both ways
      if (!peerKeys?.ecdhPub) throw new Error('Peer not registered');
      text = await decryptDm(ciphertext, iv, peerKeys?.ecdhPub, identity);
    } catch {
      text = null;
    }

    if (!isMine && peerKeys) {
      verified = await verifyDm(from, identity.identityHash, ciphertext, iv, sig, peerKeys.ecdsaPub);
    }

    const ci = convIndex(peer);
    setConvs(
      ci,
      'messages',
      msgIdx,
      produce((m) => {
        m.text = text;
        m.verified = verified;
      }),
    );
  }

  // ── Public methods ───────────────────────────────────────────────────────────

  async function openConv(peerHash: string): Promise<void> {
    ensureConv(peerHash);
    await getPeerKeys(peerHash);
  }

  async function send(peerHash: string, text: string): Promise<string | null> {
    const peerKeys = await getPeerKeys(peerHash);
    if (!peerKeys) return 'Peer not registered — they need to open the app first.';

    const encrypted = await encryptDm(text, peerHash, peerKeys.ecdhPub, identity);
    await sendDm(identity.identityHash, peerHash, encrypted);

    // Add locally for instant feedback (server also stores it for history)
    ensureConv(peerHash);
    setConvs(convIndex(peerHash), 'messages', (msgs) => [
      ...msgs,
      { text, timestamp: Date.now(), mine: true, verified: true },
    ]);
    return null;
  }

  function connect(): () => void {
    // Fetch stored messages via HTTP — deterministic, no race with WS timing
    fetchMailboxMessages(identity.identityHash).then(async (messages) => {
      for (const msg of messages) await processMessage(msg);
    });

    // WS handles only live incoming DMs going forward
    const ws = connectMailbox(identity.identityHash, async (event) => {
      if (event.type === 'dm') {
        await processMessage({
          direction: event.direction,
          peer: event.peer,
          from: event.from,
          ciphertext: event.ciphertext,
          iv: event.iv,
          sig: event.sig,
          timestamp: event.timestamp,
        });
        if (event.direction === 'in') setUnread(true);
      }
    });
    return () => ws.close();
  }

  return { identityHash: identity.identityHash, convs, unread, setUnread, openConv, send, connect };
}
