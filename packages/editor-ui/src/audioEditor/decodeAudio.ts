// Decode a picked/dropped audio file (or a Blob loaded back out of IndexedDB on project reload)
// into an AudioBuffer for waveform drawing and offline preview. Same AudioContext +
// decodeAudioData path the timeline's waveform thumbnails already use (see
// ../thumbnails/audioWaveform.ts).
export async function decodeAudioFile(file: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const AudioContextCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioContextCtor();
  try {
    // decodeAudioData detaches the ArrayBuffer, so hand it a copy — the caller may still want the raw
    // bytes (we re-upload the original file for the server encode).
    return await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await audioCtx.close();
  }
}
