import { useState } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import { Dashboard } from "./Dashboard.js";
import { Editor } from "./Editor.js";
import { ImageResizer } from "./ImageResizer.js";

type View = "dashboard" | "editor" | "resizer";

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [activeProject, setActiveProject] = useState<ProjectModel | null>(null);

  function openProject(project: ProjectModel) {
    setActiveProject(project);
    setView("editor");
  }

  if (view === "resizer") {
    return <ImageResizer onBack={() => setView("dashboard")} />;
  }

  if (view === "editor") {
    return <Editor initialProject={activeProject} onBackToDashboard={() => setView("dashboard")} />;
  }

  return <Dashboard onOpenProject={openProject} onOpenResizer={() => setView("resizer")} />;
}
