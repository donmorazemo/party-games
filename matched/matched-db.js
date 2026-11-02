// Matched data layer. Uses the shared Supabase client from ../db.js (DB.sb) when live;
// otherwise a localStorage demo that follows the same rules as supabase/matched.sql.
(function(){
  const live = DB.live, sb = DB.sb;
  async function q(p){ const { data, error } = await p; if(error) throw new Error(error.message); return data; }
  function rand(){ const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, b=>b.toString(16).padStart(2,"0")).join(""); }

  // One secret per (game, player) this phone answered as.
  const tk = slug => "mt_tokens_" + slug;
  const Tokens = {
    all(slug){ try { return JSON.parse(localStorage.getItem(tk(slug))) || {}; } catch(e){ return {}; } },
    get(slug, pid){ return this.all(slug)[pid] || null; },
    ensure(slug, pid){ const t = this.all(slug); if(!t[pid]){ t[pid] = rand(); localStorage.setItem(tk(slug), JSON.stringify(t)); } return t[pid]; },
  };

  // ---------- demo store ----------
  const LK = "mt_demo_db";
  const load = () => { try { return JSON.parse(localStorage.getItem(LK)); } catch(e){ return null; } };
  const save = d => { localStorage.setItem(LK, JSON.stringify(d)); window.dispatchEvent(new Event("mt-change")); };
  const nid = () => Date.now()*1000 + Math.floor(Math.random()*1000);
  const bySort = (x,y) => (x.sort-y.sort) || (x.id-y.id);
  const hash = s => "h" + Array.from(s).reduce((h,c)=>((h<<5)-h+c.charCodeAt(0))|0, 7);
  if(!live && !load()){
    const d = { games:[{ id:1, slug:"demo", name:"Matched", subtitle:"How well do you know your partner?", answers_open:true, reveal_step:null }],
      couples:[], players:[], questions:[], entries:[], answers:[] };
    [["Priya","Raj"],["Sam","Alex"]].forEach((pair,i)=>{ d.couples.push({ id:10+i, game_id:1, sort:i });
      pair.forEach((n,j)=>d.players.push({ id:100+i*2+j, game_id:1, couple_id:10+i, name:n, sort:j })); });
    window.MATCHED_TEMPLATE.slice(0,4).forEach((x,i)=>d.questions.push({ id:200+i, game_id:1, prompt:x.prompt, options:x.options, sort:i }));
    save(d);
  }
  const demo = {
    matched_get_game({ p_slug }){
      const d = load(), g = d.games.find(x=>x.slug===p_slug); if(!g) return null;
      return { game:{ id:g.id, slug:g.slug, name:g.name, subtitle:g.subtitle, answers_open:g.answers_open, reveal_step:g.reveal_step },
        questions: d.questions.filter(x=>x.game_id===g.id).sort(bySort),
        couples: d.couples.filter(c=>c.game_id===g.id).sort(bySort).map(c=>({ id:c.id, sort:c.sort, players:d.players.filter(p=>p.couple_id===c.id).sort(bySort) })),
        submitted: d.entries.filter(e=>e.game_id===g.id).map(e=>e.player_id) };
    },
    matched_get_mine({ p_slug, p_player, p_token }){
      const d = load(), g = d.games.find(x=>x.slug===p_slug); if(!g) return null;
      const e = d.entries.find(x=>x.game_id===g.id && x.player_id===p_player && x.token_hash===hash(p_token)); if(!e) return null;
      const o = {}; d.answers.filter(a=>a.entry_id===e.id).forEach(a=>o[a.question_id] = { own:a.own, guess:a.guess }); return o;
    },
    matched_submit({ p_slug, p_player, p_token, p_answers }){
      const d = load(), g = d.games.find(x=>x.slug===p_slug);
      if(!g) throw new Error("Game not found"); if(!g.answers_open || g.reveal_step!=null) throw new Error("ANSWERS_CLOSED");
      if(!d.players.some(p=>p.id===p_player && p.game_id===g.id)) throw new Error("Unknown player");
      let e = d.entries.find(x=>x.player_id===p_player);
      if(e && e.token_hash!==hash(p_token)) throw new Error("ALREADY_ANSWERED");
      if(!e){ e = { id:nid(), game_id:g.id, player_id:p_player, token_hash:hash(p_token) }; d.entries.push(e); }
      for(const [qid, v] of Object.entries(p_answers)){
        const qq = d.questions.find(x=>x.id===+qid && x.game_id===g.id); if(!qq) throw new Error("Unknown question");
        const n = qq.options.length; if(!(v.own>=0 && v.own<n && v.guess>=0 && v.guess<n)) throw new Error("Invalid answer");
        const ex = d.answers.find(a=>a.entry_id===e.id && a.question_id===+qid);
        if(ex){ ex.own = v.own; ex.guess = v.guess; } else d.answers.push({ id:nid(), entry_id:e.id, question_id:+qid, own:v.own, guess:v.guess });
      }
      save(d);
    },
    matched_results({ p_slug }){
      const d = load(), g = d.games.find(x=>x.slug===p_slug); if(!g) return null;
      const qs = d.questions.filter(x=>x.game_id===g.id).sort(bySort), shown = new Set(g.reveal_step==null ? [] : qs.slice(0, g.reveal_step).map(x=>x.id));
      const entries = d.entries.filter(e=>e.game_id===g.id), byId = Object.fromEntries(entries.map(e=>[e.id,e]));
      return { reveal_step:g.reveal_step, question_count:qs.length, submitted:entries.length,
        answers: d.answers.filter(a=>byId[a.entry_id] && shown.has(a.question_id)).map(a=>({ question_id:a.question_id, player_id:byId[a.entry_id].player_id, own:a.own, guess:a.guess })) };
    },
  };
  function demoTable(name, cascade){
    return {
      async list(filter){ const d = load(); return d[name].filter(r=>!filter || Object.entries(filter).every(([k,v])=>r[k]===v)).sort(bySort); },
      async save(row){
        const d = load(), all = d[name];
        if(row.id){ const i = all.findIndex(r=>r.id===row.id); all[i] = { ...all[i], ...row }; row = all[i]; }
        else { row = { sort:0, ...row, id:nid() }; if(name==="games") row = { subtitle:"", answers_open:true, reveal_step:null, slug:rand().slice(0,10), ...row }; all.push(row); }
        save(d); return row;
      },
      async del(id){ const d = load(); d[name] = d[name].filter(r=>r.id!==id); cascade && cascade(d, id); save(d); },
      async delWhere(filter){ const d = load(); const gone = d[name].filter(r=>Object.entries(filter).every(([k,v])=>r[k]===v)).map(r=>r.id);
        d[name] = d[name].filter(r=>!gone.includes(r.id)); gone.forEach(id=>cascade && cascade(d,id)); save(d); },
    };
  }
  const dropEntry = (d,id)=>{ d.answers = d.answers.filter(a=>a.entry_id!==id); };
  const dropPlayer = (d,id)=>{ const e = d.entries.filter(x=>x.player_id===id).map(x=>x.id); d.entries = d.entries.filter(x=>x.player_id!==id); e.forEach(x=>dropEntry(d,x)); };

  function remoteTable(t){
    return {
      list(filter){ let r = sb.from(t).select("*"); Object.entries(filter||{}).forEach(([k,v])=>r=r.eq(k,v));
        if(t==="matched_games") r = r.order("created_at",{ascending:false}); else if(t!=="matched_entries") r = r.order("sort").order("id"); return q(r); },
      async save(row){
        if(row.id){ const { id, ...rest } = row; return (await q(sb.from(t).update(rest).eq("id", id).select()))[0]; }
        return (await q(sb.from(t).insert(row).select()))[0];
      },
      del: id => q(sb.from(t).delete().eq("id", id)),
      delWhere(filter){ let r = sb.from(t).delete(); Object.entries(filter).forEach(([k,v])=>r=r.eq(k,v)); return q(r); },
    };
  }
  const rpc = (fn, args) => live ? q(sb.rpc(fn, args)) : Promise.resolve().then(()=>demo[fn](args));

  window.MDB = {
    live, Tokens,
    getGame:  slug => rpc("matched_get_game", { p_slug:slug }),
    getMine:  (slug, player, token) => rpc("matched_get_mine", { p_slug:slug, p_player:player, p_token:token }),
    submit:   async (slug, player, token, answers) => {
      const args = { p_slug:slug, p_player:player, p_token:token, p_answers:answers };
      try{ return await rpc("matched_submit", { ...args, ...DB.region("p_") }); }
      catch(e){ if(/Could not find the function|PGRST202/i.test(String(e.message))) return rpc("matched_submit", args); throw e; }   // before stats.sql is run
    },
    results:  slug => rpc("matched_results", { p_slug:slug }),
    onChange(cb){ if(!live){ window.addEventListener("storage", cb); window.addEventListener("mt-change", cb); } },
    games:     live ? remoteTable("matched_games")     : demoTable("games", (d,id)=>{
      const e = d.entries.filter(x=>x.game_id===id).map(x=>x.id);
      ["couples","players","questions","entries"].forEach(k=>d[k] = d[k].filter(x=>x.game_id!==id)); d.answers = d.answers.filter(a=>!e.includes(a.entry_id)); }),
    couples:   live ? remoteTable("matched_couples")   : demoTable("couples", (d,id)=>{ d.players.filter(p=>p.couple_id===id).map(p=>p.id).forEach(pid=>dropPlayer(d,pid)); d.players = d.players.filter(p=>p.couple_id!==id); }),
    players:   live ? remoteTable("matched_players")   : demoTable("players", dropPlayer),
    questions: live ? remoteTable("matched_questions") : demoTable("questions", (d,id)=>{ d.answers = d.answers.filter(a=>a.question_id!==id); }),
    entries:   live ? remoteTable("matched_entries")   : demoTable("entries", dropEntry),
  };

  // ---------- scoring (shared by the reveal page and the host page) ----------
  // A couple matches on a question when each partner's guess equals the other's own answer.
  window.Matched = {
    score(game, res){
      const ans = {}; (res.answers||[]).forEach(a=>{ (ans[a.question_id] = ans[a.question_id] || {})[a.player_id] = a; });
      const shownQs = game.questions.slice(0, Math.min(res.reveal_step||0, game.questions.length));
      const couples = game.couples.filter(c=>c.players.length===2).map(c=>({ ...c, points:0, oneway:0, perQ:{} }));
      shownQs.forEach(qq=>couples.forEach(c=>{
        const [a,b] = c.players, A = (ans[qq.id]||{})[a.id], B = (ans[qq.id]||{})[b.id];
        const aRight = !!(A && B && A.guess===B.own), bRight = !!(A && B && B.guess===A.own);
        const r = { A, B, aRight, bRight, matched: aRight && bRight };
        c.perQ[qq.id] = r; if(r.matched) c.points++; c.oneway += (aRight?1:0) + (bRight?1:0);
      }));
      const ranked = couples.slice().sort((x,y)=>(y.points-x.points) || (y.oneway-x.oneway));
      return { couples, ranked, shownQs };
    },
  };
})();
