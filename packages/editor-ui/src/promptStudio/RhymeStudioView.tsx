import { useState } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import { CopyButton } from "./CopyButton.js";
import { buildRhymePoemPromptTemplate, parseRhymePoemJson } from "./rhymeImportExport.js";
import { generateRhymePoem } from "./rhymeApi.js";
import { RhymePoemCard } from "./RhymePoemCard.js";
import { RhymeWizard } from "./RhymeWizard.js";
import type { RhymePoemParams, RhymePoemSlot, RhymePoemVersion } from "./rhymeTypes.js";
import type { StudioProject } from "./types.js";

interface RhymeStudioViewProps {
  project: StudioProject;
  onPatch: (patch: Partial<StudioProject>) => void;
  onOpenProject: (project: ProjectModel) => void;
}

const AGE_OPTIONS = ["Toddler (2-4)", "Preschool (4-6)", "Early school (6-9)"];
const STYLE_OPTIONS = ["Rhyme", "Story poem", "Lullaby", "Action song", "Counting song"];
const LENGTH_OPTIONS: Array<{ label: string; lines: number }> = [
  { label: "Short", lines: 6 },
  { label: "Medium", lines: 10 },
  { label: "Long", lines: 14 },
];
const EXTRA_PRESETS = [
  "Add a repeating chorus kids can sing along",
  "Add fun animal sounds",
  "Add actions and hand movements",
  "Teach counting 1 to 5",
  "Bright and energetic with clapping",
  "Calming for bedtime",
  "End with a giggle",
  "Simple words toddlers can repeat",
];

export function RhymeStudioView({ project, onPatch, onOpenProject }: RhymeStudioViewProps) {
  const [wizardSlotId, setWizardSlotId] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [poemCount, setPoemCountText] = useState("2");
  const [sceneCount, setSceneCountText] = useState("4");
  const [lengthLabel, setLengthLabel] = useState("Medium");
  const [lang, setLang] = useState(project.languages[0] ?? "English");
  const [lang2, setLang2] = useState("None");
  const [age, setAge] = useState(AGE_OPTIONS[1]);
  const [style, setStyle] = useState(STYLE_OPTIONS[0]);
  const [extra, setExtra] = useState("");

  const [slots, setSlots] = useState<RhymePoemSlot[]>(project.poems ?? []);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  function toggleExtraPreset(preset: string) {
    setExtra((prev) => (prev.includes(preset) ? prev.replace(preset, "").replace(/^, |, $/g, "").trim() : prev ? `${prev}, ${preset}` : preset));
  }

  function persistSlots(next: RhymePoemSlot[]) {
    setSlots(next);
    onPatch({ poems: next });
  }

  function updateSlot(next: RhymePoemSlot) {
    persistSlots(slots.map((s) => (s.id === next.id ? next : s)));
  }

  function currentParams(): RhymePoemParams {
    const scenes = Math.max(3, Math.min(6, Math.round(Number(sceneCount)) || 4));
    const lines = LENGTH_OPTIONS.find((l) => l.label === lengthLabel)?.lines ?? 10;
    return {
      topic: topic.trim(),
      age,
      style,
      lines,
      scenes,
      lang,
      lang2: lang2 !== "None" ? lang2 : undefined,
      extra: extra.trim() || undefined,
    };
  }

  function handleImportPoem() {
    setPasteError(null);
    try {
      const poem = parseRhymePoemJson(pasteText);
      const version: RhymePoemVersion = { id: crypto.randomUUID(), label: "Pasted", poem, createdAt: Date.now() };
      const slot: RhymePoemSlot = { id: crypto.randomUUID(), params: currentParams(), versions: [version], activeVersionIndex: 0 };
      persistSlots([...slots, slot]);
      setPasteText("");
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleGenerate() {
    if (!topic.trim() || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    const count = Math.max(1, Math.min(6, Math.round(Number(poemCount)) || 1));

    const avoidTitles = slots.map((s) => s.versions[s.activeVersionIndex].poem.title);
    const created: RhymePoemSlot[] = [];

    for (let i = 0; i < count; i++) {
      setProgressLabel(`Writing poem ${i + 1} of ${count}...`);
      const params: RhymePoemParams = { ...currentParams(), avoidTitles: [...avoidTitles] };
      try {
        const poem = await generateRhymePoem(params);
        avoidTitles.push(poem.title);
        const version: RhymePoemVersion = { id: crypto.randomUUID(), label: "Original", poem, createdAt: Date.now() };
        const slot: RhymePoemSlot = { id: crypto.randomUUID(), params, versions: [version], activeVersionIndex: 0 };
        created.push(slot);
        persistSlots([...slots, ...created]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        break;
      }
    }

    setIsGenerating(false);
    setProgressLabel("");
  }

  const wizardSlot = wizardSlotId ? slots.find((s) => s.id === wizardSlotId) : undefined;
  if (wizardSlot) {
    return (
      <RhymeWizard
        project={project}
        slot={wizardSlot}
        onSlotChange={updateSlot}
        onPatch={onPatch}
        onOpenProject={onOpenProject}
        onExit={() => setWizardSlotId(null)}
      />
    );
  }

  return (
    <div className="rhyme-studio">
      <section className="prompt-studio-section">
        <h2>Generate poems</h2>
        <p className="hint">Kids poems, pre-timed into reel scenes. Optionally in a second language, aligned scene by scene.</p>

        <div className="inline-fields prompt-studio-header-row">
          <label className="field prompt-studio-topic-field">
            <span>Topic</span>
            <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What should the poem be about?" />
          </label>
          <label className="field">
            <span>How many poems</span>
            <input
              type="number"
              min={1}
              max={6}
              inputMode="numeric"
              value={poemCount}
              onChange={(e) => setPoemCountText(e.target.value)}
              onBlur={() => setPoemCountText(String(Math.max(1, Math.min(6, Math.round(Number(poemCount)) || 1))))}
            />
          </label>
          <label className="field">
            <span>Reel scenes</span>
            <input
              type="number"
              min={3}
              max={6}
              inputMode="numeric"
              value={sceneCount}
              onChange={(e) => setSceneCountText(e.target.value)}
              onBlur={() => setSceneCountText(String(Math.max(3, Math.min(6, Math.round(Number(sceneCount)) || 4))))}
            />
          </label>
        </div>

        <div className="inline-fields prompt-studio-header-row">
          <label className="field">
            <span>Length</span>
            <select value={lengthLabel} onChange={(e) => setLengthLabel(e.target.value)}>
              {LENGTH_OPTIONS.map((l) => (
                <option key={l.label} value={l.label}>
                  {l.label} (~{l.lines} lines)
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Age group</span>
            <select value={age} onChange={(e) => setAge(e.target.value)}>
              {AGE_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Style</span>
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              {STYLE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="inline-fields prompt-studio-header-row">
          <label className="field">
            <span>Primary language</span>
            <select value={lang} onChange={(e) => setLang(e.target.value)}>
              {["English", "Hindi", "Hinglish"].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Second language</span>
            <select value={lang2} onChange={(e) => setLang2(e.target.value)}>
              {["None", "English", "Hindi", "Hinglish"].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Extra direction (optional)</span>
          <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Anything else the poem should include" />
        </label>

        <div className="rhyme-preset-chips">
          {EXTRA_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`rhyme-preset-chip${extra.includes(preset) ? " active" : ""}`}
              onClick={() => toggleExtraPreset(preset)}
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="inline-fields">
          <button type="button" className="export-button" disabled={isGenerating || !topic.trim()} onClick={handleGenerate}>
            {isGenerating ? progressLabel || "Generating..." : "Generate"}
          </button>
        </div>
        {error && <p className="export-error">{error}</p>}
      </section>

      <section className="prompt-studio-section">
        <h2>Use any AI chat</h2>
        <p className="hint">
          Copy this prompt into Claude, ChatGPT, or anywhere else, then paste back the JSON it gives you as a new poem.
        </p>
        <label className="field">
          <span>Prompt to copy into any AI chat</span>
          <textarea rows={6} readOnly value={buildRhymePoemPromptTemplate(currentParams())} />
        </label>
        <div className="inline-fields prompt-studio-master-actions">
          <CopyButton text={buildRhymePoemPromptTemplate(currentParams())} label="Copy prompt" />
        </div>
        <label className="field">
          <span>Paste the JSON it gives you back</span>
          <textarea
            rows={6}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder='{"title":"...","poem":"...","scenes":[...]}'
          />
        </label>
        <div className="inline-fields">
          <button type="button" onClick={handleImportPoem} disabled={!pasteText.trim()}>
            Import poem
          </button>
        </div>
        {pasteError && <p className="export-error">{pasteError}</p>}
      </section>

      {slots.length === 0 ? (
        <p className="hint">No poems yet. Fill in a topic above and click Generate, or paste one in.</p>
      ) : (
        slots.map((slot) => (
          <div key={slot.id} className="rhyme-poem-card-wrapper">
            <div className="inline-fields rhyme-poem-card-wizard-link">
              <button type="button" onClick={() => setWizardSlotId(slot.id)}>
                Step-by-step: audio, assets, video, editor, final →
              </button>
            </div>
            <RhymePoemCard slot={slot} onChange={updateSlot} />
          </div>
        ))
      )}
    </div>
  );
}
