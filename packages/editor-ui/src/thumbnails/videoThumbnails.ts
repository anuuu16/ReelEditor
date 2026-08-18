const THUMB_WIDTH = 80;

export function generateVideoThumbnails(previewUrl: string, inPoint: number, outPoint: number, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (!previewUrl || count <= 0) {
      resolve([]);
      return;
    }

    const video = document.createElement("video");
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
          frames.push(canvas.toDataURL("image/jpeg", 0.6));
        }
      }
      frameIndex++;
      captureNext();
    };

    video.onerror = () => reject(new Error("Failed to load video for thumbnails"));
  });
}
