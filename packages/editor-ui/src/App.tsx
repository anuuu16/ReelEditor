import { Navigate, Route, Routes } from "react-router-dom";
import { Dashboard } from "./Dashboard.js";
import { EditorRoute } from "./EditorRoute.js";
import { ImageEditorRoute } from "./ImageEditorRoute.js";
import { AudioEditorRoute } from "./AudioEditorRoute.js";
import { PromptStudioRoute } from "./promptStudio/PromptStudioRoute.js";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/image-editor" element={<ImageEditorRoute />} />
      <Route path="/audio-editor" element={<AudioEditorRoute />} />
      <Route path="/editor" element={<EditorRoute />} />
      <Route path="/editor/:projectId" element={<EditorRoute />} />
      <Route path="/prompt-studio/:studioId" element={<PromptStudioRoute />} />
      <Route path="/prompt-studio/:studioId/:tab" element={<PromptStudioRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
