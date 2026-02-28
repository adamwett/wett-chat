import { DurableObject } from 'cloudflare:workers';

type RegistryRow = { hash: string; username: string; ecdsa_pub: string; ecdh_pub: string; registered_at: number };

export type RegistryEntry = { hash: string; username: string; ecdsaPub: string; ecdhPub: string; registeredAt: number };

export class Registry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        hash          TEXT    PRIMARY KEY,
        username      TEXT    NOT NULL DEFAULT 'anonymous',
        ecdsa_pub     TEXT    NOT NULL,
        ecdh_pub      TEXT    NOT NULL,
        registered_at INTEGER NOT NULL
      )
    `);
    // Migrate existing instances that predate the username column
    try {
      ctx.storage.sql.exec(`ALTER TABLE users ADD COLUMN username TEXT NOT NULL DEFAULT 'anonymous'`);
    } catch {
      /* column already exists */
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /add — record a new identity (idempotent: first write wins)
    if (url.pathname === '/add' && request.method === 'POST') {
      const { hash, username, ecdsaPub, ecdhPub } = (await request.json()) as {
        hash: string;
        username: string;
        ecdsaPub: string;
        ecdhPub: string;
      };
      this.ctx.storage.sql.exec(
        'INSERT OR IGNORE INTO users (hash, username, ecdsa_pub, ecdh_pub, registered_at) VALUES (?, ?, ?, ?, ?)',
        hash,
        username,
        ecdsaPub,
        ecdhPub,
        Date.now(),
      );
      return new Response(null, { status: 204 });
    }

    // GET /list — return all registered entries
    if (url.pathname === '/list' && request.method === 'GET') {
      const rows = this.ctx.storage.sql
        .exec<RegistryRow>(
          'SELECT hash, username, ecdsa_pub, ecdh_pub, registered_at FROM users ORDER BY registered_at DESC',
        )
        .toArray();
      const entries: RegistryEntry[] = rows.map((r) => ({
        hash: r.hash,
        username: r.username,
        ecdsaPub: r.ecdsa_pub,
        ecdhPub: r.ecdh_pub,
        registeredAt: r.registered_at,
      }));
      return Response.json(entries);
    }

    return new Response('Not found', { status: 404 });
  }
}
