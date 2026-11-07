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
  {
    id: "matched",
    name: "Matched",
    emoji: "💞",
    blurb: "Couples game. Everyone answers for themselves and guesses their partner. Host reveals who matched, one question at a time.",
    path: "matched/",
    count: async me => {
      if(!DB.live){ try { return (JSON.parse(localStorage.getItem("mt_demo_db")) || { games:[] }).games.length; } catch(e){ return 0; } }
      const { count, error } = await DB.sb.from("matched_games").select("id", { count:"exact", head:true }).eq("owner_id", me.id);
      if(error) throw error; return count;
    },
    unit: ["game", "games"],
  },
  {
    id: "truefalse",
    name: "True or False",
    emoji: "✅",
    blurb: "Kids' elimination game. Read a statement, kids hop to the TRUE or FALSE side, wrong side is out. AI writes age-right statements from easy to hard.",
    path: "truefalse/",
    count: async me => {
      if(!DB.live){ try { return (JSON.parse(localStorage.getItem("tf_demo_db")) || { games:[] }).games.length; } catch(e){ return 0; } }
      const { count, error } = await DB.sb.from("tf_games").select("id", { count:"exact", head:true }).eq("owner_id", me.id);
      if(error) throw error; return count;
    },
    unit: ["set", "sets"],
  },
];
