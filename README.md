# Party Games

https://donmorazemo.github.io/party-games/

Mobile-first party games. A host signs in once (Google) and sets up games; guests play from a
shared link with no account.

| Page | What |
|---|---|
| `index.html` | Party Games home: list of games |
| `admin.html` | The one host sign-in (Google, or email + password for testing), then "Your games" |
| `games.js` | The list of games |

## Games
| Game | Where |
|---|---|
| 🎃 Halloween Costume Awards | [donmorazemo/halloween-awards](https://github.com/donmorazemo/halloween-awards), served at `/halloween-awards/halloween/` |
| 💞 Matched | `matched/` in this repo (database: `supabase/matched.sql`) |

All games share the same Supabase project (`config.js`) and the same domain, so the sign-in here
carries over to every game's host page. A game's host page sends signed-out hosts to
`/party-games/admin.html?next=<game id>`, and they come straight back after signing in.

## Matched (couples game)
| Page | Who | What |
|---|---|---|
| `matched/admin.html` | Host | games, questions (with ✨ AI), couples, open/close answers, run the reveal |
| `matched/index.html?g=CODE` | Guests | tap your name; for each question pick your answer and guess your partner's |
| `matched/results.html?g=CODE` | Everyone | reveal screen; the host gets Back / Next controls |

A couple scores 1 point on a question when **both** partners guessed each other's answer. Ties go to the
couple with more one-way correct guesses. Answers stay hidden (enforced in the database) until the
host reveals each question.

**AI questions:** the ✨ buttons call the Supabase function `matched-ai`
(`supabase/functions/matched-ai/index.ts`), which holds the OpenRouter key as a secret and the prompts.
Any signed-in host can use it, up to 30 requests an hour each. Setup, once:
1. Run `supabase/matched_ai.sql` (usage log for the hourly limit).
2. Supabase → Edge Functions → Secrets: add `OPENROUTER_API_KEY` (optional: `OPENROUTER_MODEL`,
   default `openrouter/auto`; `AI_LIMIT_PER_HOUR`, default 30).
3. Deploy the function as `matched-ai` (dashboard editor, or `supabase functions deploy matched-ai`).

Never put the key in this repo — it's public.

**Database setup:** run `supabase/matched.sql` (and `supabase/matched_ai.sql`) once in Supabase → SQL Editor (after the Halloween schema,
which provides `is_admin()`).

## Adding a game
1. Add a folder here (e.g. `trivia/`) with `admin.html`, `index.html` and `results.html`
   loading `../config.js`, `../db.js` and `../styles.css`.
2. Add it to `games.js`.

Run locally: `python3 -m http.server 8080` → http://localhost:8080/admin.html
