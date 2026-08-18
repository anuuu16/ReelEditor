import type { ProjectModel } from "@reel-studio/shared-types";

export function getUsedSourceIds(project: ProjectModel): string[] {
  return [
    ...new Set([
      ...project.clips.map((c) => c.sourceId),
      ...project.overlays.map((o) => o.imageSourceId).filter((id): id is string => id != null),
    ]),
  ];
}
