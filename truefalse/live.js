// Live link between the moderator's phone and TV screens.
// Uses a Supabase Realtime broadcast channel (works across devices; no database writes) and, on the same
// device, a BroadcastChannel (e.g. a laptop driving a TV through a second window). Messages are plain objects.
(function(){
  const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";   // no look-alikes (0/o, 1/l/i)
  function newRoom(){ const a = new Uint8Array(6); crypto.getRandomValues(a); return Array.from(a, n=>ALPHA[n % ALPHA.length]).join(""); }
  function open(room, onMsg){
    const name = "tf-" + room, out = { status:"connecting", send(){} };
    let bc = null, ch = null, ready = false;
    try{ bc = new BroadcastChannel(name); bc.onmessage = e => onMsg(e.data); }catch(e){}
    if(DB.live && DB.sb){
      ch = DB.sb.channel(name, { config:{ broadcast:{ self:false } } })
        .on("broadcast", { event:"m" }, ({ payload }) => onMsg(payload))
        .subscribe(st => { ready = st === "SUBSCRIBED"; out.status = ready ? "online" : st.toLowerCase(); if(out.onStatus) out.onStatus(out.status); });
    } else { out.status = "local"; }
    out.send = msg => { try{ bc && bc.postMessage(msg); }catch(e){} if(ch && ready) ch.send({ type:"broadcast", event:"m", payload:msg }); };
    return out;
  }
  // Short beeps for the countdown (browsers allow sound only after a tap on the page).
  let ctx = null;
  function beep(freq, ms){
    try{ ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if(ctx.state === "suspended") ctx.resume();
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms/1000);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + ms/1000 + 0.05); }catch(e){}
  }
  function unlockSound(){ try{ ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); }catch(e){} }
  // Runs 3, 2, 1, HOP! calling show(text) each second; returns a cancel function.
  function countdown(show, sound, done){
    const steps = ["3","2","1","HOP!"]; let i = 0, t = null, stopped = false;
    const tick = () => { if(stopped) return; const s = steps[i]; show(s); if(sound) beep(s === "HOP!" ? 990 : 660, s === "HOP!" ? 450 : 160);
      i++; if(i < steps.length) t = setTimeout(tick, 1000); else t = setTimeout(()=>{ if(!stopped) done && done(); }, 900); };
    tick();
    return () => { stopped = true; clearTimeout(t); };
  }
  window.TFLive = { newRoom, open, beep, unlockSound, countdown };
})();
