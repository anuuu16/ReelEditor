import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * The largest box of aspect `width:height` that fits inside the host element — tracked live with
 * a ResizeObserver. Canvases are drawn at full output resolution and scaled by CSS to this size,
 * so anything overlaid on them (selection handles, a compare divider) shares exact bounds.
 */
export function useFittedSize(
  hostRef: RefObject<HTMLElement>,
  width: number,
  height: number,
): { displayW: number; displayH: number; scale: number } {
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setHostSize({ width: rect.width, height: rect.height });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [hostRef]);

  const scale = hostSize.width > 0 && hostSize.height > 0 ? Math.min(hostSize.width / width, hostSize.height / height) : 0;
  return { displayW: width * scale, displayH: height * scale, scale };
}
