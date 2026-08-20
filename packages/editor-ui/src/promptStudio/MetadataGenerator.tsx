import { useState } from "react";
import { generateStudioMetadata } from "./api.js";
import { CopyButton } from "./CopyButton.js";
import type { StudioProject } from "./types.js";

interface MetadataGeneratorProps {
  project: StudioProject;
  onProjectUpdated: (project: StudioProject) => void;
}

// One title/description/hashtag set per language a project targets — never a translation of
// another language's version, a fresh generation for that language's own audience.
export function MetadataGenerator({ project, onProjectUpdated }: MetadataGeneratorProps) {
  const [pendingLanguage, setPendingLanguage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(language: string) {
    setPendingLanguage(language);
    setError(null);
    try {
      const updated = await generateStudioMetadata(project.id, { language });
      onProjectUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingLanguage(null);
    }
  }

  if (project.languages.length === 0) {
    return <p className="hint">Add a language in Settings first.</p>;
  }

  return (
    <div className="metadata-generator">
      {error && <p className="export-error">{error}</p>}
      {project.languages.map((language) => {
        const variant = project.metadata.find((m) => m.language === language);
        const isPending = pendingLanguage === language;
        return (
          <div key={language} className="metadata-generator-row">
            <div className="metadata-generator-row-header">
              <span className="prompt-studio-resource-tag">{language}</span>
              <button type="button" disabled={isPending} onClick={() => handleGenerate(language)}>
                {isPending ? "Generating..." : variant ? "Regenerate" : "Generate"}
              </button>
            </div>

            {variant && (
              <div className="metadata-generator-result">
                <div className="metadata-generator-field">
                  <span className="hint">Title</span>
                  <p>{variant.title}</p>
                  <CopyButton text={variant.title ?? ""} label="Copy title" />
                </div>
                <div className="metadata-generator-field">
                  <span className="hint">Description</span>
                  <p>{variant.description}</p>
                  <CopyButton text={variant.description ?? ""} label="Copy description" />
                </div>
                <div className="metadata-generator-field">
                  <span className="hint">Hashtags</span>
                  <p>{(variant.hashtags ?? []).map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
                  <CopyButton text={(variant.hashtags ?? []).map((h) => `#${h.replace(/^#/, "")}`).join(" ")} label="Copy hashtags" />
                </div>
                <CopyButton
                  text={`${variant.title}\n\n${variant.description}\n\n${(variant.hashtags ?? []).map((h) => `#${h.replace(/^#/, "")}`).join(" ")}`}
                  label="Copy all"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
