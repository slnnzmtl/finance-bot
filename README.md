# Finance Bot

Telegram expense ledger bot: Gemini LLM ⇄ `exec_sql` (+ optional Wise). No supervisor.

## Setup

```bash
pnpm install
cp .env.example .env
# fill required vars — use a different TELEGRAM_BOT_TOKEN than personal-assistant
pnpm dev
```

## Required env

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `ALLOWED_TELEGRAM_USER_ID` | Only this Telegram user may talk to the bot |
| `GOOGLE_API_KEY` | Gemini API key |
| `SUPABASE_PROJECT_REF` | Supabase project ref for MCP |
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token |

Optional: `ALLOWED_TELEGRAM_CHAT_ID`, `WISE_API_TOKEN`, `WISE_PROFILE_ID`, `FINANCE_MODEL`, `APP_TIMEZONE`, MCP reconnect knobs, LangSmith.

## Database

See [sql/INSTRUCTIONS.md](sql/INSTRUCTIONS.md). Run the unique constraint SQL once for idempotent Wise sync.

## Scripts

```bash
pnpm dev          # long-poll Telegram
pnpm test         # unit tests
pnpm check        # tsc
pnpm build && pnpm start
```

## Layout

- `src/graph.ts` — LLM ⇄ tools loop (MemorySaver, `thread_id` = chat id)
- `src/tools.ts` — `exec_sql`, optional `fetch_wise_transactions`
- `src/telegram.ts` — text-only Telegraf adapter
- `data/prompt.md` + `data/ledger.json` — system instructions
