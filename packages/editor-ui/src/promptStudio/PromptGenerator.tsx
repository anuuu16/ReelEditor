import { useEffect, useRef, useState } from "react";
import { studioGenerateUrl } from "./api.js";
import { CopyButton } from "./CopyButton.js";
import { streamStudioGenerate } from "./sse.js";
import type { StudioGenerateModel, StudioGenerateRequest, StudioProject, StudioScene } from "./types.js";
import { Button, Card, NumberField, SelectField, TextField, TextareaField } from "./ui/index.js";

interface PromptGeneratorProps {
  project: StudioProject;
  onPatch: (patch: Partial<StudioProject>) => void;
  onLocalUpdate: (patch: Partial<StudioProject>) => void;
  onRefresh: () => Promise<void>;
}

const MODELS: StudioGenerateModel[] = ["Veo 3.1 Lite", "Veo 3.1 Fast", "Veo 3.1 Quality"];

function isKnownModel(model: string): model is StudioGenerateModel {
  return (MODELS as string[]).includes(model);
}

// The generation form + the resulting master prompt/concept/hook/caption/hashtags. Every one of
// these fields is a plain editable control. Generating is a convenience that pre-fills them, it
// is never the only way to get text into them.
export function PromptGenerator({ project, onPatch, onLocalUpdate, onRefresh }: PromptGeneratorProps) {
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState(project.platform ?? "");
  const [numScenes, setNumScenes] = useState(project.scenes.length || 8);
  const [style, setStyle] = useState(project.style ?? "");
  const [lang, setLang] = useState(project.languages[0] ?? "en");
  const [ownAudio, setOwnAudio] = useState(false);
  const [extra, setExtra] = useState("");
  const [model, setModel] = useState<StudioGenerateModel>(isKnownModel(project.model) ? project.model : "Veo 3.1 Lite");

  const [masterPrompt, setMasterPrompt] = useState(project.masterPrompt);
  const [concept, setConcept] = useState(project.concept ?? "");
  const [hook, setHook] = useState(project.hook ?? "");
  const [caption, setCaption] = useState(project.caption ?? "");
  const [hashtagsText, setHashtagsText] = useState((project.hashtags ?? []).join(", "));

  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scenesSoFar = useRef<StudioScene[]>([]);

  useEffect(() => {
    setMasterPrompt(project.masterPrompt);
    setConcept(project.concept ?? "");
    setHook(project.hook ?? "");
    setCaption(project.caption ?? "");
    setHashtagsText((project.hashtags ?? []).join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.updatedAt]);

  function parseHashtags(text: string): string[] {
    return text
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  async function handleGenerate() {
    if (!topic.trim() || isGenerating) return;
    setError(null);
    setIsGenerating(true);
    setProgressLabel("Starting...");
    scenesSoFar.current = [];

    const body: StudioGenerateRequest = {
      topic: topic.trim(),
      videoType: project.videoType,
      platform: platform || project.platform || "",
      numScenes,
      style: style || project.style || "",
      lang,
      ownAudio,
      extra,
      model,
      creditsPerAccount: project.creditsPerAccount,
    };

    try {
      await streamStudioGenerate(studioGenerateUrl(project.id), body, {
        onEvent: (type, data) => {
          if (type === "base") {
            const base = data as { concept: string; hook: string; master_prompt: string; caption: string; hashtags: string[] };
            setConcept(base.concept);
            setHook(base.hook);
            setMasterPrompt(base.master_prompt);
            setCaption(base.caption);
            setHashtagsText(base.hashtags.join(", "));
            onLocalUpdate({
              concept: base.concept,
              hook: base.hook,
              masterPrompt: base.master_prompt,
              caption: base.caption,
              hashtags: base.hashtags,
            });
          } else if (type === "scene") {
            const payload = data as { progressLabel: string; scene: StudioScene };
            setProgressLabel(payload.progressLabel);
            scenesSoFar.current = [...scenesSoFar.current, payload.scene];
            onLocalUpdate({ scenes: [...scenesSoFar.current] });
          } else if (type === "done") {
            setProgressLabel("Done");
            setIsGenerating(false);
          } else if (type === "error") {
            const payload = data as { message: string };
            setError(payload.message);
            setIsGenerating(false);
          }
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
      // The backend already persisted concept/hook/masterPrompt/caption/hashtags/scenes/accounts
      // onto studio.json when it sent "done", so re-fetch instead of re-sending it all via PATCH.
      await onRefresh().catch(() => undefined);
    }
  }

  return (
    <Card
      title="Generate prompts"
      hint="Fill this in and click Generate for an AI first draft, or skip it entirely and paste your own master prompt below."
    >
      <div className="mb-3.5 flex flex-wrap gap-3">
        <TextField
          label="Topic"
          value={topic}
          onChange={setTopic}
          placeholder="What is this video about?"
          className="min-w-[220px] flex-[2]"
        />

        <TextField label="Platform" value={platform} onChange={setPlatform} placeholder="Instagram Reels" className="min-w-[180px] flex-1" />

        <NumberField
          label="Number of scenes"
          hint={`(~${numScenes * 8}s total)`}
          value={numScenes}
          onChange={setNumScenes}
          min={1}
          max={30}
          className="min-w-[160px] flex-1"
        />
      </div>

      <div className="mb-3.5 flex flex-wrap gap-3">
        <TextField label="Style" value={style} onChange={setStyle} placeholder="cinematic, warm film grade" className="min-w-[180px] flex-1" />

        <SelectField
          label="Voiceover / dialogue language"
          value={lang}
          onChange={setLang}
          options={project.languages.map((l) => ({ value: l, label: l }))}
          className="min-w-[180px] flex-1"
        />

        <SelectField
          label="Model"
          value={model}
          onChange={(value) => setModel(value as StudioGenerateModel)}
          options={MODELS.map((m) => ({ value: m, label: m }))}
          className="min-w-[160px] flex-1"
        />

        <label className="flex min-w-[160px] flex-1 flex-col gap-1.5 text-xs text-ps-muted">
          <span>Credits per account</span>
          <p
            className="m-0 rounded-ps border border-ps-border bg-ps-panel px-2 py-1.5 text-sm text-ps-muted"
            title="Set in the project settings above"
          >
            {project.creditsPerAccount}
          </p>
        </label>
      </div>

      <label className="mb-3.5 flex flex-row items-center gap-2 text-xs text-ps-muted">
        <input type="checkbox" checked={!ownAudio} onChange={(e) => setOwnAudio(!e.target.checked)} />
        <span>Generate its own audio (uncheck if you will add your own voice/music track)</span>
      </label>

      <TextareaField
        label="Extra direction (optional)"
        rows={2}
        value={extra}
        onChange={setExtra}
        placeholder="Anything else Flow should know"
        className="mb-3.5"
      />

      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={handleGenerate} disabled={isGenerating || !topic.trim()}>
          {isGenerating ? "Generating..." : "Generate"}
        </Button>
        {isGenerating && <span className="text-xs text-ps-warning">{progressLabel}</span>}
      </div>

      {error && <p className="mb-3.5 whitespace-pre-wrap text-xs text-ps-danger">{error}</p>}

      <TextField label="Concept" value={concept} onChange={setConcept} onBlur={() => onPatch({ concept })} className="mb-3.5" />

      <TextField label="Hook" value={hook} onChange={setHook} onBlur={() => onPatch({ hook })} className="mb-3.5" />

      <TextareaField
        label="Master prompt"
        hint={`(${masterPrompt.length} chars)`}
        rows={10}
        value={masterPrompt}
        onChange={setMasterPrompt}
        onBlur={() => onPatch({ masterPrompt })}
        placeholder="Paste your own master setup prompt here, or generate one above."
        className="mb-2"
      />
      <div className="mb-3.5">
        <CopyButton text={masterPrompt} label="Copy master prompt" />
      </div>

      <TextareaField label="Caption" rows={2} value={caption} onChange={setCaption} onBlur={() => onPatch({ caption })} className="mb-3.5" />

      <TextField
        label="Hashtags (comma separated)"
        value={hashtagsText}
        onChange={setHashtagsText}
        onBlur={() => onPatch({ hashtags: parseHashtags(hashtagsText) })}
      />
    </Card>
  );
}
