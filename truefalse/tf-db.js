// True or False data layer: the host's saved question sets (table tf_games).
// Live: Supabase through the shared client (DB.sb). Demo (no keys): this browser's localStorage.
(function(){
  const live = DB.live, sb = DB.sb;
  async function q(p){ const { data, error } = await p;
    if(error) throw new Error(/tf_games/.test(error.message) ? "True or False isn't set up in the database yet: run supabase/truefalse.sql in Supabase." : error.message);
    return data; }
  const LK = "tf_demo_db";
  const load = () => { try { return JSON.parse(localStorage.getItem(LK)) || { games:[] }; } catch(e){ return { games:[] }; } };
  const save = d => localStorage.setItem(LK, JSON.stringify(d));
  const demo = {
    async list(){ return load().games.slice().sort((a,b)=>b.id-a.id); },
    async get(id){ return load().games.find(g=>g.id===+id) || null; },
    async save(row){ const d = load();
      if(row.id){ const i = d.games.findIndex(g=>g.id===row.id); d.games[i] = { ...d.games[i], ...row }; save(d); return d.games[i]; }
      const r = { plays:0, created_at:new Date().toISOString(), ...row, id:Date.now() }; d.games.push(r); save(d); return r; },
    async del(id){ const d = load(); d.games = d.games.filter(g=>g.id!==id); save(d); },
  };
  const remote = {
    list: me => q(sb.from("tf_games").select("*").eq("owner_id", me.id).order("created_at", { ascending:false })),
    get: async id => (await q(sb.from("tf_games").select("*").eq("id", id).limit(1)))[0] || null,
    async save(row){
      if(row.id){ const { id, ...rest } = row; return (await q(sb.from("tf_games").update(rest).eq("id", id).select()))[0]; }
      return (await q(sb.from("tf_games").insert(row).select()))[0];
    },
    del: id => q(sb.from("tf_games").delete().eq("id", id)),
  };
  window.TFDB = { live, ...(live ? remote : demo) };

  // AI: same server function and approved-hosts rule as Matched; prompt lives in supabase/functions/matched-ai.
  window.TFAI = {
    async allowed(){ if(!live) return false; try{ const r = await sb.rpc("can_use_ai"); return !!r.data; }catch(e){ return false; } },
    async write(age, topic, count, existing){
      if(!live) throw new Error("AI works on the live site only (not in demo mode).");
      const { data, error } = await sb.functions.invoke("matched-ai", { body:{ mode:"truefalse", age, topic, count, existing: existing || [] } });
      if(error){ let m = error.message; try{ const j = await error.context.json(); if(j && j.error) m = j.error; }catch(e){}
        if(m === "Bad request") m = "The AI server hasn't been updated for True or False yet: deploy the matched-ai function in Supabase.";
        throw new Error(m); }
      if(!data || !data.questions) throw new Error((data && data.error) || "The AI didn't return statements. Try again.");
      return data.questions;
    },
  };
})();
