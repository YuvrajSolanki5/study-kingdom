# Setup and deployment

## Local development

Use Node 22+, npm, Docker and Rust for the Mac shell.

```bash
npm install
npm run db:start   # builds the Edge bundle, then starts Supabase
cp apps/server/.dev.vars.example apps/server/.dev.vars
# Set SUPABASE_PUBLISHABLE_KEY from `npx supabase status`.
npm run dev
npm run dev:client
```

Open http://localhost:5173. Fresh seeds include usernames `demo1` and `demo2`, password `study-kingdom-dev`. Accounts use usernames, with immediate sign-in and no email. If you have an older local database, `npx supabase db reset` replaces its test data with current migrations/seeds.

The Worker uses Hyperdrive's local connection string on port 54322, with the development-only `game_api` password from the seed. The desktop development command is `npm run dev:desktop`.

```bash
npm run lint
npm run typecheck
npm test
scripts/test-db.sh up
npm run test:integration
npm run test:e2e
PGTOOLS_CONTAINER=sk-test-pg npm run test:backup
```

## Production resources

- Game/API: https://study-kingdom.yuvraj-658.workers.dev
- Source/releases: https://github.com/YuvrajSolanki5/study-kingdom
- Supabase project: `zybsydbylutyuroqpbiy`, Sydney, Free plan.
- Database pool: Hyperdrive `study-kingdom-db`, SQL result caching disabled, five origin connections, Supabase session pooler with CA and hostname verification.
- Verification: HMAC-protected `verify-battle` Supabase Edge Function.

Keep secrets out of Git. `.env.production` on the deployment Mac is private and ignored. Cloudflare's secret store contains its runtime keys; GitHub Actions contains the approved read-only backup login and encryption key. See [operations.md](operations.md).

## Deploy to another account

1. Create a free Supabase project and link it: `npx supabase link --project-ref <ref>`. Apply `npx supabase db push` without seeds. Give `game_api` a generated password outside migrations.
2. Configure Auth with `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and `SITE_URL` set privately, then run `node scripts/supabase/configure-auth.mjs`. This enables immediate username signup, password rules and refresh rotation, and disables email delivery. No SMTP account or domain is required.
3. Upload the database CA from Supabase's Database Settings to Cloudflare: `npx wrangler cert upload certificate-authority --ca-cert scripts/certs/supabase-root-2021.crt --name study-kingdom-supabase-root`. Confirm the certificate for your project matches the bundled public certificate.
4. Create Hyperdrive using the restricted `game_api` session-pooler connection, `--sslmode verify-full`, the uploaded `--ca-certificate-id`, `--caching-disabled` and `--origin-connection-limit 5`. Keep the connection password out of terminal history. Set the returned binding ID, account ID and public origins in `apps/server/wrangler.jsonc`.
5. Set the same generated `VERIFY_SHARED_SECRET` in the Edge Function and Worker. Run `npm run deploy:edge`. Set Worker secrets `SUPABASE_PUBLISHABLE_KEY`, `VERIFY_FUNCTION_URL` and `VERIFY_SHARED_SECRET` with `wrangler secret put`.
6. Run `npm run deploy`. Check `/api/health`, username signup, refresh, password changes and a verified campaign battle.
7. Update public release destinations in `release.config.json`, then follow [release.md](release.md).

The Supabase password provider uses reserved non-deliverable aliases internally. Real email addresses are neither collected nor required. Usernames contain 3–24 letters, digits or underscores, start with a letter/digit and are case-insensitive. Passwords require at least ten characters.

## Forgotten passwords

Players change their password in Settings using their current password. For a forgotten password, the owner verifies the player directly and runs:

```bash
node --env-file=.env.production scripts/supabase/reset-password.mjs USERNAME /private/path/temporary-password.txt
```

This requires the private Supabase service-role key. The script generates a random password and writes it to a new file with mode 0600; it never prints the password. Give it directly to the player, who can change it in Settings. Delete the temporary file afterwards. Existing access tokens can remain valid until their normal expiration.

Web sessions use Secure httpOnly cookies and Origin checks. Mac refresh tokens stay in the Keychain. No confirmation, resend or recovery-email endpoints are exposed by the game.

GitHub web deploy automation is prepared but requires a separately scoped `CLOUDFLARE_API_TOKEN`; until configured, use authenticated local deployment. Do not upload the broad local OAuth token to GitHub.
