"use client";
import { useState, useRef, useCallback } from "react";

type Palette = {
  base?: string; base_hex?: string; surface_hex?: string; text_hex?: string;
  text_secondary_hex?: string; accent?: string; accent_hex?: string;
  accent_count_max?: number; semantic_colors?: string; base_hue_range?: [number, number];
};
type RefImage = { id: string; url: string; label?: string | null };
type Proposal = {
  palette: Palette;
  lighting_law: { sources: number; hardness?: string; min_shadow_ratio: number; haze: boolean };
  subject_law: { faces_allowed: boolean; body_treatment: string[]; note?: string };
  prompt_suffix: string;
  rationale: string;
};

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <div className="color-field">
      <label>{label}</label>
      <div className="color-swatch-row">
        <input type="color" value={safe} onChange={e => onChange(e.target.value)} />
        <input type="text" value={value} onChange={e => onChange(e.target.value)} spellCheck={false} />
      </div>
    </div>
  );
}

/**
 * Reads File objects out of a DataTransfer, including whole dropped FOLDERS via
 * the webkitGetAsEntry directory-reader API (recursive). Falls back to the flat
 * file list for browsers without folder-drop support.
 */
async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items || []);
  const hasEntryApi = items.length > 0 && typeof (items[0] as any).webkitGetAsEntry === "function";
  if (!hasEntryApi) return Array.from(dt.files || []).filter(f => f.type.startsWith("image/"));

  const out: File[] = [];
  async function walk(entry: any): Promise<void> {
    if (!entry) return;
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej));
      if (file.type.startsWith("image/")) out.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const e of entries) await walk(e);
    }
  }
  for (const item of items) {
    const entry = (item as any).webkitGetAsEntry?.();
    if (entry) await walk(entry);
  }
  return out;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function VariantPanel({
  variant, initialPalette, initialRefs,
}: {
  variant: "dark" | "light"; initialPalette: Palette; initialRefs: RefImage[];
}) {
  const [palette, setPalette] = useState<Palette>(initialPalette);
  const [refs, setRefs] = useState<RefImage[]>(initialRefs);
  const [savingColors, setSavingColors] = useState(false);
  const [colorStatus, setColorStatus] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [applying, setApplying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof Palette>(key: K, val: Palette[K]) {
    setPalette(p => ({ ...p, [key]: val }));
  }

  async function saveColors() {
    setSavingColors(true);
    setColorStatus("");
    try {
      const r = await fetch("/api/brand-settings/colors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant, palette }),
      });
      const data = await r.json();
      setColorStatus(data.ok ? "Saved — used on the next generation." : (data.error ?? "Failed to save."));
    } catch {
      setColorStatus("Network error — try again.");
    }
    setSavingColors(false);
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    for (let i = 0; i < files.length; i++) {
      setUploadProgress(`Uploading ${i + 1} of ${files.length}…`);
      try {
        const b64 = await fileToBase64(files[i]);
        const r = await fetch("/api/references/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variant, filename: files[i].name, contentType: files[i].type, data: b64 }),
        });
        const data = await r.json();
        if (data.ok && data.image) setRefs(prev => [data.image, ...prev]);
      } catch { /* skip this file, continue with the rest */ }
    }
    setUploadProgress("");
  }

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith("image/"));
    await uploadFiles(files);
    e.target.value = "";
  }

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = await filesFromDataTransfer(e.dataTransfer);
    await uploadFiles(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  async function handleDelete(id: string) {
    setRefs(prev => prev.filter(r => r.id !== id));
    await fetch("/api/references/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  /**
   * Clearing stops runtime conditioning immediately: with zero references,
   * pickModel() falls back off the edit endpoint. Any analysis already applied
   * to the constitution is unaffected.
   */
  async function handleClearAll() {
    if (!refs.length) return;
    if (!window.confirm(`Clear all ${refs.length} reference photo(s) for the ${variant} variant? Future generations will stop using them as guidance immediately.`)) return;
    setClearing(true);
    const ids = refs.map(r => r.id);
    setRefs([]);
    setProposal(null);
    await fetch("/api/references/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant, ids }),
    });
    setClearing(false);
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalyzeError("");
    setProposal(null);
    try {
      const r = await fetch("/api/brand-settings/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant }),
      });
      // A killed function returns a raw connection failure, not clean JSON —
      // check status before parsing so timeouts report accurately.
      if (!r.ok) {
        let msg = `Server error (${r.status}) — try again.`;
        if (r.status === 504 || r.status === 408) msg = "Analysis timed out — try again, it usually succeeds on retry.";
        else {
          try { const j = await r.json(); if (j?.error) msg = j.error; } catch { /* keep default */ }
        }
        setAnalyzeError(msg);
        setAnalyzing(false);
        return;
      }
      const data = await r.json();
      if (data.ok) setProposal(data.proposal);
      else setAnalyzeError(data.error ?? "Analysis failed.");
    } catch {
      setAnalyzeError("Request timed out or the connection dropped — try again.");
    }
    setAnalyzing(false);
  }

  async function handleApplyProposal() {
    if (!proposal) return;
    setApplying(true);
    try {
      const r = await fetch("/api/brand-settings/apply-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant, proposal }),
      });
      const data = await r.json();
      if (data.ok) {
        setPalette(p => ({ ...p, ...proposal.palette }));
        setColorStatus("Applied from photo analysis — written permanently into the constitution.");
        setProposal(null);
      } else {
        setAnalyzeError(data.error ?? "Failed to apply.");
      }
    } catch {
      setAnalyzeError("Network error — try again.");
    }
    setApplying(false);
  }

  return (
    <div className="brand-section">
      <div className="brand-section-title">{variant} variant</div>
      <div className="brand-section-sub">
        {variant === "dark"
          ? "Original anonymous/moody identity. Faces never permitted."
          : "Light, clean identity — currently the primary look, weighted 80% of generations."}
      </div>

      <div className="color-grid">
        <ColorField label="Base" value={palette.base_hex ?? ""} onChange={v => set("base_hex", v)} />
        <ColorField label="Surface" value={palette.surface_hex ?? ""} onChange={v => set("surface_hex", v)} />
        <ColorField label="Text" value={palette.text_hex ?? ""} onChange={v => set("text_hex", v)} />
        <ColorField label="Text secondary" value={palette.text_secondary_hex ?? ""} onChange={v => set("text_secondary_hex", v)} />
        <ColorField label="Accent" value={palette.accent_hex ?? ""} onChange={v => set("accent_hex", v)} />
      </div>

      <div className="text-field">
        <label>Base description (how the AI/critic refer to it, e.g. "warm near-black")</label>
        <input type="text" value={palette.base ?? ""} onChange={e => set("base", e.target.value)} />
      </div>
      <div className="text-field">
        <label>Accent name (e.g. "desaturated brick-red")</label>
        <input type="text" value={palette.accent ?? ""} onChange={e => set("accent", e.target.value)} />
      </div>

      <div className="save-row">
        <button className="save-btn" disabled={savingColors} onClick={saveColors}>
          {savingColors ? "Saving…" : "Save colors"}
        </button>
        {colorStatus && <span className="save-status">{colorStatus}</span>}
      </div>

      <div style={{ height: 22 }} />

      <div className="ref-header-row">
        <label className="field-label" style={{ marginBottom: 0 }}>Reference photos{refs.length > 0 ? ` (${refs.length})` : ""}</label>
        <div className="ref-header-actions">
          <button className="analyze-btn" disabled={!refs.length || analyzing} onClick={handleAnalyze} title={!refs.length ? "Upload reference photos first" : undefined}>
            {analyzing ? "Analyzing… (up to ~50s)" : "Analyze reference photos"}
          </button>
          <button className="clear-refs-btn" disabled={!refs.length || clearing} onClick={handleClearAll}>
            {clearing ? "Clearing…" : "Clear all"}
          </button>
        </div>
      </div>

      {refs.length === 0 && (
        <p className="ref-empty">None yet — uploading images here routes generation through the model's edit endpoint, using these as style/composition guidance on every generation. Once you have some, "Analyze reference photos" distills them into permanent palette/lighting/subject rules — that analysis happens once and sticks, independent of whether you keep the raw photos uploaded.</p>
      )}
      {refs.length > 0 && (
        <div className="ref-grid">
          {refs.map(r => (
            <div className="ref-thumb" key={r.id}>
              <img src={r.url} alt="" />
              <button onClick={() => handleDelete(r.id)} aria-label="Remove">×</button>
            </div>
          ))}
        </div>
      )}

      {uploadProgress && <p className="upload-progress">{uploadProgress}</p>}
      {analyzeError && <p className="upload-progress" style={{ color: "#e0685b" }}>{analyzeError}</p>}

      {proposal && (
        <div className="proposal-box">
          <div className="proposal-title">Proposed changes from recent reference photos</div>

          <div className="proposal-row">
            <dt>Palette</dt>
            <dd>
              <div className="proposal-swatches">
                {[proposal.palette.base_hex, proposal.palette.surface_hex, proposal.palette.text_hex, proposal.palette.accent_hex].filter(Boolean).map((hex, i) => (
                  <div className="proposal-swatch" key={i} style={{ background: hex }} title={hex} />
                ))}
              </div>
              <div style={{ marginTop: 4 }}>{proposal.palette.base}{proposal.palette.accent ? ` · accent: ${proposal.palette.accent}` : ""}</div>
            </dd>
          </div>

          <div className="proposal-row">
            <dt>Lighting</dt>
            <dd>{proposal.lighting_law.sources} source(s), min {Math.round(proposal.lighting_law.min_shadow_ratio * 100)}% shadow, haze {proposal.lighting_law.haze ? "visible" : "none"}</dd>
          </div>

          <div className="proposal-row">
            <dt>Subject</dt>
            <dd>{proposal.subject_law.faces_allowed ? "Faces allowed" : "No faces"} — {proposal.subject_law.body_treatment?.join(", ")}</dd>
          </div>

          <div className="proposal-row">
            <dt>Prompt suffix</dt>
            <dd>{proposal.prompt_suffix}</dd>
          </div>

          <div className="proposal-rationale">{proposal.rationale}</div>

          <div className="proposal-actions">
            <button className="dismiss-btn" disabled={applying} onClick={() => setProposal(null)}>Dismiss</button>
            <button className="apply-btn" disabled={applying} onClick={handleApplyProposal}>
              {applying ? "Applying…" : "Apply to constitution"}
            </button>
          </div>
        </div>
      )}

      <div
        className={`dropzone${dragOver ? " drag-over" : ""}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {dragOver ? "Drop to upload" : "+ Drop photos or a whole folder here, or click to browse"}
        <div className="dropzone-sub">Accepts multiple files and folders at once</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handlePick}
        />
      </div>
    </div>
  );
}

export default function BrandSettingsClient({
  palettes, references,
}: {
  palettes: Record<string, any>; references: Record<string, any[]>;
}) {
  return (
    <>
      <VariantPanel variant="light" initialPalette={palettes.light ?? {}} initialRefs={references.light ?? []} />
      <VariantPanel variant="dark" initialPalette={palettes.dark ?? {}} initialRefs={references.dark ?? []} />
    </>
  );
}
