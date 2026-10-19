import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ImageEditor } from "./ImageEditor.js";

// /image-editor (no id) mints a fresh project id and moves to /image-editor/:id right away, so a
// reload lands back on the same project once autosave has written it. /image-editor/:id opens
// that project — or an empty one, if nothing has been saved under the id yet.
export function ImageEditorRoute() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const freshId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (!projectId) navigate(`/image-editor/${freshId}`, { replace: true });
  }, [projectId, freshId, navigate]);

  if (!projectId) return null;
  return (
    <ImageEditor
      key={projectId}
      projectId={projectId}
      onBack={() => navigate("/images")}
      onBatchExport={(templateId) => navigate(`/batch?template=${encodeURIComponent(templateId)}`)}
    />
  );
}
