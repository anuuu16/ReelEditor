import { useState } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import { LaunchEditorPanel } from "./LaunchEditorPanel.js";
import { ResourceList } from "./ResourceList.js";
import { ResourceUploader } from "./ResourceUploader.js";
import { RhymePoemCard } from "./RhymePoemCard.js";
import type { RhymePoemSlot } from "./rhymeTypes.js";
import type { StudioEditorProjectLink, StudioProject, StudioResource } from "./types.js";

interface RhymeWizardProps {
  project: StudioProject;
  slot: RhymePoemSlot;
  onSlotChange: (next: RhymePoemSlot) => void;
  onPatch: (patch: Partial<StudioProject>) => void;
  onOpenProject: (project: ProjectModel) => void;
  onExit: () => void;
}

type WizardStep = "poem" | "audio" | "assets" | "video" | "editor" | "final";

const STEPS: Array<{ id: WizardStep; label: string; hint: string }> = [
  { id: "poem", label: "1. Poem & prompts", hint: "Write or paste the rhyme, edit it per language, then build the Flow master and scene prompts." },
  { id: "audio", label: "2. Upload audio", hint: "Upload the voiceover or music for this rhyme, per language, once you've generated it from the prompts." },
  { id: "assets", label: "3. Cover & characters", hint: "Upload the cover, logo, banner, and character reference images that keep every scene consistent." },
  { id: "video", label: "4. Upload video", hint: "Upload the scene video clips Flow generated from the prompts, one per scene." },
  { id: "editor", label: "5. Editor", hint: "Launch (or reopen) a full timeline project per language, built from the video and audio above." },
  { id: "final", label: "6. Save final", hint: "Once you've exported from the editor, upload the finished video here, tagged by language." },
];

export function RhymeWizard({ project, slot, onSlotChange, onPatch, onOpenProject, onExit }: RhymeWizardProps) {
  const [step, setStep] = useState<WizardStep>("poem");
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
        <button type="button" onClick={onExit}>
          ← Back to poems
        </button>
        <h3>{slot.versions[slot.activeVersionIndex].poem.title || "Untitled poem"}</h3>
      </div>

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

      <p className="hint">{STEPS[stepIndex]?.hint}</p>

      {step === "poem" && <RhymePoemCard slot={slot} onChange={onSlotChange} />}

      {step === "audio" && (
        <section className="prompt-studio-section">
          <ResourceUploader project={project} onUploaded={handleResourceUploaded} allowedKinds={["sceneAudio"]} />
          <ResourceList project={project} onChanged={handleResourcesChanged} allowedKinds={["sceneAudio"]} />
        </section>
      )}

      {step === "assets" && (
        <section className="prompt-studio-section">
          <ResourceUploader
            project={project}
            onUploaded={handleResourceUploaded}
            allowedKinds={["cover", "logo", "banner", "character"]}
          />
          <ResourceList project={project} onChanged={handleResourcesChanged} allowedKinds={["cover", "logo", "banner", "character"]} />
        </section>
      )}

      {step === "video" && (
        <section className="prompt-studio-section">
          <ResourceUploader project={project} onUploaded={handleResourceUploaded} allowedKinds={["sceneVideo"]} />
          <ResourceList project={project} onChanged={handleResourcesChanged} allowedKinds={["sceneVideo"]} />
        </section>
      )}

      {step === "editor" && <LaunchEditorPanel project={project} onLinkAdded={handleLinkAdded} onOpenProject={onOpenProject} />}

      {step === "final" && (
        <section className="prompt-studio-section">
          <ResourceUploader project={project} onUploaded={handleResourceUploaded} allowedKinds={["finalExport"]} />
          <ResourceList project={project} onChanged={handleResourcesChanged} allowedKinds={["finalExport"]} />
        </section>
      )}

      <div className="inline-fields rhyme-wizard-nav">
        <button type="button" disabled={stepIndex === 0} onClick={() => setStep(STEPS[stepIndex - 1].id)}>
          ← Previous step
        </button>
        <button type="button" disabled={stepIndex === STEPS.length - 1} onClick={() => setStep(STEPS[stepIndex + 1].id)}>
          Next step →
        </button>
      </div>
    </div>
  );
}
