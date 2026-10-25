# Operations and recovery

The API owns game data in the private `game` schema. Use `game_api` for the Worker, `game_backup` for read-only exports, and an admin connection for migrations/recovery. Keep connection URLs, the backup key, updater key and HMAC secret outside Git.

## Routine checks

- `GET /api/health`: database connectivity, application version and server UTC time.
- `npm run tail -w @sk/server`: Worker errors and verification warnings. Logs use request IDs; client error reports go to `game.client_errors` and expire after 30 days.
- Query `select * from game.ledger_mismatches;`: this must return zero rows. Investigate discrepancies; never repair balances by editing player wallets.
- Check `game.battles` for `verifying` rows with many `verify_attempts`. Check the Edge Function URL, HMAC secret and supported simulation versions before increasing load.
- Check `game.wars` for overdue phases. The two-minute cron and clan view advance phases from persisted deadlines. Completed battles settle once under a row lock. A war waits for attacks started before its deadline to finish verification.
- Check storage with `select pg_size_pretty(pg_database_size(current_database()));`. Free-tier limits and expected request volume are in [free-tier.md](free-tier.md).

Notifications are delivered between study sessions. Rooms show presence for two minutes after the last heartbeat. A hidden tab is not evidence of distraction. Reviewed disconnected study earns resources but contributes no competitive minutes to leagues or clan objectives.

## Encrypted backups

Prerequisites: Node 22+, PostgreSQL 17 client tools (`pg_dump`, `pg_restore`, `psql`) and a read-only backup/admin direct or **session-pooler** connection. Transaction pooling is unsuitable for these operations. `PGTOOLS_CONTAINER` optionally names an existing container containing the tools; connection hosts/ports then resolve inside that container.

Create a private key once and keep a second copy somewhere separate from the backup disk:

```bash
mkdir -p backups
umask 077
openssl rand 32 > /private/path/study-kingdom-backup.key
export BACKUP_KEY_FILE=/private/path/study-kingdom-backup.key
export DATABASE_URL='postgresql://ADMIN:SECRET@SESSION-POOLER:5432/postgres'
bash scripts/db/backup.sh
```

The script captures one consistent `pg_dump` snapshot of every `game` table plus `auth.users` and `auth.identities`. It streams directly into authenticated AES-256-GCM encryption; no plaintext dump is saved. The key is derived using scrypt with a random salt. Archive headers and contents are authenticated. Failed dumps do not publish an archive, and existing files are never overwritten.

Take a backup daily and before migrations. Keep seven daily and four weekly copies, including an encrypted copy off the Mac. Retention is an operator policy; scripts do not silently delete backups. `.github/workflows/backup.yml` provides an optional nightly encrypted backup with seven-day artifact retention once repository secrets are configured.

This is an **application/account-data** backup. Auth sessions, Supabase-managed internals, Auth configuration, deployment secrets, object storage, Apple certificates and updater signing keys are not included. Users sign in again after recovery. Preserve configuration and signing keys separately. Supabase recommends regular exports for free projects; full platform migrations need its separate [CLI backup and restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Restore into a separate environment

1. Create an isolated recovery Supabase project running the same PostgreSQL/Auth versions. Keep production traffic pointed at the original deployment.
2. Apply this release's migrations **without development seeds**. The recovery project's `game` tables, `auth.users` and `auth.identities` must be empty. Keep the source release available so database columns and pinned content/simulation versions match the archive.
3. Supply the original key and recovery admin connection, then restore:

   ```bash
   export BACKUP_KEY_FILE=/private/path/study-kingdom-backup.key
   export RESTORE_DATABASE_URL='postgresql://ADMIN:SECRET@RECOVERY-SESSION-POOLER:5432/postgres'
   bash scripts/db/restore.sh backups/study-kingdom-TIMESTAMP.skbak
   ```

4. The script authenticates the whole archive before touching the database, refuses a populated destination, restores within one transaction, and checks the ledger. Reset the recovery `game_api` password and configure username Auth settings using [setup.md](setup.md). Database role passwords are not in the archive.
5. In the recovery client, sign in, inspect study history/wallets, replay a stored battle, inspect clan membership and advance an overdue war. Run the ledger query again.
6. Switch Worker/Auth settings only after these checks. Keep the source database and encrypted archive until the recovered service has been verified.

A local restore drill creates two disposable PostgreSQL databases and checks all game tables, account recovery, ledger reconciliation, tamper rejection and populated-target rejection:

```bash
scripts/test-db.sh up
PGTOOLS_CONTAINER=sk-test-pg npm run test:backup
```

Local and hosted drills passed on 25 October 2026. The hosted drill restored generated local test fixtures into a separate Supabase project: all 25 game/Auth tables matched, all 15 settled replay hashes matched, 46 accounts were preserved, login worked and the ledger reconciled. No production payload was copied.

## Replays and releases

Simulation versions 1 and 2 are supported. Version 2 reveals a final hidden defence when there are no remaining visible targets; version 1 retains its original behaviour. Golden version 1 fixtures must stay unchanged. Update simulation versions whenever outcome rules change, and preserve old branches until old replays have an explicit retirement policy.

Deploy the rebuilt Edge Function together with the Worker/client (`npm run deploy:edge`). A verifier returning a different version falls back to checkpoint verification. Both versions are checked against Node, Chromium, WebKit and the local Deno runtime. Avoid pruning battle records referenced by wars or shared replays. There is currently no automatic battle deletion.

## Beta gate

The game is deployed at https://study-kingdom.yuvraj-658.workers.dev. Complete [beta.md](beta.md), test fresh installations/updates on both architectures, and run the two-week group beta before calling the beta finished.

## Deployment details

Production connects through Hyperdrive with SQL caching disabled, five origin connections and `verify-full` using Supabase’s CA. The bundled public certificate is `scripts/certs/supabase-root-2021.crt` (SHA-256 `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`, expires April 2031). Renew the CA configuration before expiry.

The approved `game_backup` role has SELECT access to game tables/sequences and `auth.users`/`auth.identities`, with SELECT-only RLS policies. It cannot mutate wallets. When adding a table, update its backup grants/policy. `pg_dump --enable-row-security` uses those explicit policies. The GitHub backup workflow mounts the public CA and uses `sslmode=verify-full`. The local ignored `study-kingdom-backup.key` must be copied to separate offline storage; losing both copies makes archives unrecoverable.

Forgotten username-account passwords use the owner-only procedure in [setup.md](setup.md). No SMTP or real email addresses are required.
