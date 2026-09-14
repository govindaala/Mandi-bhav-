# Deployment

## 1. Turso

Create/rotate a database token. The token must remain server-side.

Apply `db/schema.sql` to your Turso database using the Turso CLI or SQL console.

## 2. Cloudflare Worker

Inside `worker/`:

```bash
npm install
npx wrangler login
npx wrangler secret put TURSO_DATABASE_URL
npx wrangler secret put TURSO_AUTH_TOKEN
npx wrangler secret put SESSION_SECRET
npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL
npx wrangler secret put BOOTSTRAP_ADMIN_PASSWORD
npx wrangler deploy
```

Use the generated Worker URL in `frontend/app.js`:

```js
const API = "https://YOUR-WORKER.your-subdomain.workers.dev/api";
```

Set `FRONTEND_ORIGIN` in `wrangler.toml` to the exact GitHub Pages origin.

## 3. Bootstrap

After deployment, call:

```text
POST https://YOUR-WORKER.../api/bootstrap
```

This creates the first Super Admin only when the `users` table is empty. After a user exists, it refuses to create another bootstrap admin.

## 4. GitHub Pages

Push `frontend/` to the repository and enable GitHub Pages for the chosen branch/folder.

Do not place any Turso token in:
- frontend/app.js
- HTML
- GitHub Pages
- public environment files
- README
- SQL files

## 5. Production hardening

Before public launch add:
- login rate limiting
- account lockout after repeated failures
- 2FA for Super Admin
- CSRF protection if cookie policy requires it
- strict CORS
- password reset flow
- phone/email verification
- server-side validation for every price field
- image/OCR upload scanning
- audit log retention
- database backups
- role/permission UI
