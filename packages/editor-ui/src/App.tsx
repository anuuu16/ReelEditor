import { AspectSelector } from "./components/AspectSelector.js";
import { ClipInspector } from "./components/ClipInspector.js";
import { ExportPanel } from "./components/ExportPanel.js";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts.js";
import { MediaLibrary } from "./components/MediaLibrary.js";
import { PreviewCanvas } from "./components/PreviewCanvas.js";
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
            <AspectSelector />
            <SaveStatus />
            <ExportPanel />
          </div>
        </header>
        <div className="app-body">
          <MediaLibrary />
          <PreviewCanvas />
          <ClipInspector />
        </div>
        <Transport />
        <Timeline />
      </div>
    </EditorProvider>
  );
}
