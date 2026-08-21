import { useState } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import { LaunchEditorPanel } from "./LaunchEditorPanel.js";
import { ResourceList } from "./ResourceList.js";
import { ResourceUploader } from "./ResourceUploader.js";
import { RhymeLyricsStep } from "./RhymeLyricsStep.js";
import { RhymeScenesStep } from "./RhymeScenesStep.js";
import type { RhymePoemSlot } from "./rhymeTypes.js";
import type { StudioEditorProjectLink, StudioProject, StudioResource } from "./types.js";
import { Button, Card } from "./ui/index.js";

interface RhymeWizardProps {
  project: StudioProject;
  slot: RhymePoemSlot;
  onSlotChange: (next: RhymePoemSlot) => void;
  onPatch: (patch: Partial<StudioProject>) => void;
  onOpenProject: (project: ProjectModel) => void;
  onExit: () => void;
  /** Which step to open on, e.g. "scenes" when re-entering a slot that already has lyrics. Defaults to "lyrics". */
  initialStep?: WizardStep;
}

type WizardStep = "lyrics" | "scenes" | "audio" | "assets" | "video" | "editor" | "final";

const STEPS: Array<{ id: WizardStep; label: string; hint: string }> = [
  { id: "lyrics", label: "1. Lyrics", hint: "Write or paste the rhyme, then edit it per language. The concept you set on the previous screen is the input here." },
  { id: "scenes", label: "2. Scene prompts", hint: "Uses the topic and the lyrics above as input to write a Flow master style bible and one prompt per timed scene." },
  { id: "audio", label: "3. Upload audio", hint: "Upload the voiceover or music for this rhyme, per language, once you've generated it from the prompts." },
  { id: "assets", label: "4. Cover & characters", hint: "Upload the cover, logo, banner, and character reference images that keep every scene consistent." },
  { id: "video", label: "5. Upload video", hint: "Upload the scene video clips Flow generated from the prompts, one per scene." },
  { id: "editor", label: "6. Editor", hint: "Launch (or reopen) a full timeline project per language, built from the video and audio above." },
  { id: "final", label: "7. Save final", hint: "Once you've exported from the editor, upload the finished video here, tagged by language." },
];

export function RhymeWizard({ project, slot, onSlotChange, onPatch, onOpenProject, onExit, initialStep }: RhymeWizardProps) {
  const [step, setStep] = useState<WizardStep>(initialStep ?? "lyrics");
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  function handleResourceUploaded(resource: StudioResource) {
    onPatch({ resources: [...project.resources, resource] });
  }

  function handleResourcesChanged(resources: StudioResource[]) {
    onPatch({ resources });
  }

  function handleLinkAdded(link: StudioEditorProjectLink) {
    onPatch({
      editorProjects: [...project.editorProjects.filter((l) => l.language !== link.language), link],
    });
  }

  return (
    <div className="rhyme-wizard">
      <div className="rhyme-wizard-header">
        <Button variant="ghost" onClick={onExit}>
          ← Back to poems
        </Button>
        <h3>{Object.values(slot.versions[slot.activeVersionIndex].poem.titles)[0] || "Untitled poem"}</h3>
      </div>

      {/* The stepper below keeps its own legacy classes: it needs an "active" vs "done" vs
          neither three-way state (done steps get a green border) that neither Chip nor Button
          can express, so re-styling it with the new primitives would lose that signal. */}
      <div className="rhyme-wizard-steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`rhyme-wizard-step${step === s.id ? " active" : ""}${i < stepIndex ? " done" : ""}`}
            onClick={() => setStep(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-ps-muted">{STEPS[stepIndex]?.hint}</p>

      {step === "lyrics" && <RhymeLyricsStep slot={slot} onChange={onSlotChange} />}

      {step === "scenes" && <RhymeScenesStep project={project} slot={slot} onChange={onSlotChange} />}

      {step === "audio" && (
        <Card>
          <ResourceUploader project={project} onUploaded={handleResourceUploaded} allowedKinds={["sceneAudio"]} />
          <ResourceList project={project} onChanged={handleResourcesChanged} allowedKinds={["sceneAudio"]} />
        </Card>
      )}

      {step === "assets" && (
        <Card>
          <ResourceUploader
            project={project}
            onUploaded={handleResourceUploaded}
            allowedKinds={["cover", "logo", "banner", "character"]}
          />
          <ResourceList project={project} onChanged={handleResourcesChanged} allowedKinds={["cover", "logo", "banner", "character"]} />
        </Card>
      )}

      {step === "video" && (
        <Card>
          <ResourceUploader project={project} onUploaded={handleResourceUploaded} allowedKinds={["sceneVideo"]} />
          <ResourceList project={project} onChanged={handleResourcesChanged} allowedKinds={["sceneVideo"]} />
        </Card>
      )}

      {step === "editor" && <LaunchEditorPanel project={project} onLinkAdded={handleLinkAdded} onOpenProject={onOpenProject} />}

      {step === "final" && (
        <Card>
          <ResourceUploader project={project} onUploaded={handleResourceUploaded} allowedKinds={["finalExport"]} />
          <ResourceList project={project} onChanged={handleResourcesChanged} allowedKinds={["finalExport"]} />
        </Card>
      )}

      <div className="rhyme-wizard-nav flex flex-wrap gap-1.5">
        <Button disabled={stepIndex === 0} onClick={() => setStep(STEPS[stepIndex - 1].id)}>
          ← Previous step
        </Button>
        <Button disabled={stepIndex === STEPS.length - 1} onClick={() => setStep(STEPS[stepIndex + 1].id)}>
          Next step →
        </Button>
      </div>
    </div>
  );
}
