import { useEffect, useRef, useState } from "react";
import { studioGenerateUrl } from "./api.js";
import { CopyButton } from "./CopyButton.js";
import { streamStudioGenerate } from "./sse.js";
import type { StudioGenerateModel, StudioGenerateRequest, StudioProject, StudioScene } from "./types.js";

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
  // Kept as text while editing (not a number) so clearing the field to type a new value doesn't
  // get force-clamped back to a boundary on every keystroke — clamping only happens on blur.
  const [numScenesText, setNumScenesText] = useState(String(project.scenes.length || 8));
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

  function commitNumScenes() {
    const parsed = Math.round(Number(numScenesText));
    const clamped = Number.isFinite(parsed) ? Math.max(1, Math.min(30, parsed)) : Number(numScenesText) || 8;
    setNumScenesText(String(clamped));
    return clamped;
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
      numScenes: commitNumScenes(),
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
    <section className="prompt-studio-section">
      <h2>Generate prompts</h2>
      <p className="hint">
        Fill this in and click Generate for an AI first draft, or skip it entirely and paste your own master prompt below.
      </p>

      <div className="inline-fields prompt-studio-header-row">
        <label className="field prompt-studio-topic-field">
          <span>Topic</span>
          <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What is this video about?" />
        </label>

        <label className="field">
          <span>Platform</span>
          <input type="text" value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="Instagram Reels" />
        </label>

        <label className="field">
          <span>
            Number of scenes <span className="prompt-studio-char-count">(~{(Number(numScenesText) || 0) * 8}s total)</span>
          </span>
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
      </div>

      <div className="inline-fields prompt-studio-header-row">
        <label className="field">
          <span>Style</span>
          <input type="text" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="cinematic, warm film grade" />
        </label>

        <label className="field">
          <span>Voiceover / dialogue language</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {project.languages.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value as StudioGenerateModel)}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span>Credits per account</span>
          <p className="prompt-studio-derived-value" title="Set in the project settings above">
            {project.creditsPerAccount}
          </p>
        </div>
      </div>

      <label className="field checkbox-field">
        <span>Generate its own audio (uncheck if you will add your own voice/music track)</span>
        <input type="checkbox" checked={!ownAudio} onChange={(e) => setOwnAudio(!e.target.checked)} />
      </label>

      <label className="field">
        <span>Extra direction (optional)</span>
        <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Anything else Flow should know" />
      </label>

      <div className="inline-fields">
        <button type="button" className="export-button" onClick={handleGenerate} disabled={isGenerating || !topic.trim()}>
          {isGenerating ? "Generating..." : "Generate"}
        </button>
        {isGenerating && <span className="prompt-studio-progress-label">{progressLabel}</span>}
      </div>

      {error && <p className="export-error">{error}</p>}

      <label className="field">
        <span>Concept</span>
        <input type="text" value={concept} onChange={(e) => setConcept(e.target.value)} onBlur={() => onPatch({ concept })} />
      </label>

      <label className="field">
        <span>Hook</span>
        <input type="text" value={hook} onChange={(e) => setHook(e.target.value)} onBlur={() => onPatch({ hook })} />
      </label>

      <label className="field">
        <span>
          Master prompt <span className="prompt-studio-char-count">({masterPrompt.length} chars)</span>
        </span>
        <textarea
          rows={10}
          value={masterPrompt}
          onChange={(e) => setMasterPrompt(e.target.value)}
          onBlur={() => onPatch({ masterPrompt })}
          placeholder="Paste your own master setup prompt here, or generate one above."
        />
      </label>
      <div className="inline-fields prompt-studio-master-actions">
        <CopyButton text={masterPrompt} label="Copy master prompt" />
      </div>

      <label className="field">
        <span>Caption</span>
        <textarea rows={2} value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={() => onPatch({ caption })} />
      </label>

      <label className="field">
        <span>Hashtags (comma separated)</span>
        <input
          type="text"
          value={hashtagsText}
          onChange={(e) => setHashtagsText(e.target.value)}
          onBlur={() => onPatch({ hashtags: parseHashtags(hashtagsText) })}
        />
      </label>
    </section>
  );
}
