import { useState } from "react";
import { generateRhymeReelCaption, generateRhymeReelMaster, generateRhymeReelScene, reworkRhymePoem } from "./rhymeApi.js";
import { computeTiming, deriveScenesFromPoem, formatMmSs } from "./rhymeTiming.js";
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

  const version = slot.versions[slot.activeVersionIndex];
  const poem = version.poem;
  const bilingual = !!poem.poem2;
  const { timed, total } = computeTiming(poem.scenes.length ? poem.scenes : deriveScenesFromPoem(poem.poem, slot.params.scenes));

  function updateActiveVersion(patch: Partial<RhymePoemVersion["poem"]>) {
    const versions = slot.versions.map((v, i) =>
      i === slot.activeVersionIndex ? { ...v, poem: { ...v.poem, ...patch } } : v
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
      const existingTitles = slot.versions.map((v) => v.poem.title);
      const reworked = await reworkRhymePoem({
        ...slot.params,
        kind,
        avoidTitles: kind === "regenerate" ? existingTitles : slot.params.avoidTitles,
        current: { title: poem.title, title2: poem.title2, poem: poem.poem, poem2: poem.poem2 },
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
      setReelProgress("Writing master style bible...");
      const { master } = await generateRhymeReelMaster({ title: poem.title, topic: slot.params.topic, age: slot.params.age });

      const scenePrompts: string[] = [];
      for (let i = 0; i < timed.length; i++) {
        setReelProgress(`Writing scene ${i + 1} of ${timed.length}...`);
        const seg = timed[i];
        const { prompt } = await generateRhymeReelScene({
          master,
          seg: { lines: seg.lines, lines2: seg.lines2, dur: seg.end - seg.start },
          idx: i,
          total: timed.length,
          lang: slot.params.lang,
          lang2: slot.params.lang2,
        });
        scenePrompts.push(prompt);
        const partialReel: RhymeReel = { master, scenePrompts: [...scenePrompts], caption: "" };
        const versions = slot.versions.map((v, idx) => (idx === slot.activeVersionIndex ? { ...v, reel: partialReel } : v));
        onChange({ ...slot, versions });
      }

      setReelProgress("Writing caption...");
      const { caption } = await generateRhymeReelCaption({ title: poem.title, topic: slot.params.topic, age: slot.params.age });
      const reel: RhymeReel = { master, scenePrompts, caption };
      const versions = slot.versions.map((v, idx) => (idx === slot.activeVersionIndex ? { ...v, reel } : v));
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
          value={poem.title}
          onChange={(e) => updateActiveVersion({ title: e.target.value })}
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

      <label className="field">
        <span>Poem ({slot.params.lang})</span>
        <textarea rows={6} value={poem.poem} onChange={(e) => updateActiveVersion({ poem: e.target.value })} />
      </label>

      {bilingual && (
        <label className="field">
          <span>Poem ({slot.params.lang2})</span>
          <textarea rows={6} value={poem.poem2 ?? ""} onChange={(e) => updateActiveVersion({ poem2: e.target.value })} />
        </label>
      )}

      <div className="rhyme-timeline">
        <h4>Scenes ({formatMmSs(total)} total)</h4>
        {timed.map((seg, i) => (
          <div key={i} className="rhyme-timeline-row">
            <span className="rhyme-timeline-range">
              {formatMmSs(seg.start)} - {formatMmSs(seg.end)}
            </span>
            <div className="rhyme-timeline-lines">
              <span>{seg.lines}</span>
              {seg.lines2 && <span className="rhyme-timeline-lines2">{seg.lines2}</span>}
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
        <button type="button" className="export-button" disabled={isBuildingReel} onClick={handleMakeReel}>
          {isBuildingReel ? reelProgress || "Building..." : "Make reel"}
        </button>
      </div>

      {error && <p className="export-error">{error}</p>}

      {version.reel && (
        <div className="rhyme-reel">
          <div className="rhyme-reel-card rhyme-reel-master">
            <div className="rhyme-reel-card-header">
              <span>Master style bible</span>
              <CopyButton text={version.reel.master} label="Copy" />
            </div>
            <p>{version.reel.master}</p>
          </div>

          {version.reel.scenePrompts.map((prompt, i) => (
            <div key={i} className="rhyme-reel-card rhyme-reel-scene">
              <div className="rhyme-reel-card-header">
                <span>
                  Scene {i + 1} ({formatMmSs(timed[i]?.start ?? 0)} - {formatMmSs(timed[i]?.end ?? 0)})
                </span>
                <CopyButton text={prompt} label="Copy" />
              </div>
              <p className="hint">{timed[i]?.lines}</p>
              <p>{prompt}</p>
            </div>
          ))}

          {version.reel.caption && (
            <div className="rhyme-reel-card rhyme-reel-caption">
              <div className="rhyme-reel-card-header">
                <span>Caption</span>
                <CopyButton text={version.reel.caption} label="Copy" />
              </div>
              <p>{version.reel.caption}</p>
            </div>
          )}

          <CopyButton
            text={[version.reel.master, ...version.reel.scenePrompts, version.reel.caption].filter(Boolean).join("\n\n")}
            label="Copy full reel brief"
          />
        </div>
      )}
    </div>
  );
}
