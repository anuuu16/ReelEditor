import type { MediaSource } from "@reel-studio/shared-types";
import { MAX_IMAGE_CLIP_DURATION_SECONDS } from "./trackAccepts.js";

function readImageMetadata(file: File, url: string): Promise<MediaSource> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        filePath: "",
        previewUrl: url,
        // Images have no intrinsic length — this is a generous ceiling for how long a clip made
        // from this image can be trimmed to, not a real duration the way video/audio have one.
        durationSeconds: MAX_IMAGE_CLIP_DURATION_SECONDS,
        width: img.naturalWidth,
        height: img.naturalHeight,
        kind: "image",
        isPlaceholder: false,
      });
    };
    img.onerror = () => reject(new Error(`Failed to read metadata for ${file.name}`));
    img.src = url;
  });
}

const DURATION_PROBE_TIMEOUT_MS = 15_000;

// Screen recordings made with MediaRecorder (Chrome's, OBS-style WebM, ...) are written without a
// duration in their header, so the browser reports `duration === Infinity` until it has actually
// seen the end of the file. A clip can't be laid out (or exported — Infinity doesn't survive JSON)
// with that, so force the browser to find the end: seeking far past it makes it scan to the real
// last timestamp, at which point `duration` becomes finite.
function resolveFiniteDuration(el: HTMLMediaElement): Promise<number> {
  if (Number.isFinite(el.duration)) return Promise.resolve(el.duration);
  return new Promise((resolve) => {
    const finish = () => {
      if (!Number.isFinite(el.duration)) return;
      cleanup();
      resolve(el.duration);
    };
    const giveUp = () => {
      cleanup();
      resolve(Number.isFinite(el.duration) ? el.duration : Number.isFinite(el.currentTime) ? el.currentTime : 0);
    };
    const timer = setTimeout(giveUp, DURATION_PROBE_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      el.removeEventListener("durationchange", finish);
      el.removeEventListener("timeupdate", finish);
      el.removeEventListener("seeked", finish);
    }
    el.addEventListener("durationchange", finish);
    el.addEventListener("timeupdate", finish);
    el.addEventListener("seeked", finish);
    el.currentTime = Number.MAX_SAFE_INTEGER;
  });
}

export function readMediaMetadata(file: File): Promise<MediaSource> {
  const url = URL.createObjectURL(file);

  if (file.type.startsWith("image/")) {
    return readImageMetadata(file, url);
  }

  return new Promise((resolve, reject) => {
    const isVideo = file.type.startsWith("video/");
    const el = document.createElement(isVideo ? "video" : "audio") as HTMLVideoElement;
    el.preload = "metadata";
    el.src = url;
    el.onloadedmetadata = () => {
      resolveFiniteDuration(el).then((durationSeconds) => {
        if (!(durationSeconds > 0)) {
          reject(new Error(`Couldn't work out how long ${file.name} is`));
          return;
        }
        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          filePath: "",
          previewUrl: url,
          durationSeconds,
          width: isVideo ? el.videoWidth : 0,
          height: isVideo ? el.videoHeight : 0,
          kind: isVideo ? "video" : "audio",
          isPlaceholder: false,
        });
      });
    };
    el.onerror = () => reject(new Error(`Failed to read metadata for ${file.name}`));
  });
}
