import { useState } from "react";
import { accountForScene, buildAccounts } from "./creditMath.js";
import { buildRhymeReelPromptTemplate, parseRhymeReelJson } from "./rhymeImportExport.js";
import {
  generateRhymeReelCaption,
  generateRhymeReelCharacter,
  generateRhymeReelCover,
  generateRhymeReelMaster,
  generateRhymeReelScene,
} from "./rhymeApi.js";
import { computeTiming, deriveScenesFromPoems, formatMmSs } from "./rhymeTiming.js";
import type { RhymePoemSlot, RhymeReel } from "./rhymeTypes.js";
import type { StudioProject } from "./types.js";
import { CopyButton } from "./CopyButton.js";
import { Button, Card, SelectField, TextareaField } from "./ui/index.js";

interface RhymeScenesStepProps {
  project: StudioProject;
  slot: RhymePoemSlot;
  onChange: (next: RhymePoemSlot) => void;
}

// The scene-prompt half of what used to be RhymePoemCard: takes the topic (slot.params) and the
// lyrics written in RhymeLyricsStep as input, and writes a Flow master style bible, a character
// reference prompt, a cover/thumbnail prompt, one prompt per timed scene, and a caption.
// Deliberately reads the poem text rather than owning it, so editing lyrics after generating scenes
// (and regenerating scenes from the edit) both just work.
export function RhymeScenesStep({ project, slot, onChange }: RhymeScenesStepProps) {
  const [isBuildingReel, setIsBuildingReel] = useState(false);
  const [reelProgress, setReelProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reelLanguage, setReelLanguage] = useState(slot.params.languages[0] ?? "English");
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const version = slot.versions[slot.activeVersionIndex];
  const poem = version.poem;
  const languages = slot.params.languages.length ? slot.params.languages : Object.keys(poem.poems);
  const primaryTitle = poem.titles[languages[0]] ?? Object.values(poem.titles)[0] ?? "";
  const { timed } = computeTiming(poem.scenes.length ? poem.scenes : deriveScenesFromPoems(poem.poems, slot.params.scenes));
  const currentReel = version.reels?.[reelLanguage];
  // Which Flow account each scene belongs to, purely derived from the project's own credits
  // settings — not stored, so it never drifts from Settings the way a saved copy could.
  const accounts = buildAccounts(timed.length, project.creditsPerAccount, project.creditsPerClip);

  // Writes a full RhymeReel (not a patch) into the slot. handleMakeReel accumulates the growing
  // reel in a local variable and passes the whole thing here each step — deriving "base" from
  // `slot`/`version` instead (as an earlier version of this function did) reads a stale closure
  // mid-generation: onChange triggers a re-render with new props, but the already-running async
  // handleMakeReel keeps using the slot/version values from when it started, so every field set
  // earlier in the same run (master, characterPrompt, ...) would get silently reverted back to
  // whatever existed *before generation began* on each subsequent update — exactly the "generates
  // some, then removes it" symptom.
  function applyReel(reel: RhymeReel) {
    const versions = slot.versions.map((v, idx) =>
      idx === slot.activeVersionIndex ? { ...v, reels: { ...v.reels, [reelLanguage]: reel } } : v
    );
    onChange({ ...slot, versions });
  }

  async function handleMakeReel() {
    setIsBuildingReel(true);
    setError(null);
    try {
      const title = poem.titles[reelLanguage] ?? primaryTitle;
      const base = {
        title,
        topic: slot.params.topic,
        age: slot.params.age,
        poemText: poem.poems[reelLanguage] ?? "",
        aspectRatio: project.aspectRatio,
      };
      let reel: RhymeReel = { master: "", characterPrompt: "", coverPrompt: "", scenePrompts: [], caption: "" };

      setReelProgress("Writing master style bible...");
      const { master } = await generateRhymeReelMaster(base);
      reel = { ...reel, master };
      applyReel(reel);

      setReelProgress("Writing character reference prompt...");
      const { prompt: characterPrompt } = await generateRhymeReelCharacter({ ...base, master });
      reel = { ...reel, characterPrompt };
      applyReel(reel);

      setReelProgress("Writing cover/thumbnail prompt...");
      const { prompt: coverPrompt } = await generateRhymeReelCover({ ...base, master });
      reel = { ...reel, coverPrompt };
      applyReel(reel);

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
          aspectRatio: project.aspectRatio,
        });
        scenePrompts.push(prompt);
        reel = { ...reel, scenePrompts: [...scenePrompts] };
        applyReel(reel);
      }

      setReelProgress("Writing caption...");
      const { caption } = await generateRhymeReelCaption(base);
      reel = { ...reel, caption };
      applyReel(reel);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBuildingReel(false);
      setReelProgress("");
    }
  }

  const reelPromptTemplate = buildRhymeReelPromptTemplate({
    title: poem.titles[reelLanguage] ?? primaryTitle,
    topic: slot.params.topic,
    age: slot.params.age,
    poemText: poem.poems[reelLanguage] ?? "",
    scenes: timed.map((seg) => ({ lines: seg.lines[reelLanguage] ?? "", seconds: seg.end - seg.start })),
    aspectRatio: project.aspectRatio,
  });

  function handleImportReel() {
    setPasteError(null);
    try {
      applyReel(parseRhymeReelJson(pasteText));
      setPasteText("");
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
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

      {accounts.length > 0 && (
        <div className="mb-3.5 flex flex-col gap-1.5">
          <p className="text-xs text-ps-muted">
            {timed.length} scene{timed.length === 1 ? "" : "s"} across {accounts.length} Flow account{accounts.length === 1 ? "" : "s"}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {accounts.map((a) => {
              const accountPrompts = currentReel?.scenePrompts.slice(a.sceneRange[0] - 1, a.sceneRange[1]) ?? [];
              return (
                <div key={a.account} className="flex items-center gap-1.5 rounded-ps border border-ps-border px-2 py-1 text-xs text-ps-muted">
                  <span>
                    Account {a.account}: scenes {a.sceneRange[0]}-{a.sceneRange[1]} ({a.clips})
                  </span>
                  <CopyButton text={accountPrompts.join("\n\n")} label="Copy" disabled={accountPrompts.length === 0} />
                </div>
              );
            })}
          </div>
        </div>
      )}

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

          {currentReel.characterPrompt && (
            <div className="rhyme-reel-card rhyme-reel-character">
              <div className="rhyme-reel-card-header">
                <span>Character reference</span>
                <CopyButton text={currentReel.characterPrompt} label="Copy" />
              </div>
              <p>{currentReel.characterPrompt}</p>
            </div>
          )}

          {currentReel.coverPrompt && (
            <div className="rhyme-reel-card rhyme-reel-cover">
              <div className="rhyme-reel-card-header">
                <span>Cover / thumbnail</span>
                <CopyButton text={currentReel.coverPrompt} label="Copy" />
              </div>
              <p>{currentReel.coverPrompt}</p>
            </div>
          )}

          {currentReel.scenePrompts.map((prompt, i) => (
            <div key={i} className="rhyme-reel-card rhyme-reel-scene">
              <div className="rhyme-reel-card-header">
                <span>
                  Scene {i + 1} ({formatMmSs(timed[i]?.start ?? 0)} - {formatMmSs(timed[i]?.end ?? 0)}) · Account{" "}
                  {accountForScene(accounts, i + 1)}
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
            text={[currentReel.master, currentReel.characterPrompt, currentReel.coverPrompt, ...currentReel.scenePrompts, currentReel.caption]
              .filter(Boolean)
              .join("\n\n")}
            label="Copy full reel brief"
          />
        </div>
      ) : (
        <p className="text-xs text-ps-muted">No scene prompts yet for {reelLanguage} — generate them from the lyrics above.</p>
      )}
    </Card>

    <Card
      title="Use any AI chat"
      hint="Copy this prompt into Claude, ChatGPT, or anywhere else, then paste back the JSON it gives you as the reel for this language."
    >
      <TextareaField label="Prompt to copy into any AI chat" rows={6} readOnly value={reelPromptTemplate} onChange={() => {}} className="mb-2" />
      <div className="mb-3.5">
        <CopyButton text={reelPromptTemplate} label="Copy prompt" />
      </div>
      <TextareaField
        label="Paste the JSON it gives you back"
        rows={6}
        value={pasteText}
        onChange={setPasteText}
        placeholder='{"master":"...","characterPrompt":"...","coverPrompt":"...","scenePrompts":["...", ...],"caption":"..."}'
        className="mb-3.5"
      />
      <Button variant="primary" onClick={handleImportReel} disabled={!pasteText.trim()}>
        Import reel
      </Button>
      {pasteError && <p className="mt-3 whitespace-pre-wrap text-xs text-ps-danger">{pasteError}</p>}
    </Card>
    </>
  );
}
