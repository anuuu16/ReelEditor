import { useState } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import { CopyButton } from "./CopyButton.js";
import { buildRhymePoemPromptTemplate, parseRhymePoemJson } from "./rhymeImportExport.js";
import { generateRhymePoem } from "./rhymeApi.js";
import { listTemplates, saveCustomTemplate, type RhymeTemplate } from "./rhymeTemplates.js";
import { RhymeWizard } from "./RhymeWizard.js";
import type { RhymeContentType, RhymePoemParams, RhymePoemSlot, RhymePoemVersion } from "./rhymeTypes.js";
import type { StudioProject } from "./types.js";
import { Button, Card, Chip, NumberField, SelectField, TextField, TextareaField } from "./ui/index.js";

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
// Reel mode stays short-form (3-6 scenes, matching the vertical-reel/shorts norms this app started
// from). Full video mode (project.videoType, set in Settings) has no upper bound at all — any
// length the user types is split into ~8s scenes (Veo's own generated-clip length), same math
// either way, just without the reel range's 54s/6-scene ceiling.
const REEL_MIN_LENGTH_SECONDS = 18;
const REEL_MAX_LENGTH_SECONDS = 54;
const REEL_DEFAULT_LENGTH_SECONDS = 32;
const FULL_VIDEO_MIN_LENGTH_SECONDS = 8;
const FULL_VIDEO_DEFAULT_LENGTH_SECONDS = 180;
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

function scenesForLength(lengthSeconds: number, isFullVideo: boolean): number {
  const scenes = Math.round(lengthSeconds / 8);
  return isFullVideo ? Math.max(3, scenes) : Math.max(3, Math.min(6, scenes));
}

export function RhymeStudioView({ project, onPatch, onOpenProject }: RhymeStudioViewProps) {
  const [wizardSlotId, setWizardSlotId] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [poemCount, setPoemCount] = useState(2);
  const isFullVideo = project.videoType === "full_video";
  const [lengthSeconds, setLengthSeconds] = useState(isFullVideo ? FULL_VIDEO_DEFAULT_LENGTH_SECONDS : REEL_DEFAULT_LENGTH_SECONDS);
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

  const [templates, setTemplates] = useState<RhymeTemplate[]>(listTemplates());
  const [templateId, setTemplateId] = useState("");
  const [newTemplateName, setNewTemplateName] = useState("");

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    if (!template) return;
    setAge(template.age);
    setStyle(template.style);
    setLengthSeconds(template.lengthSeconds);
    setLanguages(template.languages);
    setContentType(template.contentType);
    setExtra(template.extra);
  }

  // Saves everything a template pre-fills except the topic (every project's topic is different).
  // Every field stays editable afterward — the template is only a starting point.
  function handleSaveTemplate() {
    const name = newTemplateName.trim();
    if (!name) return;
    const template: RhymeTemplate = {
      id: crypto.randomUUID(),
      name,
      age,
      style,
      lengthSeconds,
      languages,
      contentType,
      extra,
    };
    saveCustomTemplate(template);
    setTemplates(listTemplates());
    setTemplateId(template.id);
    setNewTemplateName("");
  }

  const availableLanguages = [...new Set([...LANGUAGE_OPTIONS, ...languages])];
  const scenes = scenesForLength(lengthSeconds, isFullVideo);

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

  // Every language a rhyme was actually generated/imported in must stay available project-wide
  // (the resource uploader's language picker and the wizard's per-language editor launcher both
  // read project.languages), otherwise a rhyme written in a language never added to the project
  // gets stranded with nowhere to upload its audio or launch its editor.
  function persistSlots(next: RhymePoemSlot[]) {
    setSlots(next);
    const mergedLanguages = normalizeLanguageList([...project.languages, ...next.flatMap((s) => s.params.languages)]);
    const languagesChanged = mergedLanguages.some((l) => !project.languages.includes(l));
    onPatch(languagesChanged ? { poems: next, languages: mergedLanguages } : { poems: next });
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
      setWizardSlotId(slot.id);
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
    // Jump straight into the step-by-step flow for the first poem just written — concept (this
    // screen) flows forward into lyrics (the wizard's first step) rather than leaving the user on
    // a list they'd have to click back into.
    if (created.length > 0) setWizardSlotId(created[0].id);
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
      <Card
        title="Template"
        hint="Pre-fills age, style, length, languages, and extra direction below. Everything stays editable after — a template is just a starting point."
      >
        <div className="mb-3.5 flex flex-wrap items-end gap-3">
          <SelectField
            label="Start from a template"
            value={templateId}
            onChange={applyTemplate}
            options={[{ value: "", label: "Custom (no template)" }, ...templates.map((t) => ({ value: t.id, label: t.name }))]}
            className="min-w-[220px] flex-1"
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label="Save current settings as a new template"
            value={newTemplateName}
            onChange={setNewTemplateName}
            placeholder="e.g. YouTube poem"
            className="min-w-[220px] flex-1"
          />
          <Button onClick={handleSaveTemplate} disabled={!newTemplateName.trim()}>
            Save template
          </Button>
        </div>
      </Card>

      <Card
        title="Generate content"
        hint="Kids' poems, stories, or scripts, pre-timed into reel scenes, in as many languages at once as you pick below."
      >
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
            label={`Video length (seconds)${isFullVideo ? " — full video, any length" : ""}`}
            hint={`(~${scenes} scenes)`}
            value={lengthSeconds}
            onChange={setLengthSeconds}
            min={isFullVideo ? FULL_VIDEO_MIN_LENGTH_SECONDS : REEL_MIN_LENGTH_SECONDS}
            max={isFullVideo ? undefined : REEL_MAX_LENGTH_SECONDS}
            className="min-w-[160px] flex-1"
          />
        </div>

        <div className="mb-3.5 flex flex-wrap gap-3">
          <SelectField
            label="Age group"
            value={age}
            onChange={setAge}
            options={AGE_OPTIONS.map((a) => ({ value: a, label: a }))}
            className="min-w-[180px] flex-1"
          />
          <SelectField
            label="Style"
            value={style}
            onChange={setStyle}
            options={STYLE_OPTIONS.map((s) => ({ value: s, label: s }))}
            className="min-w-[180px] flex-1"
          />
        </div>

        <div className="mb-3.5 flex flex-col gap-1.5 text-xs text-ps-muted">
          <span>Languages — every one is a full, independently written {contentNoun}, not a translation</span>
          <div className="flex flex-wrap gap-1.5">
            {availableLanguages.map((language) => (
              <Chip key={language} active={languages.includes(language)} onClick={() => toggleLanguage(language)}>
                {language}
              </Chip>
            ))}
          </div>
          <div className="flex items-end gap-3">
            {/* Kept as a hand-styled input (not TextField) because it needs an Enter-to-submit
                onKeyDown handler that the TextField primitive does not expose — same ps-* token
                classes as TextField's input, just with the extra handler wired in. */}
            <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
              <span>Add another language</span>
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
                className="w-full min-w-0 rounded-ps border border-ps-border bg-ps-elevated px-2.5 py-1.5 text-sm text-ps-text placeholder:text-ps-muted focus:border-ps-accent focus:outline-none"
              />
            </label>
            <Button onClick={addCustomLanguage} disabled={!customLanguage.trim()}>
              + Add
            </Button>
          </div>
          {languages.length === 0 && <p>Pick at least one language above.</p>}
        </div>

        <TextareaField
          label="Extra direction (optional)"
          rows={2}
          value={extra}
          onChange={setExtra}
          placeholder="Anything else the poem should include"
          className="mb-3.5"
        />

        <div className="mb-3.5 flex flex-wrap gap-1.5">
          {EXTRA_PRESETS.map((preset) => (
            <Chip key={preset} active={extra.includes(preset)} onClick={() => toggleExtraPreset(preset)}>
              {preset}
            </Chip>
          ))}
        </div>

        <Button variant="primary" disabled={isGenerating || !topic.trim() || languages.length === 0} onClick={handleGenerate}>
          {isGenerating ? progressLabel || "Generating..." : "Generate"}
        </Button>
        {error && <p className="mt-3 whitespace-pre-wrap text-xs text-ps-danger">{error}</p>}
      </Card>

      <Card
        title="Use any AI chat"
        hint="Copy this prompt into Claude, ChatGPT, or anywhere else, then paste back the JSON it gives you as a new poem."
      >
        <TextareaField
          label="Prompt to copy into any AI chat"
          rows={6}
          readOnly
          value={buildRhymePoemPromptTemplate(currentParams())}
          onChange={() => {}}
          className="mb-2"
        />
        <div className="mb-3.5">
          <CopyButton text={buildRhymePoemPromptTemplate(currentParams())} label="Copy prompt" />
        </div>
        <TextareaField
          label="Paste the JSON it gives you back"
          rows={6}
          value={pasteText}
          onChange={setPasteText}
          placeholder='{"titles":{"English":"..."},"poems":{"English":"..."},"scenes":[...]}'
          className="mb-3.5"
        />
        <Button variant="primary" onClick={handleImportPoem} disabled={!pasteText.trim()}>
          Import poem
        </Button>
        {pasteError && <p className="mt-3 whitespace-pre-wrap text-xs text-ps-danger">{pasteError}</p>}
      </Card>

      {slots.length === 0 ? (
        <p className="text-xs text-ps-muted">No poems yet. Fill in a topic above and click Generate, or paste one in.</p>
      ) : (
        <Card title="Your poems">
          {slots.map((slot) => {
            const version = slot.versions[slot.activeVersionIndex];
            const title = Object.values(version.poem.titles)[0] || "Untitled poem";
            return (
              <div key={slot.id} className="mb-1.5 flex flex-wrap items-center justify-between gap-3 rounded-ps border border-ps-border px-3 py-2">
                <div>
                  <p className="font-semibold text-ps-text">{title}</p>
                  <p className="text-xs text-ps-muted">
                    {slot.params.languages.join(", ")} · {slot.versions.length} version{slot.versions.length === 1 ? "" : "s"}
                  </p>
                </div>
                <Button onClick={() => setWizardSlotId(slot.id)}>Continue: lyrics, scenes, audio, assets, video, editor, final →</Button>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
