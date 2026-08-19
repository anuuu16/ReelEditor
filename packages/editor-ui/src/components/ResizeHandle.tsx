import { useRef, type PointerEvent as ReactPointerEvent } from "react";

interface ResizeHandleProps {
  orientation: "vertical" | "horizontal";
  onResize: (deltaPx: number) => void;
  title?: string;
}

// "vertical" = a vertical bar you drag left/right to resize a width (media library / inspector).
// "horizontal" = a horizontal bar you drag up/down to resize a height (timeline).
export function ResizeHandle({ orientation, onResize, title }: ResizeHandleProps) {
  const lastPos = useRef<number | null>(null);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    lastPos.current = orientation === "vertical" ? e.clientX : e.clientY;
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (lastPos.current === null) return;
    const pos = orientation === "vertical" ? e.clientX : e.clientY;
    onResize(pos - lastPos.current);
    lastPos.current = pos;
  }

  function handlePointerUp() {
    lastPos.current = null;
  }

  return (
    <div
      className={`resize-handle resize-handle-${orientation}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title={title}
    />
  );
}
