import { useState } from "react";
import { fixRhymeTimeline, reworkRhymePoem } from "./rhymeApi.js";
import { computeTiming, deriveScenesFromPoems, formatMmSs } from "./rhymeTiming.js";
import type { RhymePoemSlot, RhymePoemVersion, RhymeScene } from "./rhymeTypes.js";
import { CopyButton } from "./CopyButton.js";
import { Button, Card, TextareaField } from "./ui/index.js";

interface RhymeLyricsStepProps {
  slot: RhymePoemSlot;
  onChange: (next: RhymePoemSlot) => void;
}

const REWORK_LABELS: Record<"regenerate" | "optimize" | "enhance", string> = {
  regenerate: "Regenerate",
  optimize: "Optimize rhythm",
  enhance: "Enhance",
};

// ElevenLabs (and most TTS) has no separate "instructions" channel — whatever text you paste gets
// read aloud verbatim, so a plain sentence like "read this cheerfully" would just get spoken as
// words. Their v3 model is the exception: bracketed tags like [playful] are recognized as delivery
// direction and stripped before speaking rather than voiced — safe to prepend for that model, but
// on any other TTS the brackets would just get read literally, so this is called out in the UI.
const STYLE_TONE_TAGS: Record<string, string> = {
  Rhyme: "playful, sing-song",
  "Story poem": "warm, narrative",
  Lullaby: "soft, soothing, gentle",
  "Action song": "energetic, upbeat",
  "Counting song": "cheerful, rhythmic",
};

function voicePromptText(lines: string, style: string): string {
  const tone = STYLE_TONE_TAGS[style] ?? "warm, friendly";
  return `[${tone}] ${lines}`;
}

// The lyrics half of what used to be RhymePoemCard — title, per-language poem text, rework
// actions, and the timed scene breakdown those lines produce. Scene *prompt* generation (which
// takes this text as input) is a separate step, RhymeScenesStep, further along the wizard.
export function RhymeLyricsStep({ slot, onChange }: RhymeLyricsStepProps) {
  const [isReworking, setIsReworking] = useState<string | null>(null);
  const [isFixingTimeline, setIsFixingTimeline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const version = slot.versions[slot.activeVersionIndex];
  const poem = version.poem;
  const languages = slot.params.languages.length ? slot.params.languages : Object.keys(poem.poems);
  const primaryTitle = poem.titles[languages[0]] ?? Object.values(poem.titles)[0] ?? "";
  const { timed, total } = computeTiming(poem.scenes.length ? poem.scenes : deriveScenesFromPoems(poem.poems, slot.params.scenes));

  function updatePoemField(patch: { titles?: Record<string, string>; poems?: Record<string, string> }) {
    const versions = slot.versions.map((v, i) =>
      i === slot.activeVersionIndex
        ? {
            ...v,
            poem: {
              ...v.poem,
              titles: patch.titles ? { ...v.poem.titles, ...patch.titles } : v.poem.titles,
              poems: patch.poems ? { ...v.poem.poems, ...patch.poems } : v.poem.poems,
            },
          }
        : v
    );
    onChange({ ...slot, versions });
  }

  function setActiveVersionIndex(index: number) {
    onChange({ ...slot, activeVersionIndex: index });
  }

  // Unlike updatePoemField, this only ever touches the active version's scenes — never its
  // titles/poems — and never appends a new version, since nothing here changes the lyrics
  // themselves worth keeping as a separate draft.
  function updateScenes(scenes: RhymeScene[]) {
    const versions = slot.versions.map((v, i) => (i === slot.activeVersionIndex ? { ...v, poem: { ...v.poem, scenes } } : v));
    onChange({ ...slot, versions });
  }

  // Regenerate/optimize/enhance only ever append a version, never replace one, so they can pile up
  // with no way to prune the ones that didn't turn out well — this is that prune.
  function deleteVersion(index: number) {
    if (slot.versions.length <= 1) return;
    const versions = slot.versions.filter((_, i) => i !== index);
    let activeVersionIndex = slot.activeVersionIndex;
    if (index < slot.activeVersionIndex) activeVersionIndex -= 1;
    else if (index === slot.activeVersionIndex) activeVersionIndex = Math.min(index, versions.length - 1);
    onChange({ ...slot, versions, activeVersionIndex });
  }

  async function handleRework(kind: "regenerate" | "optimize" | "enhance") {
    setIsReworking(kind);
    setError(null);
    try {
      const reworked = await reworkRhymePoem({
        ...slot.params,
        kind,
        avoidTitles: kind === "regenerate" ? slot.versions.flatMap((v) => Object.values(v.poem.titles)) : slot.params.avoidTitles,
        current: { titles: poem.titles, poems: poem.poems },
      });
      const newVersion: RhymePoemVersion = {
        id: crypto.randomUUID(),
        label: REWORK_LABELS[kind],
        poem: reworked,
        createdAt: Date.now(),
      };
      onChange({ ...slot, versions: [...slot.versions, newVersion], activeVersionIndex: slot.versions.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsReworking(null);
    }
  }

  // Like enhance/optimize but never touches the words at all — only re-splits the existing lyrics
  // into a corrected, strictly timed scene breakdown. Updates the current version in place rather
  // than appending a new one, since the lyrics themselves aren't changing.
  async function handleFixTimeline() {
    setIsFixingTimeline(true);
    setError(null);
    try {
      const { scenes } = await fixRhymeTimeline({
        poems: poem.poems,
        languages,
        scenes: slot.params.scenes,
        lengthSeconds: slot.params.lengthSeconds,
        clipLengthSeconds: slot.params.clipLengthSeconds ?? 8,
      });
      updateScenes(scenes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFixingTimeline(false);
    }
  }

  return (
    <Card>
      <div className="rhyme-poem-card-header">
        <input
          className="flex-1 rounded-ps border border-transparent bg-transparent px-1.5 py-1 text-base font-semibold text-ps-text hover:border-ps-border hover:bg-ps-elevated focus:border-ps-border focus:bg-ps-elevated focus:outline-none"
          type="text"
          value={primaryTitle}
          onChange={(e) => updatePoemField({ titles: { [languages[0]]: e.target.value } })}
          placeholder="Untitled poem"
        />
        {slot.versions.length > 1 && (
          <div className="rhyme-version-pager">
            <Button
              variant="ghost"
              className="!px-1.5 !py-1"
              disabled={slot.activeVersionIndex === 0}
              onClick={() => setActiveVersionIndex(slot.activeVersionIndex - 1)}
            >
              ‹
            </Button>
            <span>
              {version.label} ({slot.activeVersionIndex + 1}/{slot.versions.length})
            </span>
            <Button
              variant="ghost"
              className="!px-1.5 !py-1"
              disabled={slot.activeVersionIndex === slot.versions.length - 1}
              onClick={() => setActiveVersionIndex(slot.activeVersionIndex + 1)}
            >
              ›
            </Button>
            <Button
              variant="ghost"
              className="!px-1.5 !py-1"
              title="Delete this version"
              onClick={() => {
                if (window.confirm(`Delete the "${version.label}" version? This can't be undone.`)) {
                  deleteVersion(slot.activeVersionIndex);
                }
              }}
            >
              Delete
            </Button>
          </div>
        )}
      </div>

      {languages.map((language) => (
        <TextareaField
          key={language}
          label={`Poem (${language})`}
          rows={6}
          value={poem.poems[language] ?? ""}
          onChange={(value) => updatePoemField({ poems: { [language]: value } })}
          className="mb-3.5"
        />
      ))}

      {/* Whole-poem copy, for pasting into ElevenLabs (or any TTS) as one continuous narration —
          separate from the per-scene copies below, which are for generating audio scene by scene
          so each clip lines up with its matching video scene in the timeline. "Copy prompt" adds an
          [emotion] tag ElevenLabs' v3 model reads as delivery direction (not spoken aloud) — on any
          other TTS those brackets would be read out literally, so "Copy lyrics" (plain text, no
          tag) is the safe default and "Copy prompt" is opt-in for v3 specifically. */}
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {languages.map((language) => (
          <CopyButton
            key={language}
            text={poem.poems[language] ?? ""}
            label={`Copy ${language} lyrics`}
            disabled={!(poem.poems[language] ?? "").trim()}
          />
        ))}
        {languages.map((language) => (
          <CopyButton
            key={`${language}-prompt`}
            text={voicePromptText(poem.poems[language] ?? "", slot.params.style)}
            label={`Copy ${language} prompt`}
            title={`${language} lyrics with an ElevenLabs v3 [emotion] tag prepended (ElevenLabs v3 only — other TTS engines would read the brackets aloud)`}
            disabled={!(poem.poems[language] ?? "").trim()}
          />
        ))}
      </div>
      <p className="mb-3.5 text-xs text-ps-muted">"Prompt" adds an [emotion] tag for ElevenLabs v3 — use plain "lyrics" for any other TTS.</p>

      <div className="rhyme-timeline">
        <h4>Scenes ({formatMmSs(total)} total)</h4>
        {timed.map((seg, i) => (
          <div key={i} className="rhyme-timeline-row">
            <span className="rhyme-timeline-range">
              {formatMmSs(seg.start)} - {formatMmSs(seg.end)}
            </span>
            <div className="rhyme-timeline-lines">
              {languages.map((language, langIndex) => (
                <div key={language} className="flex items-center gap-1.5">
                  <span className={langIndex > 0 ? "rhyme-timeline-lines2" : undefined}>{seg.lines[language] ?? ""}</span>
                  <CopyButton
                    text={seg.lines[language] ?? ""}
                    label="Copy"
                    title={`Copy ${language} lines for scene ${i + 1} (${formatMmSs(seg.start)}-${formatMmSs(seg.end)}, ~${(seg.end - seg.start).toFixed(1)}s) — paste into any TTS, pacing it to fill that time to stay in sync with the video timeline`}
                    className="!px-1.5 !py-0.5 text-[10px]"
                    disabled={!(seg.lines[language] ?? "").trim()}
                  />
                  <CopyButton
                    text={voicePromptText(seg.lines[language] ?? "", slot.params.style)}
                    label="Copy prompt"
                    title={`Scene ${i + 1} (${formatMmSs(seg.start)}-${formatMmSs(seg.end)}, ~${(seg.end - seg.start).toFixed(1)}s) with an ElevenLabs v3 [emotion] tag prepended — v3 only, other TTS engines would read the brackets aloud`}
                    className="!px-1.5 !py-0.5 text-[10px]"
                    disabled={!(seg.lines[language] ?? "").trim()}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-3.5 flex flex-wrap items-center gap-1.5">
        <Button disabled={isReworking !== null} onClick={() => handleRework("regenerate")}>
          {isReworking === "regenerate" ? "Regenerating..." : "Regenerate"}
        </Button>
        <Button disabled={isReworking !== null} onClick={() => handleRework("optimize")}>
          {isReworking === "optimize" ? "Optimizing..." : "Optimize rhythm"}
        </Button>
        <Button disabled={isReworking !== null} onClick={() => handleRework("enhance")}>
          {isReworking === "enhance" ? "Enhancing..." : "Enhance"}
        </Button>
        <Button disabled={isFixingTimeline} onClick={handleFixTimeline} title="Re-splits into scenes without changing any words">
          {isFixingTimeline ? "Fixing timeline..." : "Fix timeline"}
        </Button>
      </div>

      {error && <p className="mb-3.5 whitespace-pre-wrap text-xs text-ps-danger">{error}</p>}
    </Card>
  );
}
