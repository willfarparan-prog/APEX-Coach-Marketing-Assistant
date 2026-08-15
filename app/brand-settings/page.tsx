import { db } from "@/lib/core";
import BrandSettingsClient from "./BrandSettingsClient";

export const dynamic = "force-dynamic";

export default async function BrandSettings() {
  const [{ data: constitutionRows }, { data: refs }] = await Promise.all([
    db.from("constitution").select("key, value, variant").eq("status", "active").in("key", ["palette"]),
    db.from("reference_images").select("id, variant, url, label, created_at").order("created_at", { ascending: false }),
  ]);

  const palettes: Record<string, any> = {};
  for (const r of constitutionRows ?? []) palettes[(r as any).variant] = (r as any).value;

  const references: Record<string, any[]> = { dark: [], light: [] };
  for (const r of refs ?? []) references[(r as any).variant]?.push(r);

  return (
    <main className="wrap wide">
      <nav className="top-nav"><a href="/review">Review</a><a href="/post-queue">Post Queue</a><a href="/gallery">Gallery</a><a href="/brand-settings">Brand Settings</a></nav>
      <header className="masthead">
        <span className="mark">APEX Engine — Brand Settings</span>
      </header>
      <BrandSettingsClient palettes={palettes} references={references} />
    </main>
  );
}
