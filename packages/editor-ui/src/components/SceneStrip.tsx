import { useEffect, useState } from "react";
import { layoutSequentialClips } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { VIDEO_TRACK_ID } from "../state/initialProject.js";
import { getOrCreate } from "../thumbnails/cache.js";
import { generateImageThumbnail, generateVideoThumbnails } from "../thumbnails/videoThumbnails.js";

function SceneThumbnail({
  sourceId,
  kind,
  previewUrl,
  inPoint,
  outPoint,
  isSelected,
  onClick,
}: {
  sourceId: string;
  kind: "video" | "audio" | "image";
  previewUrl: string;
  inPoint: number;
  outPoint: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const [frame, setFrame] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A still on the video track (slideshow) is an image, not a video — it can't be decoded for frames.
    const key = kind === "image" ? `scene:image:${sourceId}` : `scene:video:${sourceId}:${inPoint}:${outPoint}`;
    const generate: () => Promise<string | null> =
      kind === "image"
        ? () => generateImageThumbnail(previewUrl)
        : () => generateVideoThumbnails(previewUrl, inPoint, outPoint, 1).then((frames) => frames[0] ?? null);
    getOrCreate(key, generate)
      .then((first) => {
        if (!cancelled && first) setFrame(first);
      })
      .catch((err) => console.error("Failed to generate scene thumbnail", err));
    return () => {
      cancelled = true;
    };
  }, [sourceId, kind, previewUrl, inPoint, outPoint]);

  return (
    <button type="button" className={`scene-thumb${isSelected ? " selected" : ""}`} onClick={onClick}>
      {frame && <img src={frame} alt="" draggable={false} />}
    </button>
  );
}

export function SceneStrip() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const clips = layoutSequentialClips(state.project.clips.filter((c) => c.trackId === VIDEO_TRACK_ID));

  if (clips.length === 0) return null;

  return (
    <div className="scene-strip">
      {clips.map((clip) => {
        const source = state.project.sources.find((s) => s.id === clip.sourceId);
        if (!source) return null;
        return (
          <SceneThumbnail
            key={clip.id}
            sourceId={source.id}
            kind={source.kind}
            previewUrl={source.previewUrl}
            inPoint={clip.inPoint}
            outPoint={clip.outPoint}
            isSelected={state.selectedClipId === clip.id}
            onClick={() => {
              dispatch({ type: "SELECT_CLIP", clipId: clip.id });
              dispatch({ type: "SET_PLAYHEAD", time: clip.timelineStart });
            }}
          />
        );
      })}
    </div>
  );
}
