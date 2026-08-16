import { db } from "@/lib/core";
import LoraClient from "./LoraClient";

export const dynamic = "force-dynamic";

export default async function Lora() {
  const [{ data: images }, { data: models }] = await Promise.all([
    db.from("training_images").select("id, variant, url, caption, source, included, created_at").order("created_at", { ascending: false }),
    db.from("lora_models").select("id, variant, version, status, weight_url, trigger_token, training_image_count, scale, is_active, notes, trained_at, steps, is_style, created_at").order("version", { ascending: false }),
  ]);

  const imagesByVariant: Record<string, any[]> = { dark: [], light: [] };
  for (const r of images ?? []) imagesByVariant[(r as any).variant]?.push(r);

  const modelsByVariant: Record<string, any[]> = { dark: [], light: [] };
  for (const r of models ?? []) modelsByVariant[(r as any).variant]?.push(r);

  return (
    <main className="wrap wide">
      <nav className="top-nav"><a href="/review">Review</a><a href="/post-queue">Post Queue</a><a href="/gallery">Gallery</a><a href="/brand-settings">Brand Settings</a><a href="/lora">LoRA</a></nav>
      <header className="masthead">
        <span className="mark">APEX Engine — LoRA Training</span>
      </header>
      <LoraClient images={imagesByVariant} models={modelsByVariant} />
    </main>
  );
}
