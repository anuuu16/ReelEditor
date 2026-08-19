import { useState } from "react";
import { AddTitleButton } from "./components/AddTitleButton.js";
import { AspectSelector } from "./components/AspectSelector.js";
import { BrandKitPanel } from "./components/BrandKitPanel.js";
import { ExportPanel } from "./components/ExportPanel.js";
import { Inspector } from "./components/Inspector.js";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts.js";
import { MediaLibrary } from "./components/MediaLibrary.js";
import { PreviewCanvas } from "./components/PreviewCanvas.js";
import { ProjectsPanel } from "./components/ProjectsPanel.js";
import { ProjectTitle } from "./components/ProjectTitle.js";
import { ResizeHandle } from "./components/ResizeHandle.js";
import { SaveStatus } from "./components/SaveStatus.js";
import { SceneStrip } from "./components/SceneStrip.js";
import { ShortcutsHelp } from "./components/ShortcutsHelp.js";
import { Timeline } from "./components/Timeline.js";
import { Transport } from "./components/Transport.js";
import { EditorProvider } from "./state/EditorContext.js";

const MEDIA_LIBRARY_WIDTH_RANGE = [180, 480] as const;
const INSPECTOR_WIDTH_RANGE = [200, 480] as const;
const BOTTOM_BAR_HEIGHT_RANGE = [160, 600] as const;

function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, value));
}

function usePersistedSize(key: string, defaultValue: number): [number, (updater: (prev: number) => number) => void] {
  const [value, setValue] = useState(() => {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 ? stored : defaultValue;
  });
  function update(updater: (prev: number) => number) {
    setValue((prev) => {
      const next = updater(prev);
      localStorage.setItem(key, String(next));
      return next;
    });
  }
  return [value, update];
}

export function App() {
  const [mediaLibraryWidth, setMediaLibraryWidth] = usePersistedSize("panelWidth:mediaLibrary", 260);
  const [inspectorWidth, setInspectorWidth] = usePersistedSize("panelWidth:inspector", 260);
  const [bottomBarHeight, setBottomBarHeight] = usePersistedSize("panelHeight:bottomBar", 260);

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
            <BrandKitPanel />
            <ProjectsPanel />
            <ExportPanel />
            <ShortcutsHelp />
          </div>
        </header>
        <div className="app-body">
          <div className="panel-sizer" style={{ width: mediaLibraryWidth }}>
            <MediaLibrary />
          </div>
          <ResizeHandle
            orientation="vertical"
            title="Drag to resize the media library"
            onResize={(delta) => setMediaLibraryWidth((w) => clamp(w + delta, MEDIA_LIBRARY_WIDTH_RANGE))}
          />
          <PreviewCanvas />
          <ResizeHandle
            orientation="vertical"
            title="Drag to resize the inspector"
            onResize={(delta) => setInspectorWidth((w) => clamp(w - delta, INSPECTOR_WIDTH_RANGE))}
          />
          <div className="panel-sizer" style={{ width: inspectorWidth }}>
            <Inspector />
          </div>
        </div>
        <ResizeHandle
          orientation="horizontal"
          title="Drag to resize the bottom panel"
          onResize={(delta) => setBottomBarHeight((h) => clamp(h - delta, BOTTOM_BAR_HEIGHT_RANGE))}
        />
        <div className="bottom-bar" style={{ height: bottomBarHeight }}>
          <Transport />
          <div className="timeline-sizer">
            <Timeline />
          </div>
        </div>
      </div>
    </EditorProvider>
  );
}
