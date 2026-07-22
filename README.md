# c1-bot

Cloudflare Worker that scrapes a Telegram channel for FX rates and commits them to this repo.

The channel is not in the source — it comes from the `CHANNEL` secret.

## Deploy

```sh
npm install
npx wrangler login

# Set secrets (see .dev.vars.example for the full list)
npx wrangler secret put CHANNEL        # Telegram channel username, no @
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put OWNER_CHAT_ID
npx wrangler secret put PUBLIC_CHAT_ID
npx wrangler secret put GITHUB_TOKEN   # fine-grained PAT, Contents: read+write on this repo

npm run deploy
```

## Local

Put the same vars in `.dev.vars`.

```sh
npx wrangler dev

curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```
