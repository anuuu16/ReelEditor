export function snapTime(time: number, targets: number[], thresholdSeconds: number): number {
  let closest = time;
  let closestDistance = thresholdSeconds;

  for (const target of targets) {
    const distance = Math.abs(time - target);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = target;
    }
  }

  return closest;
}
