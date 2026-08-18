export async function generateAudioWaveformPeaks(
  previewUrl: string,
  inPoint: number,
  outPoint: number,
  bucketCount: number
): Promise<number[]> {
  if (!previewUrl || bucketCount <= 0) return [];

  const response = await fetch(previewUrl);
  const arrayBuffer = await response.arrayBuffer();
  const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioContextCtor();

  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const startSample = Math.max(0, Math.floor(inPoint * sampleRate));
    const endSample = Math.min(Math.floor(outPoint * sampleRate), channelData.length);
    const span = Math.max(endSample - startSample, 1);
    const bucketSize = Math.max(1, Math.floor(span / bucketCount));

    const peaks: number[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = startSample + i * bucketSize;
      const bucketEnd = Math.min(bucketStart + bucketSize, endSample);
      let peak = 0;
      for (let j = bucketStart; j < bucketEnd; j++) {
        const value = Math.abs(channelData[j] ?? 0);
        if (value > peak) peak = value;
      }
      peaks.push(peak);
    }
    return peaks;
  } finally {
    await audioCtx.close();
  }
}
