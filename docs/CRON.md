# Scheduling `markets:sync`

The DB cache (`markets_cache` + `positions_cache`) auto-bootstraps on first
request, but a scheduler keeps it **fresh** without depending on user traffic.
Any of the options below works — pick one.

## 0. Embed in the keeper bot (recommended for local/dev, simplest) ✅

If you're already running `npm run keeper:start` (locally or on a VPS via
`pm2`), the keeper **already does this automatically** on a 60s interval.
Nothing extra to configure as long as `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are present in the project-root `.env`.

- Tune interval via `KEEPER_CACHE_SYNC_INTERVAL_MS`
- Disable via `KEEPER_CACHE_SYNC_DISABLED=true` when you move to one of the
  options below

You'll see log lines like:

```
[cache-sync] markets upsert=21 del=0 | positions upsert=34 del=1 | 430ms
```

Good for single-machine deployments. When you scale to multiple app
instances (or stop running the keeper locally), switch to one of the
following.

## 1. Vercel Cron (if you deploy to Vercel)

Add to `vercel.json` at the project root:

```json
{
  "crons": [
    {
      "path": "/api/markets/sync",
      "schedule": "*/2 * * * *"
    }
  ]
}
```

Then in the Vercel dashboard, set `MARKETS_SYNC_SECRET` as a **Production**
env var. Vercel Cron signs each request with a bearer token it generates;
adjust the handler to accept either your secret **or** Vercel's `x-vercel-cron`
header, or skip the secret check for the cron path.

Docs: <https://vercel.com/docs/cron-jobs>

## 2. GitHub Actions (works for any host)

`.github/workflows/markets-sync.yml`:

```yaml
name: markets-sync
on:
  schedule:
    - cron: "*/2 * * * *"
  workflow_dispatch: {}

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: POST /api/markets/sync
        env:
          APP_URL: ${{ secrets.APP_URL }}
          SECRET: ${{ secrets.MARKETS_SYNC_SECRET }}
        run: |
          curl -fsS -X POST "$APP_URL/api/markets/sync" \
            -H "Authorization: Bearer $SECRET" \
            -H "Content-Type: application/json"
```

Add these repo secrets:

- `APP_URL` → `https://your-deployment.example.com`
- `MARKETS_SYNC_SECRET` → same value as in your app env

## 3. Keeper VPS (pair with the existing keeper bot)

If you already run the keeper on a VPS via `pm2`, the simplest option is a
system-level cron that calls the endpoint. Edit `crontab -e`:

```cron
*/2 * * * * curl -fsS -X POST "https://your-host/api/markets/sync" \
  -H "Authorization: Bearer $MARKETS_SYNC_SECRET" >> /var/log/markets-sync.log 2>&1
```

Export `MARKETS_SYNC_SECRET` in `/etc/environment` or inline it (watch log
permissions).

Alternatively, run the CLI script directly from the same box that hosts the
keeper (it reuses the app env):

```cron
*/2 * * * * cd /path/to/prediction-market && /usr/bin/env -i HOME=$HOME PATH=/usr/local/bin:/usr/bin npm run markets:sync >> /var/log/markets-sync.log 2>&1
```

## 4. Supabase pg_cron (advanced)

Supabase supports `pg_cron` + `pg_net` for HTTP calls from the database. This
is elegant but couples your ops to Supabase extensions; use only if you
already run other jobs there. See Supabase docs for setup.

---

## Recommended cadence

- **Devnet / MVP**: every 2 minutes.
- **Production**: every 30–60 seconds if markets are short-lived, otherwise
  every 1–2 minutes. Shorter intervals hit RPC harder.

## Monitoring

`POST /api/markets/sync` returns:

```json
{ "ok": true, "markets": { "upserted": 21, "deleted": 0 }, "positions": { "upserted": 34, "deleted": 1 } }
```

Log the response on the cron side (`curl -fsS` exits non-zero on failure).
The response is also handy for sanity-checking on-chain activity.
