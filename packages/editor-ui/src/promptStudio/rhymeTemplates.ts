import type { RhymeContentType } from "./rhymeTypes.js";

// Everything a template pre-fills except `topic` — topic is the one thing that's different for
// every project, so a template is a preset of the *other* settings, not a full concept.
export interface RhymeTemplate {
  id: string;
  name: string;
  age: string;
  style: string;
  lengthSeconds: number;
  languages: string[];
  contentType: RhymeContentType;
  extra: string;
}

const STORAGE_KEY = "reel-studio-rhyme-templates";

// Always available, not stored/deletable — the concrete example the user asked for ("one for
// YouTube poem"), tuned to the app's actual most common use case (short kids' poems in English + Hindi).
export const BUILT_IN_TEMPLATES: RhymeTemplate[] = [
  {
    id: "builtin-youtube-poem",
    name: "YouTube poem",
    age: "Preschool (4-6)",
    style: "Rhyme",
    lengthSeconds: 32,
    languages: ["English", "Hindi"],
    contentType: "poem",
    extra: "Add a repeating chorus kids can sing along",
  },
];

export function loadCustomTemplates(): RhymeTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function listTemplates(): RhymeTemplate[] {
  return [...BUILT_IN_TEMPLATES, ...loadCustomTemplates()];
}

export function saveCustomTemplate(template: RhymeTemplate): void {
  const existing = loadCustomTemplates().filter((t) => t.id !== template.id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, template]));
}

export function deleteCustomTemplate(id: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loadCustomTemplates().filter((t) => t.id !== id)));
}
