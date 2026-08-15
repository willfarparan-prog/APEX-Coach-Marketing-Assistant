import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

export const db = createClient(
  (process.env.SUPABASE_URL ?? "").trim(),
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
  { auth: { persistSession: false } }
);

export const anthropic = new Anthropic({ apiKey: (process.env.ANTHROPIC_API_KEY ?? "").trim() });

export const MODELS = {
  creative: "claude-sonnet-5",
  critic: "claude-sonnet-5",
  cheap: "claude-haiku-4-5-20251001",
} as const;

/**
 * Detect an image's real media type from its magic bytes, rather than trusting
 * an HTTP content-type header.
 *
 * WHY THIS EXISTS: Supabase Storage sets content-type from the object NAME, not
 * the actual bytes. A ".jpg"-named object can contain PNG data. Anthropic's API
 * strictly rejects any media_type/bytes mismatch with a 500 error that reads
 * "The image was specified using the image/jpeg media type, but the image
 * appears to be a image/png image".
 *
 * ANY new code path that sends images to Claude MUST use this.
 */
export function sniffMediaType(buf: Buffer): "image/png" | "image/jpeg" | "image/gif" | "image/webp" {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 6 && (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a")) return "image/gif";
  return "image/jpeg";
}

export async function withRun<T>(job: string, fn: () => Promise<T>) {
  const { data: run, error: runErr } = await db.from("runs").insert({ job }).select("id").single();
  if (runErr) console.error("runs insert failed:", JSON.stringify(runErr));
  try {
    const summary = await fn();
    if (run?.id) await db.from("runs").update({ ok: true, summary, finished_at: new Date().toISOString() }).eq("id", run.id);
    return { ok: true, summary, run_log_error: runErr?.message ?? null };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (run?.id) await db.from("runs").update({ ok: false, error: msg, finished_at: new Date().toISOString() }).eq("id", run.id);
    throw e;
  }
}

export function authorised(req: Request) {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

/**
 * Extract a JSON object from a model response that may include stray prose or
 * markdown fences. Brace-matching handles the case where the model prefixes or
 * suffixes the JSON with commentary despite instructions not to.
 */
function extractJSON(text: string): string {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return cleaned;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return cleaned.slice(start);
}

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
    if (!text.trim()) {
      throw new Error(`empty response from model (stop_reason: ${res.stop_reason})`);
    }
    try {
      return JSON.parse(extractJSON(text));
    } catch (e: any) {
      throw new Error(
        `JSON parse failed (stop_reason: ${res.stop_reason}, length: ${text.length}). ` +
        `Raw start: ${text.slice(0, 200)}`
      );
    }
  };
  try { return await call(); }
  catch { return await call(" Your previous reply failed to parse. Emit valid JSON."); }
}

export type Constitution = Record<string, any>;
export type Variant = "dark" | "light";

export async function loadConstitution(variant: Variant = "dark"): Promise<Constitution> {
  const { data, error } = await db.from("constitution").select("key,value").eq("status", "active").eq("variant", variant);
  if (error) throw new Error("constitution load failed: " + error.message);
  if (!data?.length) throw new Error(`constitution is empty for variant '${variant}'`);
  return Object.fromEntries(data.map((r: any) => [r.key, r.value]));
}

export async function loadConstitutions(): Promise<Record<Variant, Constitution>> {
  const [dark, light] = await Promise.all([loadConstitution("dark"), loadConstitution("light")]);
  return { dark, light };
}

export function constitutionBrief(c: Constitution) {
  return `APEX BRAND CONSTITUTION (binding — violations are rejected downstream)
Palette: ${c.palette.base}, hue ${c.palette.base_hue_range.join("–")}. Exactly ${c.palette.accent_count_max} saturated element per frame: ${c.palette.accent}. Semantic colour is ${c.palette.semantic_colors}.
Lighting: ${c.lighting_law.sources} source(s), minimum ${c.lighting_law.min_shadow_ratio * 100}% of frame in deep shadow, haze ${c.lighting_law.haze ? "visible" : "none"}.
Subject: faces are ${c.subject_law.faces_allowed ? "allowed and encouraged" : "NEVER permitted"}. Bodies appear as ${c.subject_law.body_treatment.join(", ")}.${c.subject_law.note ? " " + c.subject_law.note : ""}
Text: ${c.text_rendering?.in_frame_text ? `in-image text is ENCOURAGED for most posts, style: ${c.text_rendering.text_style}` : "no generated text, numbers, logos or UI in frame — all type is composited afterwards"}.
Grid: ${c.grid_rhythm.rule}.`;
}

export function assemblePrompt(subjectPrompt: string, c: Constitution, headlineText?: string | null) {
  const wantsText = c.text_rendering?.in_frame_text && headlineText;
  const textClause = wantsText
    ? ` Include the headline text "${headlineText}" rendered cleanly and legibly in ${c.text_rendering.text_style ?? "bold on-brand typography"}, integrated naturally into the scene — not a floating caption or watermark.`
    : "";
  return `${subjectPrompt.trim().replace(/\.$/, "")}.${textClause} ${c.prompt_suffix}`;
}

export function normaliseHook(hook: string) {
  return hook.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).sort().join(" ");
}

export async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function archiveImage(sourceUrl: string, path: string): Promise<string | null> {
  try {
    const img = await fetch(sourceUrl);
    if (!img.ok) return null;
    const buf = Buffer.from(await img.arrayBuffer());
    const contentType = img.headers.get("content-type") || "image/jpeg";

    const base = (process.env.SUPABASE_URL ?? "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
    const uploadUrl = `${base}/storage/v1/object/generations/${path}`;

    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: buf,
    });
    if (!res.ok) {
      console.error("archiveImage upload failed:", await res.text());
      return null;
    }
    return `${base}/storage/v1/object/public/generations/${path}`;
  } catch (e) {
    console.error("archiveImage error:", e);
    return null;
  }
}
