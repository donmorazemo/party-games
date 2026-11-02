// Data layer. Supabase when configured; otherwise a localStorage "demo mode"
// that mimics the same rules so the site can be tried locally.
(function(){
  const C = window.PARTY_CONFIG;
  const live = !!(C.supabaseUrl && C.supabaseAnonKey && window.supabase);
  const sb = live ? window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey) : null;
  async function q(p){ const { data, error } = await p; if(error) throw new Error(error.message); return data; }

  // ---------- device tokens: one secret per (party, guest) this device voted as ----------
  function rand(){ const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, b=>b.toString(16).padStart(2,"0")).join(""); }
  const tokKey = slug => "hw_tokens_" + slug;
  const Tokens = {
    all(slug){ try { return JSON.parse(localStorage.getItem(tokKey(slug))) || {}; } catch(e){ return {}; } },
    get(slug, guestId){ return this.all(slug)[guestId] || null; },
    ensure(slug, guestId){ const t = this.all(slug); if(!t[guestId]){ t[guestId] = rand(); localStorage.setItem(tokKey(slug), JSON.stringify(t)); } return t[guestId]; },
  };

  // ---------- demo-mode store ----------
  const LK = "hw_demo_db";
  const load = () => { try { return JSON.parse(localStorage.getItem(LK)); } catch(e){ return null; } };
  const save = d => { localStorage.setItem(LK, JSON.stringify(d)); window.dispatchEvent(new Event("hw-change")); };
  const nid = () => Date.now()*1000 + Math.floor(Math.random()*1000);
  const bySort = (x,y) => (x.sort-y.sort) || (x.id-y.id);
  const hash = s => "h" + Array.from(s).reduce((h,c)=>((h<<5)-h+c.charCodeAt(0))|0, 7);
  if(!live && !load()){
    const p = C.demoParty || { name:"Demo Party", awards:[], guests:[] };
    const d = { parties:[{ id:1, slug:"demo", name:p.name, subtitle:p.subtitle||"", voting_open:true }], awards:[], guests:[], ballots:[], votes:[] };
    (p.awards||[]).forEach((a,i)=>d.awards.push({ id:i+1, party_id:1, name:a.name, emoji:a.emoji||"🏆", sort:i }));
    (p.guests||[]).forEach((g,i)=>d.guests.push({ id:100+i, party_id:1, name:g.name, costume:g.costume||"", sort:i }));
    save(d);
  }
  const demo = {
    get_party(slug){
      const d = load(), p = d.parties.find(x=>x.slug===slug); if(!p) return null;
      return { party:p, awards:d.awards.filter(a=>a.party_id===p.id).sort(bySort), guests:d.guests.filter(g=>g.party_id===p.id).sort(bySort),
               voted:d.ballots.filter(b=>b.party_id===p.id).map(b=>b.voter_guest_id) };
    },
    get_my_ballot(slug, voter, token){
      const d = load(), b = d.ballots.find(x=>x.voter_guest_id===voter && x.token_hash===hash(token)); if(!b) return null;
      const o = {}; d.votes.filter(v=>v.ballot_id===b.id).forEach(v=>o[v.award_id]=v.nominee_id); return o;
    },
    submit_ballot(slug, voter, token, picks){
      const d = load(), p = d.parties.find(x=>x.slug===slug);
      if(!p) throw new Error("Party not found"); if(!p.voting_open) throw new Error("VOTING_CLOSED");
      if(!d.guests.some(g=>g.id===voter && g.party_id===p.id)) throw new Error("Unknown guest");
      let b = d.ballots.find(x=>x.voter_guest_id===voter);
      if(b && b.token_hash!==hash(token)) throw new Error("ALREADY_VOTED");
      if(!b){ b = { id:nid(), party_id:p.id, voter_guest_id:voter, token_hash:hash(token), updated_at:new Date().toISOString() }; d.ballots.push(b); }
      for(const [a,n] of Object.entries(picks)){
        const ex = d.votes.find(v=>v.ballot_id===b.id && v.award_id===+a);
        if(ex) ex.nominee_id = +n; else d.votes.push({ id:nid(), ballot_id:b.id, award_id:+a, nominee_id:+n });
      }
      b.updated_at = new Date().toISOString(); save(d);
    },
    get_results(slug){
      const d = load(), p = d.parties.find(x=>x.slug===slug); if(!p) return null;
      const bids = new Set(d.ballots.filter(b=>b.party_id===p.id).map(b=>b.id)), t = {};
      d.votes.filter(v=>bids.has(v.ballot_id)).forEach(v=>{ const k=v.award_id+":"+v.nominee_id; t[k]=(t[k]||0)+1; });
      return { voters:bids.size, tallies:Object.entries(t).map(([k,n])=>{ const [a,g]=k.split(":"); return { award_id:+a, nominee_id:+g, n }; }) };
    },
  };
  function demoTable(name, cascade){
    return {
      async list(filter){ const d = load(); return d[name].filter(r=>!filter || Object.entries(filter).every(([k,v])=>r[k]===v)).sort(bySort); },
      async save(row){
        const d = load(), all = d[name];
        if(row.id){ const i = all.findIndex(r=>r.id===row.id); all[i] = { ...all[i], ...row }; row = all[i]; }
        else { row = { sort:0, ...row, id:nid() }; if(name==="parties") row = { subtitle:"", voting_open:true, slug:rand().slice(0,10), ...row }; all.push(row); }
        save(d); return row;
      },
      async del(id){ const d = load(); d[name] = d[name].filter(r=>r.id!==id); cascade && cascade(d, id); save(d); },
      async delWhere(filter){ const d = load(); const gone = d[name].filter(r=>Object.entries(filter).every(([k,v])=>r[k]===v)).map(r=>r.id);
        d[name] = d[name].filter(r=>!gone.includes(r.id)); gone.forEach(id=>cascade && cascade(d,id)); save(d); },
    };
  }
  const dropBallotVotes = (d,id)=>{ d.votes = d.votes.filter(v=>v.ballot_id!==id); };

  // ---------- Supabase tables (host only) ----------
  function remoteTable(t){
    return {
      list(filter){ let r = sb.from(t).select("*"); Object.entries(filter||{}).forEach(([k,v])=>r=r.eq(k,v));
        if(t!=="ballots") r = t==="parties" ? r.order("created_at",{ascending:false}) : r.order("sort").order("id"); return q(r); },
      async save(row){
        if(row.id){ const { id, ...rest } = row; return (await q(sb.from(t).update(rest).eq("id", id).select()))[0]; }
        return (await q(sb.from(t).insert(row).select()))[0];
      },
      del: id => q(sb.from(t).delete().eq("id", id)),
      delWhere(filter){ let r = sb.from(t).delete(); Object.entries(filter).forEach(([k,v])=>r=r.eq(k,v)); return q(r); },
    };
  }

  const rpc = (fn, args) => live ? q(sb.rpc(fn, args)) : Promise.resolve().then(()=>demo[fn](...Object.values(args)));

  window.DB = {
    live, Tokens,
    // Guest-facing
    getParty:   slug => rpc("get_party", { p_slug:slug }),
    getMyBallot:(slug, voter, token) => rpc("get_my_ballot", { p_slug:slug, p_voter:voter, p_token:token }),
    submitBallot:(slug, voter, token, picks) => rpc("submit_ballot", { p_slug:slug, p_voter:voter, p_token:token, p_picks:picks }),
    getResults: slug => rpc("get_results", { p_slug:slug }),
    onChange(cb){ if(!live){ window.addEventListener("storage", cb); window.addEventListener("hw-change", cb); } },

    // Host-facing
    parties: live ? remoteTable("parties") : demoTable("parties", (d,id)=>{
      const g = d.guests.filter(x=>x.party_id===id).map(x=>x.id), b = d.ballots.filter(x=>x.party_id===id).map(x=>x.id);
      d.awards = d.awards.filter(x=>x.party_id!==id); d.guests = d.guests.filter(x=>x.party_id!==id);
      d.ballots = d.ballots.filter(x=>x.party_id!==id); d.votes = d.votes.filter(v=>!b.includes(v.ballot_id)); }),
    awards:  live ? remoteTable("awards")  : demoTable("awards",  (d,id)=>{ d.votes = d.votes.filter(v=>v.award_id!==id); }),
    guests:  live ? remoteTable("guests")  : demoTable("guests",  (d,id)=>{
      const b = d.ballots.filter(x=>x.voter_guest_id===id).map(x=>x.id);
      d.ballots = d.ballots.filter(x=>x.voter_guest_id!==id); d.votes = d.votes.filter(v=>v.nominee_id!==id && !b.includes(v.ballot_id)); }),
    ballots: live ? remoteTable("ballots") : demoTable("ballots", dropBallotVotes),
    async session(){ if(!live) return { user:{ id:null, email:"demo" } }; return (await sb.auth.getSession()).data.session; },
    async signInWithGoogle(){
      const redirectTo = location.origin + location.pathname;
      const { error } = await sb.auth.signInWithOAuth({ provider:"google", options:{ redirectTo } });
      if(error) throw error;
    },
    async signInWithPassword(email, password){ const { error } = await sb.auth.signInWithPassword({ email, password }); if(error) throw error; },
    async signOut(){ if(live) await sb.auth.signOut(); },
    onAuth(cb){ if(live) sb.auth.onAuthStateChange((evt)=>cb(evt)); },
  };
})();
