import { db } from "@/lib/core";

export const maxDuration = 60;

/** fal.ai calls this when a LoRA training run completes (or fails). */
export async function POST(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== (process.env.CRON_SECRET ?? "").trim())
    return new Response("no", { status: 401 });

  const loraId = url.searchParams.get("run");
  if (!loraId) return new Response("no", { status: 400 });

  const body: any = await req.json().catch(() => ({}));
  const weightUrl: string | undefined = body?.payload?.diffusers_lora_file?.url ?? body?.payload?.lora_file?.url;

  if (body.status === "ERROR" || !weightUrl) {
    await db.from("lora_models").update({
      status: "failed",
      notes: body?.error ? String(body.error).slice(0, 500) : "training failed or returned no weight file",
    }).eq("id", loraId);
    return Response.json({ ok: false });
  }

  await db.from("lora_models").update({
    weight_url: weightUrl, status: "ready", trained_at: new Date().toISOString(),
  }).eq("id", loraId);

  return Response.json({ ok: true });
}
