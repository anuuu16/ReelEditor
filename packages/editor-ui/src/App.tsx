import { useState } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import { Dashboard } from "./Dashboard.js";
import { Editor } from "./Editor.js";
import { ImageEditor } from "./ImageEditor.js";
import { PromptStudioView } from "./promptStudio/PromptStudioView.js";

type View = "dashboard" | "editor" | "imageEditor" | "promptStudio";

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [activeProject, setActiveProject] = useState<ProjectModel | null>(null);

  function openProject(project: ProjectModel) {
    setActiveProject(project);
    setView("editor");
  }

  if (view === "imageEditor") {
    return <ImageEditor onBack={() => setView("dashboard")} />;
  }

  if (view === "promptStudio") {
    return <PromptStudioView onBack={() => setView("dashboard")} onOpenProject={openProject} />;
  }

  if (view === "editor") {
    return <Editor initialProject={activeProject} onBackToDashboard={() => setView("dashboard")} />;
  }

  return (
    <Dashboard
      onOpenProject={openProject}
      onOpenImageEditor={() => setView("imageEditor")}
      onOpenPromptStudio={() => setView("promptStudio")}
    />
  );
}
