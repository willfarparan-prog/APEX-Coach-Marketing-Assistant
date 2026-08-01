import { fal } from "@fal-ai/client";

fal.config({ credentials: process.env.FAL_KEY! });

/**
 * Model routing, transcribed from playbook §5.
 * Higgsfield is a front-end over these same engines — we call them directly
 * so the pipeline can run headless. Seedream is banned by the constitution.
 */
export const ROUTE = {
  backplate: "fal-ai/flux-2-pro",        // batch. Best prompt adherence for long constraint-heavy prompts.
  hero: "fal-ai/nano-banana-pro",        // heroes / anything with ad spend behind it
  composite: "fal-ai/nano-banana-pro/edit", // "place this exact screen, unaltered, on the phone in frame"
  motion: "fal-ai/kling-video/v3/pro/image-to-video",
} as const;

export type Route = keyof typeof ROUTE;

const COST: Record<string, number> = {
  "fal-ai/flux-2-pro": 0.04,
  "fal-ai/nano-banana-pro": 0.08,
  "fal-ai/nano-banana-pro/edit": 0.08,
};

export function estimateCost(model: string) {
  return COST[model] ?? 0.1;
}

/**
 * Async submit. Generation runs on fal's queue and calls us back — no
 * long-running serverless function, no polling loop to time out.
 */
export async function submitImage(opts: {
  model: string;
  prompt: string;
  seed?: number;
  aspect?: "9:16" | "4:5" | "1:1";
  referenceImages?: string[];   // for the /edit route — real APEX screenshots
  postId: string;
  attempt: number;
}) {
  const input: Record<string, any> = {
    prompt: opts.prompt,
    // §6: always generate 9:16 and crop up, never the reverse
    aspect_ratio: opts.aspect ?? "9:16",
    num_images: 1,
  };
  if (opts.seed != null) input.seed = opts.seed;
  if (opts.referenceImages?.length) input.image_urls = opts.referenceImages;

  const { request_id } = await fal.queue.submit(opts.model, {
    input,
    webhookUrl: `${process.env.PUBLIC_URL}/api/fal/webhook?post=${opts.postId}&attempt=${opts.attempt}&token=${process.env.CRON_SECRET}`,
  });
  return request_id;
}

export async function fetchResult(model: string, requestId: string) {
  const r: any = await fal.queue.result(model, { requestId });
  return r?.data?.images?.[0]?.url as string | undefined;
}
