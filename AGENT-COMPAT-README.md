# Agent and discovery compatibility

BurgerMoney.org is machine-readable by AI agents on Base and the broader agent web. These files document the discovery layer that complements the public site.

## Files in this bundle

| File | Where to deploy | Purpose |
| --- | --- | --- |
| `index.html` | site root | Now carries full agent metadata: OG, Twitter, Farcaster Mini App / Frame embed, JSON-LD graph (WebSite + Organization + Product/FinancialProduct + FAQPage), CAIP-19, AI-crawler permissions, inline `token-data` JSON, `data-*` attributes on the contract pill, stat strip, and every action link |
| `llms.txt` | site root → `/llms.txt` | Clean Markdown summary for LLM crawlers (Jeremy Howard convention; read by AI coding tools and increasingly by AI search) |
| `llms-full.txt` | site root → `/llms-full.txt` | Full single-document export for deep LLM ingest |
| `robots.txt` | site root → `/robots.txt` | Explicitly allows GPTBot, ClaudeBot, anthropic-ai, PerplexityBot, OAI-SearchBot, Google-Extended, Applebot-Extended, Bingbot, etc. |
| `sitemap.xml` | site root → `/sitemap.xml` | Lists the page and all agent-discovery files |
| `manifest.webmanifest` | site root → `/manifest.webmanifest` | PWA manifest (Base App / mobile installs) |
| `.well-known/agent.json` | site root → `/.well-known/agent.json` | A2A Agent Card — 7 public information skills, including the current community ballot and Hunger directory snapshot. No auth required. |
| `vote-config.json` | site root → `/vote-config.json` | Current developer-published five-seat voting round and canonical protocol addresses |
| `vote-organizations.json` | site root → `/vote-organizations.json` | Giving Block Hunger impact-area directory snapshot used for write-ins |
| `.well-known/token.json` | site root → `/.well-known/token.json` | Canonical token metadata in machine-readable JSON |
| `.well-known/farcaster.json` | site root → `/.well-known/farcaster.json` | Farcaster Mini App manifest with a signed `accountAssociation`. |

## What the upgrade gets you

- **Base App / Farcaster clients** render a rich embed with the Burger Money artwork when the URL is shared (button: "Buy $BURGERS") via `fc:miniapp` and `fc:frame` meta tags.
- **AI search (ChatGPT, Claude, Perplexity, Gemini)** can pull a clean summary from `llms.txt` and the JSON-LD graph instead of guessing from your HTML and JS.
- **AI agents** following the A2A protocol can discover the site via `/.well-known/agent.json`, see the 7 public information skills it exposes, and inspect the current ballot without auth.
- **On-chain agents and wallet apps** can read the CAIP-19 identifier (`eip155:8453/erc20:0x06A0…dDc5`) from `<meta name="caip-19">`, the inline `#token-data` JSON block, and `/.well-known/token.json`.
- **DOM-walking agents** can find the contract address via `data-token-contract` on the contract pill, live stats via `data-metric` on the stat cards, and action targets via `data-action` + `data-platform` on every CTA link.

## Shared brand assets

The HTML and manifests use these three checked-in images:

1. **`/og-burgers.png`** — 1200×630 PNG. Used for Open Graph, Twitter card, and Farcaster embed. Should show the Burger Money logo on the Base-blue gradient with the tagline. (Render once, host at root.)
2. **`/icon-512.png`** — 512×512 PNG. The Burger Money logo on a transparent or solid background. Used by Farcaster splash, PWA install, schema.org logo.
3. **`/icon-192.png`** — 192×192 PNG. Same logo, smaller. PWA install icon.

Keep these filenames stable unless every manifest and metadata reference is updated at the same time.

## Farcaster association

`/.well-known/farcaster.json` contains the project's signed `accountAssociation` and is ready for client verification. If domain ownership ever changes, regenerate the association with the new custody wallet before replacing these values.

## Verifying the result

After deploying, test with:

- **OG/Twitter card:** <https://www.opengraph.xyz/url/https%3A%2F%2Fwww.burgermoney.org%2F>
- **Farcaster embed:** <https://farcaster.xyz/~/developers/mini-apps/preview?url=https://www.burgermoney.org>
- **Schema.org / JSON-LD:** <https://search.google.com/test/rich-results?url=https://www.burgermoney.org/>
- **robots.txt:** <https://www.google.com/webmasters/tools/robots-testing-tool>
- **Agent card:** `curl https://www.burgermoney.org/.well-known/agent.json | jq`
- **LLM summary:** `curl https://www.burgermoney.org/llms.txt`

When the public site changes, re-run the checks above so its human-facing experience and machine-readable metadata stay in sync.
