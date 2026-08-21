import { useState } from "react";
import { CopyButton } from "./CopyButton.js";
import { buildExternalPromptTemplate, parseAndNormalizeImport, type WrittenContentKind } from "./importExport.js";
import type { StudioProject } from "./types.js";
import { Button, Card, NumberField, SelectField, TextField, TextareaField } from "./ui/index.js";

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
  const [numScenes, setNumScenes] = useState(project.scenes.length || 8);
  const [style, setStyle] = useState(project.style ?? "");
  const [lang, setLang] = useState(project.languages[0] ?? "en");
  const [ownAudio, setOwnAudio] = useState(false);
  const [contentKind, setContentKind] = useState<WrittenContentKind>("poem");
  const [extra, setExtra] = useState("");

  const [pasteText, setPasteText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  const template = buildExternalPromptTemplate({
    topic,
    numScenes,
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
    <Card
      title="Use any AI chat"
      hint="Copy a ready made prompt into Claude, ChatGPT, or any other chat, then paste back whatever JSON it gives you — it fills in the written content, master prompt, and every scene in one go. Works just as well with a JSON blob you already have from anywhere else."
    >
      <div className="mb-3.5 flex flex-wrap gap-3">
        <TextField
          label="Topic"
          value={topic}
          onChange={setTopic}
          placeholder="What is this video about?"
          className="min-w-[220px] flex-[2]"
        />
        <NumberField label="Number of scenes" value={numScenes} onChange={setNumScenes} min={1} max={30} className="min-w-[160px] flex-1" />
        <SelectField
          label="Language"
          value={lang}
          onChange={setLang}
          options={project.languages.map((l) => ({ value: l, label: l }))}
          className="min-w-[160px] flex-1"
        />
      </div>

      <div className="mb-3.5 flex flex-wrap items-end gap-3">
        <TextField label="Style" value={style} onChange={setStyle} placeholder="cinematic, warm film grade" className="min-w-[180px] flex-1" />
        <SelectField
          label="Written content"
          value={contentKind}
          onChange={(value) => setContentKind(value as WrittenContentKind)}
          options={CONTENT_KINDS.map((k) => ({ value: k.id, label: k.label }))}
          className="min-w-[180px] flex-1"
        />
        <label className="flex min-w-[160px] flex-1 flex-row items-center gap-2 text-xs text-ps-muted">
          <input type="checkbox" checked={!ownAudio} onChange={(e) => setOwnAudio(!e.target.checked)} />
          <span>Generate its own audio</span>
        </label>
      </div>

      <TextareaField
        label="Extra direction (optional)"
        rows={2}
        value={extra}
        onChange={setExtra}
        placeholder="Anything else the AI should know"
        className="mb-3.5"
      />

      <TextareaField label="Prompt to copy into any AI chat" rows={8} readOnly value={template} onChange={() => undefined} className="mb-2" />
      <div className="mb-3.5">
        <CopyButton text={template} label="Copy prompt" />
      </div>

      <TextareaField
        label="Paste the JSON it gives you back"
        rows={8}
        value={pasteText}
        onChange={setPasteText}
        placeholder='{"masterPrompt": "...", "scenes": [...] } — or a full project JSON from anywhere'
        className="mb-3.5"
      />

      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={handleImport} disabled={!pasteText.trim()}>
          Import JSON
        </Button>
        {importedCount !== null && <span className="text-xs text-ps-warning">Imported {importedCount} scene(s)</span>}
      </div>
      {importError && <p className="whitespace-pre-wrap text-xs text-ps-danger">{importError}</p>}
    </Card>
  );
}
