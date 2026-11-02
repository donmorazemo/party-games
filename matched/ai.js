// AI question writer for Matched, via OpenRouter (https://openrouter.ai).
// The host pastes an OpenRouter key on the host page; it's saved only in that browser
// (localStorage) and sent only to openrouter.ai. Never commit a key to this repo: it's public.
(function(){
  const KEY = "pg_openrouter_key", MODEL = "pg_openrouter_model";
  const DEFAULT_MODEL = "openrouter/auto";   // OpenRouter picks a model; set a specific one on the host page

  // ---------- Prompts (edit these to change what the AI writes) ----------
  const SYSTEM = `You write questions for "Matched", a couples party game.
How the game works: each guest answers a multiple-choice question for themselves, then predicts which option their partner chose. A couple scores when both partners predict each other correctly.

Write questions that:
- Are fun, warm and safe for a mixed party (friends, family, colleagues). Nothing sexual, crude, or likely to embarrass or start a fight.
- Are about the person answering (their tastes, habits, wishes, opinions), so each partner can have a different answer.
- Never ask "who in the couple" (no "Me" / "My partner" options): those read differently for each partner.
- Are short: one line, under 70 characters.

Write answer options that:
- Number 3 to 5 per question (2 only for true either/or questions).
- Are 1 to 4 words each, clearly different from each other, and cover the likely answers (add a catch-all like "Something else" only when needed).

Reply with JSON only, no other text, in exactly this shape:
{"questions":[{"prompt":"...","options":["...","..."]}]}`;

  const questionsPrompt = (count, theme, existing) =>
    `Write ${count} new questions.` +
    (theme ? `\nTheme or vibe for this party: ${theme}` : "") +
    (existing.length ? `\nDon't repeat or closely resemble these existing questions:\n- ${existing.join("\n- ")}` : "");

  const optionsPrompt = (question) =>
    `Write answer options for this one question, keeping the question text exactly as given:\n${question}\nReturn it as a single item in "questions".`;

  // ---------- OpenRouter call ----------
  function settings(){ let key = "", model = ""; try{ key = localStorage.getItem(KEY) || ""; model = localStorage.getItem(MODEL) || ""; }catch(e){}
    return { key, model: model || DEFAULT_MODEL }; }
  function saveSettings(key, model){ try{ key ? localStorage.setItem(KEY, key) : localStorage.removeItem(KEY);
    model && model !== DEFAULT_MODEL ? localStorage.setItem(MODEL, model) : localStorage.removeItem(MODEL); }catch(e){} }

  function parse(text){
    const s = String(text||""), a = s.indexOf("{"), b = s.lastIndexOf("}");
    if(a < 0 || b < a) throw new Error("The AI didn't return questions. Try again.");
    const data = JSON.parse(s.slice(a, b+1));
    const qs = (data.questions || []).map(x=>({
      prompt: String(x.prompt||"").trim().slice(0, 200),
      options: [...new Set((x.options||[]).map(o=>String(o).trim().slice(0, 60)).filter(Boolean))].slice(0, 6),
    })).filter(x=>x.prompt && x.options.length >= 2);
    if(!qs.length) throw new Error("The AI didn't return usable questions. Try again.");
    return qs;
  }

  async function ask(user){
    const { key, model } = settings();
    if(!key) throw new Error("Add your OpenRouter key in AI settings first.");
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json",
                 "HTTP-Referer": location.origin + "/party-games/", "X-Title": "Party Games: Matched" },
      body: JSON.stringify({ model, temperature: 0.9,
        messages: [{ role:"system", content:SYSTEM }, { role:"user", content:user }] }),
    });
    const body = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error((body.error && body.error.message) || ("OpenRouter error " + r.status));
    return parse(body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content);
  }

  window.MatchedAI = {
    DEFAULT_MODEL, settings, saveSettings, parse,
    hasKey: () => !!settings().key,
    questions: (count, theme, existing) => ask(questionsPrompt(count, theme, existing||[])),
    options: async question => (await ask(optionsPrompt(question)))[0].options,
  };
})();
