const NICE_STEPS_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300];
const MIN_LABEL_GAP_PX = 40;

function computeStepSeconds(pixelsPerSecond: number): number {
  for (const step of NICE_STEPS_SECONDS) {
    if (step * pixelsPerSecond >= MIN_LABEL_GAP_PX) return step;
  }
  return NICE_STEPS_SECONDS[NICE_STEPS_SECONDS.length - 1];
}

function formatTick(seconds: number): string {
  return String(Math.round(seconds)).padStart(2, "0");
}

interface TimeRulerProps {
  pixelsPerSecond: number;
  durationSeconds: number;
}

export function TimeRuler({ pixelsPerSecond, durationSeconds }: TimeRulerProps) {
  const step = computeStepSeconds(pixelsPerSecond);
  const tickCount = Math.max(Math.ceil(durationSeconds / step) + 2, 4);
  const ticks = Array.from({ length: tickCount }, (_, i) => i * step);

  return (
    <div className="time-ruler" style={{ width: Math.max(durationSeconds * pixelsPerSecond, 600) }}>
      {ticks.map((t) => (
        <div key={t} className="time-tick" style={{ left: t * pixelsPerSecond }}>
          <span>{formatTick(t)}</span>
        </div>
      ))}
    </div>
  );
}
