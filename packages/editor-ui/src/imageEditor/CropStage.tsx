import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { CropRect } from "./renderImage.js";

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const MIN_SIZE = 0.05;

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

interface CropStageProps {
  src: string;
  crop: CropRect;
  onChange: (crop: CropRect) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function CropStage({ src, crop, onChange }: CropStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; start: CropRect } | null>(null);

  function begin(mode: DragMode, e: ReactPointerEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, start: crop };
  }

  function handleMove(e: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    const bounds = stage.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const dx = (e.clientX - drag.startX) / bounds.width;
    const dy = (e.clientY - drag.startY) / bounds.height;

    let { x, y, width, height } = drag.start;
    switch (drag.mode) {
      case "move":
        x = clamp(x + dx, 0, 1 - width);
        y = clamp(y + dy, 0, 1 - height);
        break;
      case "nw": {
        const nx = clamp(x + dx, 0, x + width - MIN_SIZE);
        const ny = clamp(y + dy, 0, y + height - MIN_SIZE);
        width += x - nx;
        height += y - ny;
        x = nx;
        y = ny;
        break;
      }
      case "ne": {
        const ny = clamp(y + dy, 0, y + height - MIN_SIZE);
        height += y - ny;
        y = ny;
        width = clamp(width + dx, MIN_SIZE, 1 - x);
        break;
      }
      case "sw": {
        const nx = clamp(x + dx, 0, x + width - MIN_SIZE);
        width += x - nx;
        x = nx;
        height = clamp(height + dy, MIN_SIZE, 1 - y);
        break;
      }
      case "se":
        width = clamp(width + dx, MIN_SIZE, 1 - x);
        height = clamp(height + dy, MIN_SIZE, 1 - y);
        break;
    }
    onChange({ x, y, width, height });
  }

  function handleUp() {
    dragRef.current = null;
  }

  const style = {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.width * 100}%`,
    height: `${crop.height * 100}%`,
  };

  return (
    <div className="crop-stage" ref={stageRef}>
      <img src={src} alt="" draggable={false} />
      <div
        className="crop-rect"
        style={style}
        onPointerDown={(e) => begin("move", e)}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
      >
        {(["nw", "ne", "sw", "se"] as DragMode[]).map((corner) => (
          <span
            key={corner}
            className={`crop-handle crop-handle-${corner}`}
            onPointerDown={(e) => begin(corner, e)}
            onPointerMove={handleMove}
            onPointerUp={handleUp}
          />
        ))}
      </div>
    </div>
  );
}
