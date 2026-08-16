import { db } from "@/lib/core";

export const dynamic = "force-dynamic";

/** Smoke test: confirms fal credentials work and submission succeeds. */
export async function GET() {
  const results: Record<string, any> = {};

  let submitOk = false;
  let submitErr: any = null;
  try {
    const { fal } = await import("@fal-ai/client");
    fal.config({ credentials: (process.env.FAL_KEY ?? "").trim() });
    const input: any = { prompt: "a single grey pebble on white background", image_size: "portrait_16_9", num_images: 1 };
    const res = await fal.queue.submit("fal-ai/flux-2-pro", { input });
    submitOk = true;
    results.request_id = res.request_id;
  } catch (e: any) {
    submitErr = { message: e?.message, status: e?.status, body: e?.body, name: e?.name };
  }
  results.fal_submit = { ok: submitOk, error: submitErr };

  return Response.json(results);
}
