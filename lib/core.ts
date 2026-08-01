import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

export const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export const MODELS = {
  creative: "claude-sonnet-5",          // idea generation, captions, lesson writing
  critic: "claude-sonnet-5",            // vision — must actually see shadow ratio and hue count
  cheap: "claude-haiku-4-5-20251001",   // dedupe, classification
} as const;

/** Every cron pass is wrapped in this. If a job stops firing you find out in `runs`. */
export async function withRun<T>(job: string, fn: () => Promise<T>) {
  const { data: run } = await db.from("runs").insert({ job }).select("id").single();
  try {
    const summary = await fn();
    await db.from("runs").update({ ok: true, summary, finished_at: new Date().toISOString() })
      .eq("id", run!.id);
    return { ok: true, summary };
  } catch (e: any) {
    await db.from("runs").update({ ok: false, error: String(e?.message ?? e), finished_at: new Date().toISOString() })
      .eq("id", run!.id);
    throw e;
  }
}

export function authorised(req: Request) {
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

/** Ask Claude for strict JSON. Retries once on parse failure. */
export async function askJSON<T>(opts: {
  model?: string; system: string; user: any; maxTokens?: number;
}): Promise<T> {
  const call = async (nudge = "") => {
    const res = await anthropic.messages.create({
      model: opts.model ?? MODELS.creative,
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system + "\n\nRespond with raw JSON only. No prose, no markdown fences." + nudge,
      messages: [{ role: "user", content: opts.user }],
    });
    const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim());
  };
  try { return await call(); }
  catch { return await call(" Your previous reply failed to parse. Emit valid JSON."); }
}

// ─── Constitution ──────────────────────────────────────────────

export type Constitution = Record<string, any>;

export async function loadConstitution(): Promise<Constitution> {
  const { data } = await db.from("constitution").select("key,value").eq("status", "active");
  return Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
}

/** Renders the constitution as a system-prompt block so every model call obeys the same laws. */
export function constitutionBrief(c: Constitution) {
  return `APEX BRAND CONSTITUTION (binding — violations are rejected downstream)
Palette: ${c.palette.base}, hue ${c.palette.base_hue_range.join("–")}. Exactly ${c.palette.accent_count_max} saturated element per frame: ${c.palette.accent}. Semantic colour is ${c.palette.semantic_colors}.
Lighting: ${c.lighting_law.sources} hard source, minimum ${c.lighting_law.min_shadow_ratio * 100}% of frame in deep shadow, visible haze. Evenly lit is off-brand.
Subject: faces are ${c.subject_law.faces_allowed ? "allowed" : "NEVER permitted"}. Bodies appear only as ${c.subject_law.body_treatment.join(", ")}.
Text: no generated text, numbers, logos or UI in frame — all type is composited afterwards.
Grid: ${c.grid_rhythm.rule}.`;
}

// ─── Prompt assembly ───────────────────────────────────────────

/**
 * §6 "lock a seed per pillar" — we re-run the same seed with a new subject
 * rather than writing a fresh prompt, which is what makes the grid cohere.
 */
export function assemblePrompt(subjectPrompt: string, c: Constitution) {
  return `${subjectPrompt.trim().replace(/\.$/, "")}. ${c.prompt_suffix}`;
}

export function normaliseHook(hook: string) {
  return hook.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).sort().join(" ");
}

export async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
