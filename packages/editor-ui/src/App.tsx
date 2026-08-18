import { AddTitleButton } from "./components/AddTitleButton.js";
import { AspectSelector } from "./components/AspectSelector.js";
import { ExportPanel } from "./components/ExportPanel.js";
import { Inspector } from "./components/Inspector.js";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts.js";
import { MediaLibrary } from "./components/MediaLibrary.js";
import { PreviewCanvas } from "./components/PreviewCanvas.js";
import { ProjectsPanel } from "./components/ProjectsPanel.js";
import { ProjectTitle } from "./components/ProjectTitle.js";
import { SaveStatus } from "./components/SaveStatus.js";
import { SceneStrip } from "./components/SceneStrip.js";
import { Timeline } from "./components/Timeline.js";
import { Transport } from "./components/Transport.js";
import { EditorProvider } from "./state/EditorContext.js";

export function App() {
  return (
    <EditorProvider>
      <KeyboardShortcuts />
      <div className="app">
        <header className="app-header">
          <ProjectTitle />
          <SceneStrip />
          <div className="app-header-right">
            <AddTitleButton />
            <AspectSelector />
            <SaveStatus />
            <ProjectsPanel />
            <ExportPanel />
          </div>
        </header>
        <div className="app-body">
          <MediaLibrary />
          <PreviewCanvas />
          <Inspector />
        </div>
        <Transport />
        <Timeline />
      </div>
    </EditorProvider>
  );
}
