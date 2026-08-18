import { AspectSelector } from "./components/AspectSelector.js";
import { MediaLibrary } from "./components/MediaLibrary.js";
import { PreviewCanvas } from "./components/PreviewCanvas.js";
import { Timeline } from "./components/Timeline.js";
import { Transport } from "./components/Transport.js";
import { EditorProvider } from "./state/EditorContext.js";

export function App() {
  return (
    <EditorProvider>
      <div className="app">
        <header className="app-header">
          <h1>Reel Studio</h1>
          <AspectSelector />
        </header>
        <div className="app-body">
          <MediaLibrary />
          <PreviewCanvas />
        </div>
        <Transport />
        <Timeline />
      </div>
    </EditorProvider>
  );
}
