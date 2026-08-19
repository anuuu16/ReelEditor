import { useEffect, useState, type ChangeEvent, type MouseEvent } from "react";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { OVERLAY_TRACK_ID } from "../state/initialProject.js";
import { MAX_IMAGE_CLIP_DURATION_SECONDS } from "../media/trackAccepts.js";
import { saveMediaBlob } from "../persistence/db.js";
import {
  clearBrandLogo,
  loadBrandKit,
  loadBrandLogoBlob,
  saveBrandKit,
  saveBrandLogo,
  type BrandKit,
} from "../persistence/brandKit.js";

const DEFAULT_LOGO_DURATION_SECONDS = 5;

export function BrandKitPanel() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [isOpen, setIsOpen] = useState(false);
  const [kit, setKit] = useState<BrandKit>(() => loadBrandKit());
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    loadBrandLogoBlob().then((blob) => {
      if (!cancelled && blob) setLogoPreviewUrl(URL.createObjectURL(blob));
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  function openPanel() {
    setKit(loadBrandKit());
    setIsOpen(true);
  }

  function stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  function updateKit(patch: Partial<BrandKit>) {
    const next = { ...kit, ...patch };
    setKit(next);
    saveBrandKit(next);
  }

  async function handleLogoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await saveBrandLogo(file);
    setKit(loadBrandKit());
    setLogoPreviewUrl(URL.createObjectURL(file));
  }

  async function handleRemoveLogo() {
    await clearBrandLogo();
    setKit(loadBrandKit());
    setLogoPreviewUrl(null);
  }

  async function handleAddLogoToProject() {
    const blob = await loadBrandLogoBlob();
    if (!blob) return;
    const sourceId = crypto.randomUUID();
    await saveMediaBlob(sourceId, blob);
    const previewUrl = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      dispatch({
        type: "ADD_SOURCE",
        source: {
          id: sourceId,
          name: "Brand logo",
          filePath: "",
          previewUrl,
          durationSeconds: MAX_IMAGE_CLIP_DURATION_SECONDS,
          width: img.naturalWidth,
          height: img.naturalHeight,
          kind: "image",
          isPlaceholder: false,
        },
      });
      dispatch({
        type: "ADD_IMAGE_OVERLAY",
        trackId: OVERLAY_TRACK_ID,
        sourceId,
        start: state.playhead,
        end: state.playhead + DEFAULT_LOGO_DURATION_SECONDS,
      });
      setIsOpen(false);
    };
    img.src = previewUrl;
  }

  if (!isOpen) {
    return (
      <button type="button" className="add-title-button" onClick={openPanel}>
        Brand kit
      </button>
    );
  }

  return (
    <div className="export-overlay" onClick={() => setIsOpen(false)}>
      <div className="export-panel" onClick={stopPropagation}>
        <button type="button" className="export-close" onClick={() => setIsOpen(false)} title="Close">
          ×
        </button>
        <h2>Brand kit</h2>
        <p className="hint">Saved once, available in every project — colors for titles and a logo you can drop in with one click.</p>

        <label className="field">
          <span>Primary color</span>
          <input type="color" value={kit.primaryColor} onChange={(e) => updateKit({ primaryColor: e.target.value })} />
        </label>

        <label className="field">
          <span>Secondary color</span>
          <input type="color" value={kit.secondaryColor} onChange={(e) => updateKit({ secondaryColor: e.target.value })} />
        </label>

        <div className="field">
          <span>Logo</span>
          {logoPreviewUrl && (
            <div className="clip-preview-thumb brand-kit-logo-preview">
              <img src={logoPreviewUrl} alt="" />
            </div>
          )}
          <div className="inline-fields">
            <label className="import-button brand-kit-upload">
              {kit.hasLogo ? "Replace logo" : "Upload logo"}
              <input type="file" accept="image/*" hidden onChange={handleLogoFile} />
            </label>
            {kit.hasLogo && (
              <button type="button" onClick={handleRemoveLogo}>
                Remove
              </button>
            )}
          </div>
        </div>

        {kit.hasLogo && (
          <button type="button" onClick={handleAddLogoToProject}>
            Add logo to this project
          </button>
        )}
      </div>
    </div>
  );
}
