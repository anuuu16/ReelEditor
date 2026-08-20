import { useState } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import { CopyButton } from "./CopyButton.js";
import { buildRhymePoemPromptTemplate, parseRhymePoemJson } from "./rhymeImportExport.js";
import { generateRhymePoem } from "./rhymeApi.js";
import { RhymePoemCard } from "./RhymePoemCard.js";
import { RhymeWizard } from "./RhymeWizard.js";
import type { RhymeContentType, RhymePoemParams, RhymePoemSlot, RhymePoemVersion } from "./rhymeTypes.js";
import type { StudioProject } from "./types.js";
import { Chip, NumberField, TextField } from "./ui/index.js";

interface RhymeStudioViewProps {
  project: StudioProject;
  onPatch: (patch: Partial<StudioProject>) => void;
  onOpenProject: (project: ProjectModel) => void;
}

const AGE_OPTIONS = ["Toddler (2-4)", "Preschool (4-6)", "Early school (6-9)"];
const STYLE_OPTIONS = ["Rhyme", "Story poem", "Lullaby", "Action song", "Counting song"];
const LANGUAGE_OPTIONS = ["English", "Hindi", "Hinglish"];
const CONTENT_TYPE_OPTIONS: Array<{ id: RhymeContentType; label: string }> = [
  { id: "poem", label: "Poem" },
  { id: "story", label: "Story" },
  { id: "script", label: "Script" },
];

// A Studio project's own `languages` list is a free-form tag used across every tab (resources,
// editor links, and so on), so it sometimes holds a short code like "en" from elsewhere in the
// app rather than the full name an AI generation prompt actually needs. Normalizing here means an
// older project doesn't show "English" and "en" as two separate, confusing chips.
const LANGUAGE_CODE_ALIASES: Record<string, string> = { en: "English", hi: "Hindi", "hi-en": "Hinglish", hinglish: "Hinglish" };

function normalizeLanguageName(value: string): string {
  return LANGUAGE_CODE_ALIASES[value.toLowerCase()] ?? value;
}

function normalizeLanguageList(values: string[]): string[] {
  return [...new Set(values.map(normalizeLanguageName))];
}
const MIN_LENGTH_SECONDS = 18;
const MAX_LENGTH_SECONDS = 54;
const DEFAULT_LENGTH_SECONDS = 32;
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

function scenesForLength(lengthSeconds: number): number {
  return Math.max(3, Math.min(6, Math.round(lengthSeconds / 8)));
}

export function RhymeStudioView({ project, onPatch, onOpenProject }: RhymeStudioViewProps) {
  const [wizardSlotId, setWizardSlotId] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [poemCount, setPoemCount] = useState(2);
  const [lengthSeconds, setLengthSeconds] = useState(DEFAULT_LENGTH_SECONDS);
  const [languages, setLanguages] = useState<string[]>(
    project.languages.length ? normalizeLanguageList(project.languages) : ["English"]
  );
  const [customLanguage, setCustomLanguage] = useState("");
  const [contentType, setContentType] = useState<RhymeContentType>("poem");
  const [age, setAge] = useState(AGE_OPTIONS[1]);
  const [style, setStyle] = useState(STYLE_OPTIONS[0]);
  const [extra, setExtra] = useState("");

  const [slots, setSlots] = useState<RhymePoemSlot[]>(project.poems ?? []);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const availableLanguages = [...new Set([...LANGUAGE_OPTIONS, ...languages])];
  const scenes = scenesForLength(lengthSeconds);

  function toggleLanguage(language: string) {
    setLanguages((prev) => (prev.includes(language) ? prev.filter((l) => l !== language) : [...prev, language]));
  }

  function addCustomLanguage() {
    const value = customLanguage.trim();
    if (!value || languages.includes(value)) return;
    setLanguages((prev) => [...prev, value]);
    setCustomLanguage("");
  }

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
    return {
      topic: topic.trim(),
      age,
      style,
      lengthSeconds,
      scenes,
      languages: languages.length ? languages : ["English"],
      contentType,
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
    const count = poemCount;

    const avoidTitles = slots.flatMap((s) => Object.values(s.versions[s.activeVersionIndex].poem.titles));
    const created: RhymePoemSlot[] = [];

    for (let i = 0; i < count; i++) {
      setProgressLabel(`Writing poem ${i + 1} of ${count}...`);
      const params: RhymePoemParams = { ...currentParams(), avoidTitles: [...avoidTitles] };
      try {
        const poem = await generateRhymePoem(params);
        avoidTitles.push(...Object.values(poem.titles));
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

  const contentNoun = CONTENT_TYPE_OPTIONS.find((c) => c.id === contentType)?.label.toLowerCase() ?? "content";

  return (
    <div className="rhyme-studio">
      <section className="prompt-studio-section">
        <h2>Generate content</h2>
        <p className="hint">
          Kids' poems, stories, or scripts, pre-timed into reel scenes, in as many languages at once as you pick below.
        </p>

        <div className="mb-3.5 flex flex-wrap gap-1.5">
          {CONTENT_TYPE_OPTIONS.map((option) => (
            <Chip key={option.id} active={contentType === option.id} onClick={() => setContentType(option.id)}>
              {option.label}
            </Chip>
          ))}
        </div>

        <div className="mb-3.5 flex flex-wrap gap-3">
          <TextField
            label="Topic"
            value={topic}
            onChange={setTopic}
            placeholder={`What should the ${contentNoun} be about?`}
            className="min-w-[220px] flex-[2]"
          />
          <NumberField
            label="How many pieces (1-6)"
            value={poemCount}
            onChange={setPoemCount}
            min={1}
            max={6}
            className="min-w-[140px] flex-1"
          />
          <NumberField
            label="Video length (seconds)"
            hint={`(~${scenes} scenes)`}
            value={lengthSeconds}
            onChange={setLengthSeconds}
            min={MIN_LENGTH_SECONDS}
            max={MAX_LENGTH_SECONDS}
            className="min-w-[160px] flex-1"
          />
        </div>

        <div className="inline-fields prompt-studio-header-row">
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

        <div className="field">
          <span>Languages — every one is a full, independently written {contentNoun}, not a translation</span>
          <div className="rhyme-language-chips">
            {availableLanguages.map((language) => (
              <button
                key={language}
                type="button"
                className={`rhyme-preset-chip${languages.includes(language) ? " active" : ""}`}
                onClick={() => toggleLanguage(language)}
              >
                {language}
              </button>
            ))}
          </div>
          <div className="inline-fields prompt-studio-add-language">
            <input
              type="text"
              value={customLanguage}
              onChange={(e) => setCustomLanguage(e.target.value)}
              placeholder="Add another language"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomLanguage();
                }
              }}
            />
            <button type="button" onClick={addCustomLanguage} disabled={!customLanguage.trim()}>
              + Add
            </button>
          </div>
          {languages.length === 0 && <p className="hint">Pick at least one language above.</p>}
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
          <button type="button" className="export-button" disabled={isGenerating || !topic.trim() || languages.length === 0} onClick={handleGenerate}>
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
            placeholder='{"titles":{"English":"..."},"poems":{"English":"..."},"scenes":[...]}'
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
