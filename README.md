# Party Games

https://donmorazemo.github.io/party-games/

Mobile-first party games. A host signs in once (Google) and sets up games; guests play from a
shared link with no account.

| Page | What |
|---|---|
| `index.html` | Party Games home: list of games |
| `admin.html` | The one host sign-in (Google, or email + password for testing), then "Your games" |
| `games.js` | The list of games |
| `stats.html` | Usage stats for site admins only (hosts, games, who took part, regions, success, AI use) |

## Games
| Game | Where |
|---|---|
| 🎃 Halloween Costume Awards | [donmorazemo/halloween-awards](https://github.com/donmorazemo/halloween-awards), served at `/halloween-awards/halloween/` |
| 💞 Matched | `matched/` in this repo (database: `supabase/matched.sql`) |
| ✅ True or False | `truefalse/` in this repo (database: `supabase/truefalse.sql`) |

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
Only **approved hosts** can use it (it spends the site owner's OpenRouter credits): emails in the
`ai_hosts` table. Other hosts can still run games; they just don't see the ✨ buttons, and the
function refuses them. Limits: 30 requests per host per hour, 200 per day across everyone. Setup, once:
1. Run `supabase/matched_ai.sql` (usage log) and `supabase/matched_ai_hosts.sql` (approved hosts —
   put your email in it when you run it). To approve someone else:
   `insert into ai_hosts (email) values ('their@email.com');`
2. Supabase → Edge Functions → Secrets: add `OPENROUTER_API_KEY` (optional: `OPENROUTER_MODEL`,
   default `openrouter/auto`; `AI_LIMIT_PER_HOUR`, default 30; `AI_LIMIT_PER_DAY`, default 200).
3. Deploy the function as `matched-ai` (dashboard editor, or `supabase functions deploy matched-ai`).

Never put the key in this repo — it's public.

**Database setup:** run `supabase/matched.sql` (and `supabase/matched_ai.sql`) once in Supabase → SQL Editor (after the Halloween schema,
which provides `is_admin()`).

## True or False (kids' elimination game)
| Page | Who | What |
|---|---|---|
| `truefalse/admin.html` | Host | ✨ write a set (age, topic, how many), or start from the ready-made set; edit, flip answers, reorder |
| `truefalse/play.html?id=N` | Moderator | big text: statement → Reveal (TRUE/FALSE + one-line explanation) → Next; players-left counter, winner screen |

No guest pages: kids hop between a TRUE side and a FALSE side; the moderator reads from their phone or a TV.
The AI prompt is `TF_SYSTEM` in `supabase/functions/matched-ai/index.ts` (mode `truefalse`, same key,
approved hosts and limits as Matched). Statements are age-checked in the prompt, ordered easy → hard and
roughly half true / half false.

## Usage stats
`stats.html` reads `admin_usage()` (in `supabase/stats.sql`), which only site admins (`public.admins`) can call.
Region = each device's time zone + language setting, saved with every vote and new game; no IP addresses.
The pages fall back to the older database functions if `stats.sql` hasn't been run yet.

## Adding a game
1. Add a folder here (e.g. `trivia/`) with `admin.html`, `index.html` and `results.html`
   loading `../config.js`, `../db.js` and `../styles.css`.
2. Add it to `games.js`.

Run locally: `python3 -m http.server 8080` → http://localhost:8080/admin.html
