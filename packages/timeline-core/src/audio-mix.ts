export interface VolumeInput {
  volume: number;
  muted: boolean;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function computeEffectiveVolume(clip: VolumeInput, positionInClip: number, clipDuration: number): number {
  if (clip.muted) return 0;
  if (clipDuration <= 0) return clamp01(clip.volume);

  const fadeIn = Math.min(Math.max(clip.fadeInSeconds, 0), clipDuration / 2);
  const fadeOut = Math.min(Math.max(clip.fadeOutSeconds, 0), clipDuration / 2);

  let multiplier = 1;
  if (fadeIn > 0 && positionInClip < fadeIn) {
    multiplier = Math.min(multiplier, positionInClip / fadeIn);
  }
  const timeFromEnd = clipDuration - positionInClip;
  if (fadeOut > 0 && timeFromEnd < fadeOut) {
    multiplier = Math.min(multiplier, timeFromEnd / fadeOut);
  }

  return clamp01(clip.volume) * clamp01(multiplier);
}
