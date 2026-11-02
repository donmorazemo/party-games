// AI question writer for Matched. Calls the Supabase function "matched-ai"
// (supabase/functions/matched-ai/index.ts), which holds the OpenRouter key and the prompts.
// Any signed-in host can use it; nothing secret lives in this public file.
(function(){
  async function call(body){
    if(!DB.live) throw new Error("AI works on the live site only (not in demo mode).");
    const { data, error } = await DB.sb.functions.invoke("matched-ai", { body });
    if(error){
      let m = error.message;
      try{ const j = await error.context.json(); if(j && j.error) m = j.error; }catch(e){}
      if(/Failed to send a request|Failed to fetch/i.test(m)) m = "AI isn't available right now (the matched-ai function may not be deployed).";
      throw new Error(m);
    }
    if(!data || !data.questions) throw new Error((data && data.error) || "The AI didn't return questions. Try again.");
    return data.questions;
  }
  window.MatchedAI = {
    questions: (count, theme, existing) => call({ mode:"questions", count, theme, existing: existing || [] }),
    options: async question => (await call({ mode:"options", question }))[0].options,
  };
})();
