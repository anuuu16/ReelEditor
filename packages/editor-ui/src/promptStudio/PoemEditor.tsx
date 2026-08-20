import { useEffect, useState } from "react";
import type { StudioProject } from "./types.js";
import { Button, Card, TextareaField } from "./ui/index.js";

interface PoemEditorProps {
  project: StudioProject;
  onPatch: (patch: Partial<StudioProject>) => void;
}

// The poem is the plain-text, always-editable core of a Studio project, typed or pasted in from
// any chat UI, one textarea per language, never gated behind generation.
export function PoemEditor({ project, onPatch }: PoemEditorProps) {
  const [poem, setPoem] = useState<Record<string, string>>(project.poem);
  const [newLanguage, setNewLanguage] = useState("");

  useEffect(() => {
    setPoem(project.poem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  function updateLanguageText(language: string, value: string) {
    setPoem((prev) => ({ ...prev, [language]: value }));
  }

  function flushLanguage(language: string) {
    onPatch({ poem: { ...poem, [language]: poem[language] ?? "" } });
  }

  function handleAddLanguage() {
    const code = newLanguage.trim();
    if (!code || project.languages.includes(code)) return;
    const languages = [...project.languages, code];
    const nextPoem = { ...poem, [code]: poem[code] ?? "" };
    setPoem(nextPoem);
    setNewLanguage("");
    onPatch({ languages, poem: nextPoem });
  }

  return (
    <Card title="Poem" hint="Write or paste the poem/lyrics for each language. Generation can pre-fill this, but it is never required.">
      {project.languages.map((language) => (
        <TextareaField
          key={language}
          label={language}
          rows={6}
          value={poem[language] ?? ""}
          onChange={(value) => updateLanguageText(language, value)}
          onBlur={() => flushLanguage(language)}
          placeholder={`Poem text in "${language}"...`}
          className="mb-3.5"
        />
      ))}

      <div className="flex items-stretch gap-3">
        {/* Kept as a hand-styled input (not TextField) because it needs an Enter-to-submit
            onKeyDown handler that the TextField primitive does not expose — same ps-* token
            classes as TextField's input, just with the extra handler wired in. */}
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-xs text-ps-muted">
          <span>Add language</span>
          <input
            type="text"
            value={newLanguage}
            onChange={(e) => setNewLanguage(e.target.value)}
            placeholder="Language code, e.g. hi"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddLanguage();
              }
            }}
            className="w-full min-w-0 rounded-ps border border-ps-border bg-ps-elevated px-2.5 py-1.5 text-sm text-ps-text placeholder:text-ps-muted focus:border-ps-accent focus:outline-none"
          />
        </label>
        <Button onClick={handleAddLanguage} disabled={!newLanguage.trim()} className="self-end">
          + Add language
        </Button>
      </div>
    </Card>
  );
}
