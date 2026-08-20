import { useEffect, useState } from "react";
import type { StudioProject } from "./types.js";

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
    <section className="prompt-studio-section">
      <h2>Poem</h2>
      <p className="hint">Write or paste the poem/lyrics for each language. Generation can pre-fill this, but it is never required.</p>

      {project.languages.map((language) => (
        <label className="field" key={language}>
          <span>{language}</span>
          <textarea
            rows={6}
            value={poem[language] ?? ""}
            onChange={(e) => updateLanguageText(language, e.target.value)}
            onBlur={() => flushLanguage(language)}
            placeholder={`Poem text in "${language}"...`}
          />
        </label>
      ))}

      <div className="inline-fields prompt-studio-add-language">
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
        />
        <button type="button" onClick={handleAddLanguage} disabled={!newLanguage.trim()}>
          + Add language
        </button>
      </div>
    </section>
  );
}
