"use client";
import { useRef, useState } from "react";

type TrainingImage = {
  id: string; variant: string; url: string; caption: string | null;
  source: "approved_post" | "uploaded_reference"; included: boolean; created_at: string;
};
type LoraModel = {
  id: string; variant: string; version: number;
  status: "draft" | "training" | "ready" | "failed";
  weight_url: string | null; trigger_token: string; training_image_count: number | null;
  scale: number; is_active: boolean; notes: string | null; trained_at: string | null;
  steps: number | null; is_style: boolean; created_at: string;
};

const MIN_IMAGES = 10;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function StatusBadge({ status }: { status: LoraModel["status"] }) {
  return <span className={`lora-status lora-status-${status}`}>{status}</span>;
}

function VariantLoraPanel({
  variant, initialImages, initialModels,
}: {
  variant: "dark" | "light"; initialImages: TrainingImage[]; initialModels: LoraModel[];
}) {
  const [images, setImages] = useState<TrainingImage[]>(initialImages);
  const [models, setModels] = useState<LoraModel[]>(initialModels);
  const [promoting, setPromoting] = useState(false);
  const [promoteStatus, setPromoteStatus] = useState("");
  const [captioning, setCaptioning] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [triggerWord, setTriggerWord] = useState(`apex${variant}`);
  const [steps, setSteps] = useState(1000);
  const [isStyle, setIsStyle] = useState(true);
  const [training, setTraining] = useState(false);
  const [trainError, setTrainError] = useState("");

  const includedImages = images.filter(i => i.included);
  const missingCaptions = includedImages.filter(i => !i.caption).length;
  const hasTrainingInFlight = models.some(m => m.status === "training");

  async function handlePromote() {
    setPromoting(true);
    setPromoteStatus("");
    try {
      const r = await fetch("/api/training-images/promote", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variant }),
      });
      const data = await r.json();
      if (data.ok) {
        setImages(prev => [...(data.images ?? []), ...prev]);
        setPromoteStatus(data.added > 0 ? `Added ${data.added} approved post(s).` : "No new approved posts to add.");
      } else {
        setPromoteStatus(data.error ?? "Failed to sync.");
      }
    } catch {
      setPromoteStatus("Network error — try again.");
    }
    setPromoting(false);
  }

  async function toggleIncluded(id: string, included: boolean) {
    setImages(prev => prev.map(i => (i.id === id ? { ...i, included } : i)));
    await fetch("/api/training-images/update", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, included }),
    });
  }

  async function saveCaption(id: string, caption: string) {
    setImages(prev => prev.map(i => (i.id === id ? { ...i, caption } : i)));
    await fetch("/api/training-images/update", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, caption }),
    });
  }

  async function removeImage(id: string) {
    setImages(prev => prev.filter(i => i.id !== id));
    await fetch("/api/training-images/delete", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
  }

  async function handleAutoCaption() {
    setCaptioning(true);
    try {
      const r = await fetch("/api/training-images/auto-caption", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variant }),
      });
      const data = await r.json();
      if (data.ok) {
        // Refetch is overkill for a handful of rows — reload page state via a light GET is not wired,
        // so just clear the "missing" ones we know were attempted by re-running promote-free sync:
        // simplest correct approach is a full reload of this panel's data.
        window.location.reload();
      }
    } catch { /* leave captions as-is, user can retry */ }
    setCaptioning(false);
  }

  async function uploadFiles(files: File[]) {
    const imgFiles = files.filter(f => f.type.startsWith("image/"));
    if (!imgFiles.length) return;
    for (let i = 0; i < imgFiles.length; i++) {
      setUploadProgress(`Uploading ${i + 1} of ${imgFiles.length}…`);
      try {
        const b64 = await fileToBase64(imgFiles[i]);
        const r = await fetch("/api/training-images/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variant, filename: imgFiles[i].name, contentType: imgFiles[i].type, data: b64 }),
        });
        const data = await r.json();
        if (data.ok && data.image) setImages(prev => [data.image, ...prev]);
      } catch { /* skip this file, continue with the rest */ }
    }
    setUploadProgress("");
  }

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    await uploadFiles(Array.from(e.target.files || []));
    e.target.value = "";
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    await uploadFiles(Array.from(e.dataTransfer.files || []));
  }

  async function handleTrain() {
    setTraining(true);
    setTrainError("");
    try {
      const r = await fetch("/api/lora/train", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant, triggerWord, steps, isStyle }),
      });
      const data = await r.json();
      if (data.ok) {
        setModels(prev => [{
          id: data.id, variant, version: data.version, status: "training", weight_url: null,
          trigger_token: triggerWord, training_image_count: data.image_count, scale: 0.9,
          is_active: false, notes: null, trained_at: null, steps, is_style: isStyle,
          created_at: new Date().toISOString(),
        }, ...prev]);
      } else {
        setTrainError(data.error ?? "Failed to start training.");
      }
    } catch {
      setTrainError("Network error — try again.");
    }
    setTraining(false);
  }

  async function updateModel(id: string, patch: Record<string, any>) {
    setModels(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));
    await fetch("/api/lora/update", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }),
    });
  }

  async function setActive(id: string, active: boolean) {
    const r = await fetch("/api/lora/update", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, is_active: active }),
    });
    const data = await r.json();
    if (!data.ok) { alert(data.error ?? "Failed to update."); return; }
    setModels(prev => prev.map(m => (m.id === id ? { ...m, is_active: active } : (active && m.variant === variant ? { ...m, is_active: false } : m))));
  }

  return (
    <div className="brand-section">
      <div className="brand-section-title">{variant} variant</div>
      <div className="brand-section-sub">
        When a ready, active LoRA exists for this variant, new posts route through it automatically — reference-image editing is the fallback, base-model generation after that.
      </div>

      <div className="ref-header-row">
        <label className="field-label" style={{ marginBottom: 0 }}>
          Training candidates{images.length > 0 ? ` (${images.length}, ${includedImages.length} included)` : ""}
        </label>
        <div className="ref-header-actions">
          <button className="analyze-btn" disabled={promoting} onClick={handlePromote}>
            {promoting ? "Syncing…" : "Sync approved posts"}
          </button>
          <button className="analyze-btn" disabled={captioning || missingCaptions === 0} onClick={handleAutoCaption}>
            {captioning ? "Captioning…" : `Auto-caption (${missingCaptions} missing)`}
          </button>
        </div>
      </div>
      {promoteStatus && <p className="upload-progress">{promoteStatus}</p>}

      {images.length === 0 && (
        <p className="ref-empty">No candidates yet. "Sync approved posts" pulls in every post that already passed the critic and got human approval — the highest-signal data available. You can also upload photos directly below.</p>
      )}
      {images.length > 0 && (
        <div className="train-grid">
          {images.map(img => (
            <div className={`train-thumb${img.included ? "" : " excluded"}`} key={img.id}>
              <img src={img.url} alt="" />
              <label className="train-toggle" title={img.included ? "Included in training set" : "Excluded"}>
                <input type="checkbox" checked={img.included} onChange={e => toggleIncluded(img.id, e.target.checked)} />
              </label>
              <button className="train-remove" onClick={() => removeImage(img.id)} aria-label="Remove">×</button>
              <input
                className="train-caption-input"
                placeholder="caption…"
                defaultValue={img.caption ?? ""}
                onBlur={e => { if (e.target.value !== (img.caption ?? "")) saveCaption(img.id, e.target.value); }}
              />
              <span className="train-source">{img.source === "approved_post" ? "post" : "upload"}</span>
            </div>
          ))}
        </div>
      )}

      {uploadProgress && <p className="upload-progress">{uploadProgress}</p>}

      <div
        className={`dropzone${dragOver ? " drag-over" : ""}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {dragOver ? "Drop to upload" : "+ Drop photos here, or click to browse"}
        <div className="dropzone-sub">Adds directly to the training candidate pool</div>
        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePick} />
      </div>

      <div style={{ height: 22 }} />

      <div className="lora-train-box">
        <div className="proposal-title">Train a new LoRA</div>
        <p className="ref-empty" style={{ marginBottom: 12 }}>
          Needs at least {MIN_IMAGES} included images ({includedImages.length} currently included). Costs roughly $2–5 on the fal.ai account per run — this is a real charge, not a preview.
        </p>
        <div className="lora-settings-grid">
          <div className="text-field">
            <label>Trigger word</label>
            <input type="text" value={triggerWord} onChange={e => setTriggerWord(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))} />
          </div>
          <div className="text-field">
            <label>Steps</label>
            <input type="number" min={200} max={4000} step={100} value={steps} onChange={e => setSteps(Number(e.target.value))} />
          </div>
          <div className="text-field">
            <label>Training mode</label>
            <label className="lora-checkbox-row">
              <input type="checkbox" checked={isStyle} onChange={e => setIsStyle(e.target.checked)} />
              Style LoRA (recommended for a brand look, not a specific subject)
            </label>
          </div>
        </div>
        <div className="save-row">
          <button
            className="save-btn"
            disabled={training || hasTrainingInFlight || includedImages.length < MIN_IMAGES}
            onClick={handleTrain}
            title={includedImages.length < MIN_IMAGES ? `Need at least ${MIN_IMAGES} included images` : hasTrainingInFlight ? "A training run is already in flight for this variant" : undefined}
          >
            {training ? "Starting…" : hasTrainingInFlight ? "Training in progress…" : "Start training"}
          </button>
          {trainError && <span className="save-status" style={{ color: "#e0685b" }}>{trainError}</span>}
        </div>
      </div>

      <div style={{ height: 22 }} />

      <div className="proposal-title" style={{ marginBottom: 10 }}>LoRA models</div>
      {models.length === 0 && <p className="ref-empty">No LoRA trained yet for this variant.</p>}
      {models.length > 0 && (
        <div className="lora-registry">
          {models.map(m => (
            <div className="lora-row" key={m.id}>
              <div className="lora-row-top">
                <span className="lora-version">v{m.version}</span>
                <StatusBadge status={m.status} />
                {m.is_active && <span className="lora-status lora-status-active">active</span>}
                <span className="lora-meta">{m.training_image_count ?? "—"} images · {m.steps ?? "—"} steps · {m.trigger_token}</span>
              </div>
              {m.status === "failed" && m.notes && <p className="upload-progress" style={{ color: "#e0685b" }}>{m.notes}</p>}
              {m.status === "ready" && (
                <div className="lora-row-controls">
                  <label className="lora-scale-field">
                    Scale
                    <input
                      type="number" min={0.1} max={1.5} step={0.05} defaultValue={m.scale}
                      onBlur={e => { const v = Number(e.target.value); if (v !== m.scale) updateModel(m.id, { scale: v }); }}
                    />
                  </label>
                  <button
                    className={m.is_active ? "clear-refs-btn" : "analyze-btn"}
                    onClick={() => setActive(m.id, !m.is_active)}
                  >
                    {m.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LoraClient({
  images, models,
}: {
  images: Record<string, any[]>; models: Record<string, any[]>;
}) {
  return (
    <>
      <VariantLoraPanel variant="light" initialImages={images.light ?? []} initialModels={models.light ?? []} />
      <VariantLoraPanel variant="dark" initialImages={images.dark ?? []} initialModels={models.dark ?? []} />
    </>
  );
}
