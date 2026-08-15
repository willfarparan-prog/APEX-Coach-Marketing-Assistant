import { fal } from "@fal-ai/client";

fal.config({ credentials: (process.env.FAL_KEY ?? "").trim() });

export const ROUTE = {
  backplate: "fal-ai/flux-2-pro",
  hero: "fal-ai/nano-banana-pro",
  composite: "fal-ai/nano-banana-pro/edit",
  motion: "fal-ai/kling-video/v3/pro/image-to-video",
  // PHASE 3: LoRA inference endpoint. Accepts loras: [{ path, scale }].
  lora: "fal-ai/flux-lora",
} as const;

export const TRAINING_MODEL = "fal-ai/flux-lora-fast-training";

export type Route = keyof typeof ROUTE;

const COST: Record<string, number> = {
  "fal-ai/flux-2-pro": 0.04,
  "fal-ai/nano-banana-pro": 0.08,
  "fal-ai/nano-banana-pro/edit": 0.08,
  "fal-ai/flux-lora": 0.025,
};

export function estimateCost(model: string) {
  return COST[model] ?? 0.1;
}

/**
 * flux-2-pro uses an image_size ENUM.
 * nano-banana-pro variants use an aspect_ratio STRING.
 * Getting this wrong produces a silent API rejection.
 */
/** flux-lora shares flux-2-pro's image_size ENUM (not nano-banana's aspect_ratio string). */
function sizingParam(model: string, aspect: "9:16" | "4:5" | "1:1") {
  if (model === "fal-ai/flux-2-pro" || model === "fal-ai/flux-lora") {
    const map: Record<string, string> = { "9:16": "portrait_16_9", "4:5": "portrait_4_3", "1:1": "square_hd" };
    return { image_size: map[aspect] ?? "portrait_16_9" };
  }
  return { aspect_ratio: aspect };
}

export async function submitImage(opts: {
  model: string;
  prompt: string;
  seed?: number;
  aspect?: "9:16" | "4:5" | "1:1";
  referenceImages?: string[];
  loras?: { path: string; scale: number }[];
  postId: string;
  attempt: number;
}) {
  const input: Record<string, any> = {
    prompt: opts.prompt,
    num_images: 1,
    ...sizingParam(opts.model, opts.aspect ?? "9:16"),
  };
  if (opts.seed != null) input.seed = opts.seed;
  if (opts.referenceImages?.length) input.image_urls = opts.referenceImages;
  if (opts.loras?.length) input.loras = opts.loras;

  const base = (process.env.PUBLIC_URL ?? "").trim().replace(/\/$/, "");
  const secret = (process.env.CRON_SECRET ?? "").trim();

  const { request_id } = await fal.queue.submit(opts.model, {
    input,
    webhookUrl: `${base}/api/fal/webhook?post=${opts.postId}&attempt=${opts.attempt}&token=${encodeURIComponent(secret)}`,
  });
  return request_id;
}

export async function fetchResult(model: string, requestId: string) {
  const r: any = await fal.queue.result(model, { requestId });
  return r?.data?.images?.[0]?.url as string | undefined;
}

/**
 * Kicks off LoRA training (Phase 3). Costs real money on the fal.ai account
 * (~$2-5/run) -- only ever called from a human-initiated "Start training"
 * request, never automatically.
 */
export async function submitTraining(opts: {
  zipUrl: string;
  triggerWord: string;
  steps: number;
  isStyle: boolean;
  loraModelId: string;
}) {
  const base = (process.env.PUBLIC_URL ?? "").trim().replace(/\/$/, "");
  const secret = (process.env.CRON_SECRET ?? "").trim();

  const { request_id } = await fal.queue.submit(TRAINING_MODEL, {
    input: {
      images_data_url: opts.zipUrl,
      trigger_word: opts.triggerWord,
      steps: opts.steps,
      is_style: opts.isStyle,
      create_masks: !opts.isStyle,
    },
    webhookUrl: `${base}/api/lora/webhook?run=${opts.loraModelId}&token=${encodeURIComponent(secret)}`,
  });
  return request_id;
}

export async function uploadDataset(zip: Buffer, filename: string): Promise<string> {
  const file = new File([new Uint8Array(zip)], filename, { type: "application/zip" });
  return fal.storage.upload(file);
}
