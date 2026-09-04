import { useNavigate } from "react-router-dom";
import { AudioEditor } from "./AudioEditor.js";

export function AudioEditorRoute() {
  const navigate = useNavigate();
  return <AudioEditor onBack={() => navigate("/")} />;
}
