import { useEffect, useState } from "react";
import { layoutSequentialClips } from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { VIDEO_TRACK_ID } from "../state/initialProject.js";
import { getOrCreate } from "../thumbnails/cache.js";
import { generateVideoThumbnails } from "../thumbnails/videoThumbnails.js";

function SceneThumbnail({
  sourceId,
  previewUrl,
  inPoint,
  outPoint,
  isSelected,
  onClick,
}: {
  sourceId: string;
  previewUrl: string;
  inPoint: number;
  outPoint: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const [frame, setFrame] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = `video:${sourceId}:${inPoint}:${outPoint}:1`;
    getOrCreate(key, () => generateVideoThumbnails(previewUrl, inPoint, outPoint, 1))
      .then((frames) => {
        if (!cancelled && frames[0]) setFrame(frames[0]);
      })
      .catch((err) => console.error("Failed to generate scene thumbnail", err));
    return () => {
      cancelled = true;
    };
  }, [sourceId, previewUrl, inPoint, outPoint]);

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
