import { useEffect, useState } from "react";
import { CopyButton } from "./CopyButton.js";
import type { StudioAccountGroup, StudioProject, StudioScene } from "./types.js";
import { Button, Card, TextField, TextareaField } from "./ui/index.js";

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
    <Card title="Scene prompts" hint="One ~8s Flow prompt per scene, grouped by account. Edit any field directly, or generate a first draft above.">
      {groups.length === 0 && <p className="mb-3.5 text-xs text-ps-muted">No scenes yet. Generate above, or add one by hand.</p>}

      {groups.map((group, groupIndex) => (
        <div key={group.account} className={groupIndex > 0 ? "mt-3.5 border-t border-ps-border pt-3.5" : ""}>
          <div className="mb-2.5 flex items-center justify-between gap-2.5">
            <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-ps-muted">
              Account {group.account}
              {group.credits !== null ? ` · ${group.credits} credits` : ""}
            </h3>
            <CopyButton text={group.scenes.map((s) => s.prompt).join("\n\n")} label="Copy all in account" />
          </div>

          {group.scenes.map((scene) => (
            <div className="mb-2.5 rounded-ps border border-ps-border bg-ps-elevated p-3" key={scene.n}>
              <div className="mb-3.5 flex flex-wrap gap-3">
                <TextField
                  label={`Scene ${scene.n} title`}
                  value={scene.title ?? ""}
                  onChange={(value) => updateSceneField(scene.n, { title: value })}
                  onBlur={flush}
                  className="min-w-[160px] flex-1"
                />
                <TextField
                  label="Clip name"
                  value={scene.clipName}
                  onChange={(value) => updateSceneField(scene.n, { clipName: value })}
                  onBlur={flush}
                  className="min-w-[160px] flex-1"
                />
                <TextField
                  label="Start"
                  value={scene.timeStart ?? ""}
                  onChange={(value) => updateSceneField(scene.n, { timeStart: value })}
                  onBlur={flush}
                  className="min-w-[100px] flex-1"
                />
                <TextField
                  label="End"
                  value={scene.timeEnd ?? ""}
                  onChange={(value) => updateSceneField(scene.n, { timeEnd: value })}
                  onBlur={flush}
                  className="min-w-[100px] flex-1"
                />
              </div>

              <TextareaField
                label="Prompt"
                rows={4}
                value={scene.prompt}
                onChange={(value) => updateSceneField(scene.n, { prompt: value })}
                onBlur={flush}
                placeholder="Paste or write this scene's Flow prompt..."
                className="mb-3.5"
              />

              <div className="flex flex-wrap items-center gap-1.5">
                <CopyButton text={scene.prompt} label="Copy prompt" />
                <Button variant="danger" onClick={() => handleRemoveScene(scene.n)}>
                  Remove scene
                </Button>
              </div>
            </div>
          ))}
        </div>
      ))}

      <Button onClick={handleAddScene} className="mt-1">
        + Add scene
      </Button>
    </Card>
  );
}
