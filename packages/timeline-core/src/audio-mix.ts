export interface VolumeInput {
  volume: number;
  muted: boolean;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Shared by audio volume and video opacity — a clip's fadeInSeconds/fadeOutSeconds drive both,
// so "fade to black" (video) and its audio fade happen in perfect lockstep, same clip fields,
// same ramp.
export function computeFadeMultiplier(fadeInSeconds: number, fadeOutSeconds: number, positionInClip: number, clipDuration: number): number {
  if (clipDuration <= 0) return 1;

  const fadeIn = Math.min(Math.max(fadeInSeconds, 0), clipDuration / 2);
  const fadeOut = Math.min(Math.max(fadeOutSeconds, 0), clipDuration / 2);

  let multiplier = 1;
  if (fadeIn > 0 && positionInClip < fadeIn) {
    multiplier = Math.min(multiplier, positionInClip / fadeIn);
  }
  const timeFromEnd = clipDuration - positionInClip;
  if (fadeOut > 0 && timeFromEnd < fadeOut) {
    multiplier = Math.min(multiplier, timeFromEnd / fadeOut);
  }
  return clamp01(multiplier);
}

export function computeEffectiveVolume(clip: VolumeInput, positionInClip: number, clipDuration: number): number {
  if (clip.muted) return 0;
  if (clipDuration <= 0) return clamp01(clip.volume);
  return clamp01(clip.volume) * computeFadeMultiplier(clip.fadeInSeconds, clip.fadeOutSeconds, positionInClip, clipDuration);
}
