import { useState } from "react";
import { reworkRhymePoem } from "./rhymeApi.js";
import { computeTiming, deriveScenesFromPoems, formatMmSs } from "./rhymeTiming.js";
import type { RhymePoemSlot, RhymePoemVersion } from "./rhymeTypes.js";
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

// The lyrics half of what used to be RhymePoemCard — title, per-language poem text, rework
// actions, and the timed scene breakdown those lines produce. Scene *prompt* generation (which
// takes this text as input) is a separate step, RhymeScenesStep, further along the wizard.
export function RhymeLyricsStep({ slot, onChange }: RhymeLyricsStepProps) {
  const [isReworking, setIsReworking] = useState<string | null>(null);
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

      <div className="rhyme-timeline">
        <h4>Scenes ({formatMmSs(total)} total)</h4>
        {timed.map((seg, i) => (
          <div key={i} className="rhyme-timeline-row">
            <span className="rhyme-timeline-range">
              {formatMmSs(seg.start)} - {formatMmSs(seg.end)}
            </span>
            <div className="rhyme-timeline-lines">
              {languages.map((language, langIndex) => (
                <span key={language} className={langIndex > 0 ? "rhyme-timeline-lines2" : undefined}>
                  {seg.lines[language] ?? ""}
                </span>
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
      </div>

      {error && <p className="mb-3.5 whitespace-pre-wrap text-xs text-ps-danger">{error}</p>}
    </Card>
  );
}
