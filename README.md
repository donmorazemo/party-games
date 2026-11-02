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

All games share the same Supabase project (`config.js`) and the same domain, so the sign-in here
carries over to every game's host page. A game's host page sends signed-out hosts to
`/party-games/admin.html?next=<game id>`, and they come straight back after signing in.

## Adding a game
1. Add a folder here (e.g. `trivia/`) with `admin.html`, `index.html` and `results.html`
   loading `../config.js`, `../db.js` and `../styles.css`.
2. Add it to `games.js`.

Run locally: `python3 -m http.server 8080` → http://localhost:8080/admin.html
