import { useEffect, useState } from "react";
import { CopyButton } from "./CopyButton.js";
import type { StudioAccountGroup, StudioProject, StudioScene } from "./types.js";

interface ScenePromptsListProps {
  project: StudioProject;
  onPatch: (patch: Partial<StudioProject>) => void;
}

interface AccountGroupDisplay {
  account: number;
  credits: number | null;
  scenes: StudioScene[];
}

function groupByAccount(scenes: StudioScene[], accounts: StudioAccountGroup[]): AccountGroupDisplay[] {
  const byAccount = new Map<number, StudioScene[]>();
  for (const scene of scenes) {
    const list = byAccount.get(scene.account) ?? [];
    list.push(scene);
    byAccount.set(scene.account, list);
  }
  return [...byAccount.keys()]
    .sort((a, b) => a - b)
    .map((account) => ({
      account,
      credits: accounts.find((a) => a.account === account)?.credits ?? null,
      scenes: [...(byAccount.get(account) ?? [])].sort((a, b) => a.n - b.n),
    }));
}

function blankScene(existing: StudioScene[]): StudioScene {
  const maxN = existing.reduce((max, s) => Math.max(max, s.n), 0);
  const n = maxN + 1;
  const account = existing.length ? existing[existing.length - 1].account : 1;
  return { n, clipName: `scene_${String(n).padStart(2, "0")}`, account, durationSeconds: 8, title: "", prompt: "" };
}

// Scenes doubling as the manual entry surface: generation fills this list in automatically, but
// "+ Add scene" / remove let a person who never clicked Generate build it entirely by hand.
export function ScenePromptsList({ project, onPatch }: ScenePromptsListProps) {
  const [scenes, setScenes] = useState<StudioScene[]>(project.scenes);

  useEffect(() => {
    setScenes(project.scenes);
  }, [project.scenes]);

  function updateSceneField(n: number, patch: Partial<StudioScene>) {
    setScenes((prev) => prev.map((s) => (s.n === n ? { ...s, ...patch } : s)));
  }

  function flush() {
    onPatch({ scenes });
  }

  function commit(next: StudioScene[]) {
    setScenes(next);
    onPatch({ scenes: next });
  }

  function handleAddScene() {
    commit([...scenes, blankScene(scenes)]);
  }

  function handleRemoveScene(n: number) {
    commit(scenes.filter((s) => s.n !== n));
  }

  const groups = groupByAccount(scenes, project.accounts);

  return (
    <section className="prompt-studio-section">
      <h2>Scene prompts</h2>
      <p className="hint">
        One ~8s Flow prompt per scene, grouped by account. Edit any field directly, or generate a first draft above.
      </p>

      {groups.length === 0 && <p className="hint">No scenes yet. Generate above, or add one by hand.</p>}

      {groups.map((group) => (
        <div key={group.account} className="prompt-studio-account-group">
          <div className="prompt-studio-account-header">
            <h3>
              Account {group.account}
              {group.credits !== null ? ` · ${group.credits} credits` : ""}
            </h3>
            <CopyButton text={group.scenes.map((s) => s.prompt).join("\n\n")} label="Copy all in account" />
          </div>

          {group.scenes.map((scene) => (
            <div className="prompt-studio-scene-row" key={scene.n}>
              <div className="inline-fields prompt-studio-header-row">
                <label className="field">
                  <span>Scene {scene.n} title</span>
                  <input
                    type="text"
                    value={scene.title ?? ""}
                    onChange={(e) => updateSceneField(scene.n, { title: e.target.value })}
                    onBlur={flush}
                  />
                </label>
                <label className="field">
                  <span>Clip name</span>
                  <input
                    type="text"
                    value={scene.clipName}
                    onChange={(e) => updateSceneField(scene.n, { clipName: e.target.value })}
                    onBlur={flush}
                  />
                </label>
                <label className="field">
                  <span>Start</span>
                  <input
                    type="text"
                    value={scene.timeStart ?? ""}
                    onChange={(e) => updateSceneField(scene.n, { timeStart: e.target.value })}
                    onBlur={flush}
                  />
                </label>
                <label className="field">
                  <span>End</span>
                  <input
                    type="text"
                    value={scene.timeEnd ?? ""}
                    onChange={(e) => updateSceneField(scene.n, { timeEnd: e.target.value })}
                    onBlur={flush}
                  />
                </label>
              </div>

              <label className="field">
                <span>Prompt</span>
                <textarea
                  rows={4}
                  value={scene.prompt}
                  onChange={(e) => updateSceneField(scene.n, { prompt: e.target.value })}
                  onBlur={flush}
                  placeholder="Paste or write this scene's Flow prompt..."
                />
              </label>

              <div className="inline-fields">
                <CopyButton text={scene.prompt} label="Copy prompt" />
                <button type="button" className="project-delete-button" onClick={() => handleRemoveScene(scene.n)}>
                  Remove scene
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}

      <button type="button" onClick={handleAddScene}>
        + Add scene
      </button>
    </section>
  );
}
