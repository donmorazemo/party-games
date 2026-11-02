// Supabase Edge Function "matched-ai": writes Matched questions with OpenRouter.
// The OpenRouter key lives only here, as the secret OPENROUTER_API_KEY (Supabase → Edge Functions → Secrets).
// Optional secrets: OPENROUTER_MODEL (default "openrouter/auto"), AI_LIMIT_PER_HOUR (default 30 per host),
// AI_LIMIT_PER_DAY (default 200, all hosts together).
// Only approved hosts (table public.ai_hosts, see supabase/matched_ai_hosts.sql) can call it, and the prompts
// are fixed here, so the key can't be used by strangers or for anything else.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

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

const questionsPrompt = (count: number, theme: string, existing: string[]) =>
  `Write ${count} new questions.` +
  (theme ? `\nTheme or vibe for this party: ${theme}` : "") +
  (existing.length ? `\nDon't repeat or closely resemble these existing questions:\n- ${existing.join("\n- ")}` : "");

const optionsPrompt = (question: string) =>
  `Write answer options for this one question, keeping the question text exactly as given:\n${question}\nReturn it as a single item in "questions".`;

type Q = { prompt: string; options: string[] };
function parse(text: unknown): Q[] {
  const s = String(text ?? ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("The AI didn't return questions. Try again.");
  const data = JSON.parse(s.slice(a, b + 1));
  const qs = (data.questions ?? []).map((x: any) => ({
    prompt: String(x?.prompt ?? "").trim().slice(0, 200),
    options: [...new Set((x?.options ?? []).map((o: unknown) => String(o).trim().slice(0, 60)).filter(Boolean))].slice(0, 6) as string[],
  })).filter((x: Q) => x.prompt && x.options.length >= 2);
  if (!qs.length) throw new Error("The AI didn't return usable questions. Try again.");
  return qs;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return json({ error: "AI isn't set up yet: the OPENROUTER_API_KEY secret is missing in Supabase." }, 500);

  // Who's asking? Must be a signed-in host.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (authErr || !user) return json({ error: "Sign in as a host to use AI." }, 401);

  // Approved hosts only
  const email = (user.email ?? "").toLowerCase();
  const { data: approved, error: hostsErr } = await admin.from("ai_hosts").select("email").eq("email", email).maybeSingle();
  if (hostsErr) return json({ error: "AI hosts table is missing: run supabase/matched_ai_hosts.sql." }, 500);
  if (!email || !approved) return json({ error: "AI question writing is only available to approved hosts." }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  let prompt: string;
  if (body?.mode === "questions") {
    const count = Math.min(Math.max(parseInt(body.count) || 5, 1), 10);
    const theme = String(body.theme ?? "").trim().slice(0, 200);
    const existing = (Array.isArray(body.existing) ? body.existing : []).slice(0, 50).map((s: unknown) => String(s).slice(0, 150));
    prompt = questionsPrompt(count, theme, existing);
  } else if (body?.mode === "options") {
    const q = String(body.question ?? "").trim().slice(0, 200);
    if (!q) return json({ error: "Type the question first." }, 400);
    prompt = optionsPrompt(q);
  } else return json({ error: "Bad request" }, 400);

  // Per-host hourly limit
  const limit = Number(Deno.env.get("AI_LIMIT_PER_HOUR") ?? 30);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count: used, error: usageErr } = await admin.from("ai_usage").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).gte("created_at", since);
  if (usageErr) return json({ error: "AI usage table is missing: run supabase/matched_ai.sql." }, 500);
  if ((used ?? 0) >= limit) return json({ error: `You've used AI ${limit} times this hour. Try again later.` }, 429);
  const dayLimit = Number(Deno.env.get("AI_LIMIT_PER_DAY") ?? 200);
  const { count: today } = await admin.from("ai_usage").select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 86400_000).toISOString());
  if ((today ?? 0) >= dayLimit) return json({ error: "The AI has reached today's limit. Try again tomorrow." }, 429);
  await admin.from("ai_usage").insert({ user_id: user.id, mode: body.mode });

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json",
               "HTTP-Referer": "https://donmorazemo.github.io/party-games/", "X-Title": "Party Games: Matched" },
    body: JSON.stringify({ model: Deno.env.get("OPENROUTER_MODEL") || "openrouter/auto", temperature: 0.9,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }] }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: out?.error?.message || `OpenRouter error ${r.status}` }, 502);
  try { return json({ questions: parse(out?.choices?.[0]?.message?.content) }); }
  catch (e) { return json({ error: (e as Error).message }, 502); }
});
