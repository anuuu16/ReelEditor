import { useNavigate } from "react-router-dom";
import { ImageEditor } from "./ImageEditor.js";

export function ImageEditorRoute() {
  const navigate = useNavigate();
  return <ImageEditor onBack={() => navigate("/")} />;
}
