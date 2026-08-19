import { useState } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import {
  deleteProjectFromServer,
  listProjectsFromServer,
  loadProjectFromServer,
  type ProjectSummary,
} from "./projectServer.js";

export function formatProjectDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

// Shared "browse saved projects/templates" state and actions, used by both the in-editor Projects
// panel and the Dashboard — everything here is plain persistence calls, no editor state required.
export function useProjectBrowser() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const realProjects = projects.filter((p) => !p.isTemplate);
  const templates = projects.filter((p) => p.isTemplate);

  async function refresh() {
    try {
      setProjects(await listProjectsFromServer());
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function openProject(id: string): Promise<ProjectModel | null> {
    setBusyProjectId(id);
    setErrorMessage(null);
    try {
      return await loadProjectFromServer(id);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusyProjectId(null);
    }
  }

  async function useAsTemplate(id: string): Promise<ProjectModel | null> {
    setBusyProjectId(id);
    setErrorMessage(null);
    try {
      const template = await loadProjectFromServer(id);
      return {
        ...template,
        id: crypto.randomUUID(),
        metadata: { ...template.metadata, isTemplate: false, templateId: id, createdAt: Date.now(), updatedAt: Date.now() },
      };
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusyProjectId(null);
    }
  }

  async function deleteProject(id: string, name: string) {
    const proceed = window.confirm(`Delete "${name || "Untitled reel"}"? This removes its folder and media permanently.`);
    if (!proceed) return;
    setBusyProjectId(id);
    try {
      await deleteProjectFromServer(id);
      await refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProjectId(null);
    }
  }

  return { realProjects, templates, refresh, errorMessage, setErrorMessage, busyProjectId, openProject, useAsTemplate, deleteProject };
}
