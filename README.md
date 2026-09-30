# wett-chat

Real-time chat with end-to-end encrypted DMs. Live at **https://chat.wett.dev/**

- Public chat room over WebSockets
- E2E encrypted DMs: ECDH P-256 + AES-256-GCM, ECDSA-signed; keys never leave the browser
- Built with SolidStart + Tailwind on Cloudflare Workers and Durable Objects (`ChatRoom`, `DmMailbox`, `Registry`)

## Develop

```bash
pnpm install
pnpm dev       # local dev server
pnpm preview   # build + run in wrangler dev
pnpm deploy    # build + deploy to Cloudflare
```

Run `pnpm cf-typegen` after changing bindings in `wrangler.jsonc`.
