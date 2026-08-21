import { useState } from "react";
import { generateRhymeReelCaption, generateRhymeReelMaster, generateRhymeReelScene } from "./rhymeApi.js";
import { computeTiming, deriveScenesFromPoems, formatMmSs } from "./rhymeTiming.js";
import type { RhymePoemSlot, RhymeReel } from "./rhymeTypes.js";
import { CopyButton } from "./CopyButton.js";
import { Button, Card, SelectField } from "./ui/index.js";

interface RhymeScenesStepProps {
  slot: RhymePoemSlot;
  onChange: (next: RhymePoemSlot) => void;
}

// The scene-prompt half of what used to be RhymePoemCard: takes the topic (slot.params) and the
// lyrics written in RhymeLyricsStep as input, and writes a Flow master style bible + one prompt
// per timed scene + a caption. Deliberately reads the poem text rather than owning it, so editing
// lyrics after generating scenes (and regenerating scenes from the edit) both just work.
export function RhymeScenesStep({ slot, onChange }: RhymeScenesStepProps) {
  const [isBuildingReel, setIsBuildingReel] = useState(false);
  const [reelProgress, setReelProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reelLanguage, setReelLanguage] = useState(slot.params.languages[0] ?? "English");

  const version = slot.versions[slot.activeVersionIndex];
  const poem = version.poem;
  const languages = slot.params.languages.length ? slot.params.languages : Object.keys(poem.poems);
  const primaryTitle = poem.titles[languages[0]] ?? Object.values(poem.titles)[0] ?? "";
  const { timed } = computeTiming(poem.scenes.length ? poem.scenes : deriveScenesFromPoems(poem.poems, slot.params.scenes));
  const currentReel = version.reels?.[reelLanguage];

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
    <Card>
      <div className="mb-3.5 flex flex-wrap items-end gap-3">
        <SelectField
          label="Build reel for"
          value={reelLanguage}
          onChange={setReelLanguage}
          options={languages.map((language) => ({ value: language, label: language }))}
          className="min-w-[160px]"
        />
        <Button variant="primary" disabled={isBuildingReel} onClick={handleMakeReel}>
          {isBuildingReel ? reelProgress || "Building..." : currentReel ? "Regenerate scenes" : "Generate scenes"}
        </Button>
      </div>

      {error && <p className="mb-3.5 whitespace-pre-wrap text-xs text-ps-danger">{error}</p>}

      {currentReel ? (
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
              <p className="text-xs text-ps-muted">{timed[i]?.lines[reelLanguage]}</p>
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
      ) : (
        <p className="text-xs text-ps-muted">No scene prompts yet for {reelLanguage} — generate them from the lyrics above.</p>
      )}
    </Card>
  );
}
