import { useState } from "react";
import { CopyButton } from "./CopyButton.js";
import { buildExternalPromptTemplate, parseAndNormalizeImport, type WrittenContentKind } from "./importExport.js";
import type { StudioProject } from "./types.js";

interface JsonImportExportProps {
  project: StudioProject;
  onPatch: (patch: Partial<StudioProject>) => void;
}

const CONTENT_KINDS: Array<{ id: WrittenContentKind; label: string }> = [
  { id: "poem", label: "Poem / lyrics" },
  { id: "storyline", label: "Storyline" },
  { id: "script", label: "Script" },
  { id: "none", label: "None (scenes only)" },
];

// A round trip through any chat AI: copy a ready made prompt out, paste whatever JSON comes back
// in — this never depends on this app's own generate endpoint or a particular LLM provider.
export function JsonImportExport({ project, onPatch }: JsonImportExportProps) {
  const [topic, setTopic] = useState("");
  const [numScenesText, setNumScenesText] = useState(String(project.scenes.length || 8));
  const [style, setStyle] = useState(project.style ?? "");
  const [lang, setLang] = useState(project.languages[0] ?? "en");
  const [ownAudio, setOwnAudio] = useState(false);
  const [contentKind, setContentKind] = useState<WrittenContentKind>("poem");
  const [extra, setExtra] = useState("");

  const [pasteText, setPasteText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  function commitNumScenes() {
    const parsed = Math.round(Number(numScenesText));
    const clamped = Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.min(30, parsed)) : 8;
    setNumScenesText(String(clamped));
    return clamped;
  }

  const template = buildExternalPromptTemplate({
    topic,
    numScenes: Number(numScenesText) || 8,
    style,
    lang,
    ownAudio,
    extra,
    videoType: project.videoType,
    aspectRatio: project.aspectRatio,
    contentKind,
  });

  function handleImport() {
    setImportError(null);
    setImportedCount(null);
    try {
      const parsed = parseAndNormalizeImport(pasteText, project);
      const patch: Partial<StudioProject> = {
        scenes: parsed.scenes,
        accounts: parsed.accounts,
        namingConvention: `scene_01 to scene_${String(parsed.scenes.length).padStart(2, "0")}`,
      };
      if (parsed.poem) patch.poem = { ...project.poem, ...parsed.poem };
      if (parsed.concept !== undefined) patch.concept = parsed.concept;
      if (parsed.hook !== undefined) patch.hook = parsed.hook;
      if (parsed.masterPrompt !== undefined) patch.masterPrompt = parsed.masterPrompt;
      if (parsed.caption !== undefined) patch.caption = parsed.caption;
      if (parsed.hashtags !== undefined) patch.hashtags = parsed.hashtags;

      onPatch(patch);
      setImportedCount(parsed.scenes.length);
      setPasteText("");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="prompt-studio-section">
      <h2>Use any AI chat</h2>
      <p className="hint">
        Copy a ready made prompt into Claude, ChatGPT, or any other chat, then paste back whatever JSON it gives you — it
        fills in the written content, master prompt, and every scene in one go. Works just as well with a JSON blob you
        already have from anywhere else.
      </p>

      <div className="inline-fields prompt-studio-header-row">
        <label className="field prompt-studio-topic-field">
          <span>Topic</span>
          <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What is this video about?" />
        </label>
        <label className="field">
          <span>Number of scenes</span>
          <input
            type="number"
            min={1}
            max={30}
            inputMode="numeric"
            value={numScenesText}
            onChange={(e) => setNumScenesText(e.target.value)}
            onBlur={commitNumScenes}
          />
        </label>
        <label className="field">
          <span>Language</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {project.languages.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="inline-fields prompt-studio-header-row">
        <label className="field">
          <span>Style</span>
          <input type="text" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="cinematic, warm film grade" />
        </label>
        <label className="field">
          <span>Written content</span>
          <select value={contentKind} onChange={(e) => setContentKind(e.target.value as WrittenContentKind)}>
            {CONTENT_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field checkbox-field">
          <span>Generate its own audio</span>
          <input type="checkbox" checked={!ownAudio} onChange={(e) => setOwnAudio(!e.target.checked)} />
        </label>
      </div>

      <label className="field">
        <span>Extra direction (optional)</span>
        <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Anything else the AI should know" />
      </label>

      <label className="field">
        <span>Prompt to copy into any AI chat</span>
        <textarea rows={8} readOnly value={template} />
      </label>
      <div className="inline-fields prompt-studio-master-actions">
        <CopyButton text={template} label="Copy prompt" />
      </div>

      <label className="field">
        <span>Paste the JSON it gives you back</span>
        <textarea
          rows={8}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder='{"masterPrompt": "...", "scenes": [...] } — or a full project JSON from anywhere'
        />
      </label>
      <div className="inline-fields">
        <button type="button" onClick={handleImport} disabled={!pasteText.trim()}>
          Import JSON
        </button>
        {importedCount !== null && <span className="prompt-studio-progress-label">Imported {importedCount} scene(s)</span>}
      </div>
      {importError && <p className="export-error">{importError}</p>}
    </section>
  );
}
