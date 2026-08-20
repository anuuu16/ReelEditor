import { useState } from "react";
import { generateRhymeReelCaption, generateRhymeReelMaster, generateRhymeReelScene, reworkRhymePoem } from "./rhymeApi.js";
import { computeTiming, deriveScenesFromPoems, formatMmSs } from "./rhymeTiming.js";
import type { RhymePoemSlot, RhymePoemVersion, RhymeReel } from "./rhymeTypes.js";
import { CopyButton } from "./CopyButton.js";

interface RhymePoemCardProps {
  slot: RhymePoemSlot;
  onChange: (next: RhymePoemSlot) => void;
}

const REWORK_LABELS: Record<"regenerate" | "optimize" | "enhance", string> = {
  regenerate: "Regenerate",
  optimize: "Optimize rhythm",
  enhance: "Enhance",
};

export function RhymePoemCard({ slot, onChange }: RhymePoemCardProps) {
  const [isReworking, setIsReworking] = useState<string | null>(null);
  const [isBuildingReel, setIsBuildingReel] = useState(false);
  const [reelProgress, setReelProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reelLanguage, setReelLanguage] = useState(slot.params.languages[0] ?? "English");

  const version = slot.versions[slot.activeVersionIndex];
  const poem = version.poem;
  const languages = slot.params.languages.length ? slot.params.languages : Object.keys(poem.poems);
  const primaryTitle = poem.titles[languages[0]] ?? Object.values(poem.titles)[0] ?? "";
  const { timed, total } = computeTiming(poem.scenes.length ? poem.scenes : deriveScenesFromPoems(poem.poems, slot.params.scenes));
  const currentReel = version.reels?.[reelLanguage];

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

  async function handleMakeReel() {
    setIsBuildingReel(true);
    setError(null);
    try {
      const title = poem.titles[reelLanguage] ?? primaryTitle;
      setReelProgress("Writing master style bible...");
      const { master } = await generateRhymeReelMaster({ title, topic: slot.params.topic, age: slot.params.age });

      const scenePrompts: string[] = [];
      for (let i = 0; i < timed.length; i++) {
        setReelProgress(`Writing scene ${i + 1} of ${timed.length}...`);
        const seg = timed[i];
        const { prompt } = await generateRhymeReelScene({
          master,
          seg: { lines: seg.lines, dur: seg.end - seg.start },
          idx: i,
          total: timed.length,
          primaryLanguage: reelLanguage,
        });
        scenePrompts.push(prompt);
        const partialReel: RhymeReel = { master, scenePrompts: [...scenePrompts], caption: "" };
        const versions = slot.versions.map((v, idx) =>
          idx === slot.activeVersionIndex ? { ...v, reels: { ...v.reels, [reelLanguage]: partialReel } } : v
        );
        onChange({ ...slot, versions });
      }

      setReelProgress("Writing caption...");
      const { caption } = await generateRhymeReelCaption({ title, topic: slot.params.topic, age: slot.params.age });
      const reel: RhymeReel = { master, scenePrompts, caption };
      const versions = slot.versions.map((v, idx) =>
        idx === slot.activeVersionIndex ? { ...v, reels: { ...v.reels, [reelLanguage]: reel } } : v
      );
      onChange({ ...slot, versions });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBuildingReel(false);
      setReelProgress("");
    }
  }

  return (
    <div className="prompt-studio-section rhyme-poem-card">
      <div className="rhyme-poem-card-header">
        <input
          className="rhyme-poem-title-input"
          type="text"
          value={primaryTitle}
          onChange={(e) => updatePoemField({ titles: { [languages[0]]: e.target.value } })}
          placeholder="Untitled poem"
        />
        {slot.versions.length > 1 && (
          <div className="rhyme-version-pager">
            <button type="button" disabled={slot.activeVersionIndex === 0} onClick={() => setActiveVersionIndex(slot.activeVersionIndex - 1)}>
              ‹
            </button>
            <span>
              {version.label} ({slot.activeVersionIndex + 1}/{slot.versions.length})
            </span>
            <button
              type="button"
              disabled={slot.activeVersionIndex === slot.versions.length - 1}
              onClick={() => setActiveVersionIndex(slot.activeVersionIndex + 1)}
            >
              ›
            </button>
          </div>
        )}
      </div>

      {languages.map((language) => (
        <label className="field" key={language}>
          <span>Poem ({language})</span>
          <textarea
            rows={6}
            value={poem.poems[language] ?? ""}
            onChange={(e) => updatePoemField({ poems: { [language]: e.target.value } })}
          />
        </label>
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

      <div className="inline-fields">
        <button type="button" disabled={isReworking !== null} onClick={() => handleRework("regenerate")}>
          {isReworking === "regenerate" ? "Regenerating..." : "Regenerate"}
        </button>
        <button type="button" disabled={isReworking !== null} onClick={() => handleRework("optimize")}>
          {isReworking === "optimize" ? "Optimizing..." : "Optimize rhythm"}
        </button>
        <button type="button" disabled={isReworking !== null} onClick={() => handleRework("enhance")}>
          {isReworking === "enhance" ? "Enhancing..." : "Enhance"}
        </button>
      </div>

      <div className="inline-fields rhyme-poem-card-reel-controls">
        <label className="field">
          <span>Build reel for</span>
          <select value={reelLanguage} onChange={(e) => setReelLanguage(e.target.value)}>
            {languages.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="export-button" disabled={isBuildingReel} onClick={handleMakeReel}>
          {isBuildingReel ? reelProgress || "Building..." : "Make reel"}
        </button>
      </div>

      {error && <p className="export-error">{error}</p>}

      {currentReel && (
        <div className="rhyme-reel">
          <div className="rhyme-reel-card rhyme-reel-master">
            <div className="rhyme-reel-card-header">
              <span>Master style bible</span>
              <CopyButton text={currentReel.master} label="Copy" />
            </div>
            <p>{currentReel.master}</p>
          </div>

          {currentReel.scenePrompts.map((prompt, i) => (
            <div key={i} className="rhyme-reel-card rhyme-reel-scene">
              <div className="rhyme-reel-card-header">
                <span>
                  Scene {i + 1} ({formatMmSs(timed[i]?.start ?? 0)} - {formatMmSs(timed[i]?.end ?? 0)})
                </span>
                <CopyButton text={prompt} label="Copy" />
              </div>
              <p className="hint">{timed[i]?.lines[reelLanguage]}</p>
              <p>{prompt}</p>
            </div>
          ))}

          {currentReel.caption && (
            <div className="rhyme-reel-card rhyme-reel-caption">
              <div className="rhyme-reel-card-header">
                <span>Caption</span>
                <CopyButton text={currentReel.caption} label="Copy" />
              </div>
              <p>{currentReel.caption}</p>
            </div>
          )}

          <CopyButton
            text={[currentReel.master, ...currentReel.scenePrompts, currentReel.caption].filter(Boolean).join("\n\n")}
            label="Copy full reel brief"
          />
        </div>
      )}
    </div>
  );
}
