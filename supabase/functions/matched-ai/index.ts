// Supabase Edge Function "matched-ai": writes questions with OpenRouter for Party Games:
// Matched (modes "questions", "options") and True or False (mode "truefalse").
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

// ---------- True or False (kids' elimination game) ----------
const TF_SYSTEM = `You write statements for "True or False", a fast elimination game for kids at a party.
How it's played: kids stand on a line with a TRUE side and a FALSE side. A grown-up moderator reads one statement aloud, the kids hop to the side they think is right, and the moderator reveals the answer. Kids on the wrong side are out. It continues until one winner is left, so the statements start easy (almost everyone stays in) and get harder as the game goes on.

Every statement must be:
- Definitely true or definitely false according to widely accepted, settled knowledge that a child of the given age could learn at school, from books for their age, or from everyday life. No opinions, no trick wording, no "it depends", no facts that are disputed, changing, or only true in some places, and no statements that experts or textbooks commonly disagree on.
- Right for the given age: use words a child that age understands, and facts a typical child that age could reasonably know. The hardest statements should still be answerable by a well-read child of that age, never adult-level trivia.
- Safe and kind: nothing scary, violent, sad, gross, romantic or rude; nothing about religion, politics, money, bodies or appearance; nothing that could single out or embarrass a child.
- Short and easy to hear: one sentence, ideally under 12 words, never over 18. Written as a plain statement (not a question), with no double negatives and no "not" tricks. Avoid "always" and "never" unless it's plainly accurate.
- On the topic. If the topic is broad, mix different parts of it. If the topic isn't suitable for children, use the nearest kid-friendly topic instead.

Across the set:
- Order from easy to hard: about the first third "easy", the middle third "medium", the last third "hard".
- About half true and half false, in a mixed order with no obvious pattern and never more than 3 of the same answer in a row.
- False statements change one fact so they sound believable (for example the wrong number, place, or animal), never silly or absurd.
- No two statements test the same fact.

For each statement also write "explain": one short sentence the moderator reads after the reveal. For false statements, give the correct fact.

Reply with JSON only, no other text, in exactly this shape:
{"questions":[{"statement":"...","answer":true,"level":"easy","explain":"..."}]}`;

const ageGuide = (age: number) =>
  age <= 5 ? "a preschooler (around kindergarten age)"
  : age <= 12 ? `a child in about grade ${age - 5} of elementary or middle school`
  : `a teenager in about grade ${Math.min(age - 5, 12)} of school`;

const tfPrompt = (age: number, topic: string, count: number, existing: string[]) =>
  `Write ${count} statements for ${age}-year-olds (${ageGuide(age)}).\nTopic: ${topic || "general knowledge"}` +
  (existing.length ? `\nThese statements are already in the game; don't repeat them or test the same facts:\n- ${existing.join("\n- ")}` : "");

type TF = { statement: string; answer: boolean; level: string; explain: string };
function parseTF(text: unknown): TF[] {
  const s = String(text ?? ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("The AI didn't return statements. Try again.");
  const data = JSON.parse(s.slice(a, b + 1));
  const seen = new Set<string>(), rank: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
  const qs: TF[] = [];
  for (const x of (data.questions ?? [])) {
    const statement = String(x?.statement ?? "").trim().slice(0, 200);
    const ans = x?.answer === true || x?.answer === "true" ? true : x?.answer === false || x?.answer === "false" ? false : null;
    const level = ["easy", "medium", "hard"].includes(String(x?.level).toLowerCase()) ? String(x.level).toLowerCase() : "medium";
    const key = statement.toLowerCase();
    if (!statement || ans === null || seen.has(key)) continue;
    seen.add(key);
    qs.push({ statement, answer: ans, level, explain: String(x?.explain ?? "").trim().slice(0, 240) });
  }
  if (!qs.length) throw new Error("The AI didn't return usable statements. Try again.");
  return qs.map((q, i) => ({ q, i })).sort((x, y) => (rank[x.q.level] - rank[y.q.level]) || (x.i - y.i)).map((x) => x.q);
}

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
  let prompt: string, system = SYSTEM, maxTokens = 1500, temperature = 0.9;
  if (body?.mode === "truefalse") {
    const age = Math.min(Math.max(parseInt(body.age) || 8, 3), 18);
    const count = Math.min(Math.max(parseInt(body.count) || 15, 3), 30);
    const topic = String(body.topic ?? "").trim().slice(0, 120);
    const existing = (Array.isArray(body.existing) ? body.existing : []).slice(0, 60).map((s: unknown) => String(s).slice(0, 200));
    prompt = tfPrompt(age, topic, count, existing);
    system = TF_SYSTEM; maxTokens = 4000; temperature = 0.5;   // lower temperature: facts over flair
  } else if (body?.mode === "questions") {
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
               "HTTP-Referer": "https://donmorazemo.github.io/party-games/", "X-Title": "Party Games" },
    body: JSON.stringify({ model: Deno.env.get("OPENROUTER_MODEL") || "openrouter/auto", temperature,
      max_tokens: maxTokens,   // caps the cost of any single request (1500 Matched, 4000 for 30 True or False statements)
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: out?.error?.message || `OpenRouter error ${r.status}` }, 502);
  const content = out?.choices?.[0]?.message?.content;
  try { return json({ questions: body.mode === "truefalse" ? parseTF(content) : parse(content) }); }
  catch (e) { return json({ error: (e as Error).message }, 502); }
});
