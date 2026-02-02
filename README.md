# Cozy Bid - Fair Roommate Auctions

A zero-trust sealed-bid auction app for splitting furniture and items fairly between roommates. Uses cryptographic commit-reveal so neither person can see the other's bid until both have committed.

## How It Works

1. **Create an auction** for an item you're splitting
2. **Share the links** - each roommate gets a unique private link
3. **Lock in bids** - enter what the item is worth to you + a secret phrase
4. **Reveal** - after both lock in, reveal your bids
5. **Results** - higher bidder keeps the item and pays the other person

## Quick Start (Local)

```bash
npm install
npm start
```

Open http://localhost:3000

## Deploy to Render (Free)

1. Push this code to a GitHub repo

2. Go to [render.com](https://render.com) and create a new **Web Service**

3. Connect your GitHub repo

4. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

5. Add a **Disk** for persistent storage:
   - Mount Path: `/data`
   - Size: 1 GB (free tier)

6. Add environment variable:
   - `DB_PATH` = `/data/auctions.db`

7. Deploy!

## Deploy to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up

# Add persistent volume
railway volume create auction_data
# Set mount path to /data in dashboard

# Set env var
railway variables set DB_PATH=/data/auctions.db
```

## Deploy to Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login and launch
fly auth login
fly launch

# Create volume for SQLite
fly volumes create auction_data --size 1

# Add to fly.toml:
# [mounts]
#   source = "auction_data"
#   destination = "/data"

# Set env and deploy
fly secrets set DB_PATH=/data/auctions.db
fly deploy
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DB_PATH` | `./auctions.db` | SQLite database path |

## Zero-Trust Properties

**Protected:**
- Server never sees bids until explicit reveal (stores only SHA-256 hashes)
- Bids are cryptographically bound once committed
- Both reveals required before anyone sees results
- Rate limiting prevents brute-force attacks
- 192-bit random tokens for participant URLs

**Not Protected:**
- If one person refuses to reveal, auction stalls (no penalty)
- Server operator could theoretically collude
- No protection if someone shares their link

## Commit Hash Formula

```
payload = "${bid}|${secret}|${auctionId}|${seat}"
commit = SHA256(payload).toLowerCase()
```

- `bid` = formatted to 2 decimals (e.g., "150.00")
- `secret` = user's secret phrase
- `seat` = "A" or "B"

## Tech Stack

- Node.js + Express
- SQLite (better-sqlite3)
- Vanilla HTML/CSS/JS (no build step)
- WebCrypto for client-side hashing

## License

MIT
