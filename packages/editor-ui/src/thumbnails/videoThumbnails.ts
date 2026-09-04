const THUMB_WIDTH = 80;

export function generateVideoThumbnails(previewUrl: string, inPoint: number, outPoint: number, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (!previewUrl || count <= 0) {
      resolve([]);
      return;
    }

    const video = document.createElement("video");
    // Most previewUrls are same-origin blob: URLs (project media is fetched and rehydrated to one),
    // but a Studio-origin source's previewUrl points straight at a cross-origin render-service URL.
    // Without this, drawing that frame into the canvas below taints it — crossOrigin is a no-op for
    // blob: URLs, so it's safe to always set (render-service already sends a permissive
    // Access-Control-Allow-Origin, this is the missing client-side half of CORS-enabling the load).
    video.crossOrigin = "anonymous";
    video.src = previewUrl;
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;

    const span = Math.max(outPoint - inPoint, 0.001);
    const lastSafeTime = Math.max(outPoint - 0.05, inPoint);
    const timestamps: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? inPoint : inPoint + (span * i) / (count - 1);
      timestamps.push(Math.min(t, lastSafeTime));
    }

    const frames: string[] = [];
    let canvas: HTMLCanvasElement | null = null;
    let frameIndex = 0;

    function captureNext() {
      if (frameIndex >= timestamps.length) {
        resolve(frames);
        return;
      }
      video.currentTime = timestamps[frameIndex];
    }

    video.onloadedmetadata = () => {
      const aspect = video.videoWidth / video.videoHeight || 9 / 16;
      canvas = document.createElement("canvas");
      canvas.width = THUMB_WIDTH;
      canvas.height = Math.round(THUMB_WIDTH / aspect);
      captureNext();
    };

    video.onseeked = () => {
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          // A tainted canvas (a cross-origin frame the crossOrigin attribute above didn't manage to
          // CORS-clean, e.g. a server not actually sending the header) throws here — without this,
          // that throw happens inside an event handler with no catcher, so the promise never
          // settles and every caller waits on it forever instead of just missing this one frame.
          try {
            frames.push(canvas.toDataURL("image/jpeg", 0.6));
          } catch (err) {
            console.error("Failed to capture video thumbnail frame (tainted canvas?)", err);
          }
        }
      }
      frameIndex++;
      captureNext();
    };

    video.onerror = () => reject(new Error("Failed to load video for thumbnails"));
  });
}

export function generateImageThumbnail(previewUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!previewUrl) {
      resolve(null);
      return;
    }
    const img = new Image();
    // See the matching comment in generateVideoThumbnails: needed for Studio-origin (cross-origin)
    // sources, harmless no-op for same-origin blob: URLs.
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const aspect = img.naturalWidth / img.naturalHeight || 9 / 16;
      const canvas = document.createElement("canvas");
      canvas.width = THUMB_WIDTH;
      canvas.height = Math.round(THUMB_WIDTH / aspect);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Same tainted-canvas guard as the video path — resolve null instead of hanging forever.
      try {
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      } catch (err) {
        console.error("Failed to capture image thumbnail (tainted canvas?)", err);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = previewUrl;
  });
}
