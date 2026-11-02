// Party Games: the list of games. A game can live in this repo (its own folder) or on its
// own site under donmorazemo.github.io, like Halloween Awards. Sign-in is shared because
// every game is on the same domain.
window.PARTY_GAMES = [
  {
    id: "halloween",
    name: "Halloween Costume Awards",
    emoji: "🎃",
    blurb: "Guests vote for each other's costumes in award categories. Live leaderboard.",
    path: "../halloween-awards/halloween/",   // separate repo: donmorazemo/halloween-awards
    // How many games this host has set up (shown on the host page)
    count: async me => (await DB.parties.list(me && me.id ? { owner_id: me.id } : undefined)).length,
    unit: ["party", "parties"],
  },
];
