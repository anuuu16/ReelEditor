# Reel Studio

An open-source, local-first, Canva-like video editor for making reels. See [DESIGN.md](./DESIGN.md) for the full architecture and rationale.

## Packages

- `packages/shared-types` — the project model, shared by everything else.
- `packages/timeline-core` — pure logic that turns a project model into render instructions. No I/O.
- `packages/editor-ui` — the web app: canvas preview, timeline, media panel. React + Vite.
- `packages/render-service` — local Node process that runs native ffmpeg for export.

## Development

```bash
pnpm install
pnpm dev            # runs all packages' dev tasks via Turborepo
pnpm build
```

Checks (run from the repo root):

| Command | What it does |
|---|---|
| `pnpm check` | everything below except the fixers: typecheck, lint, format check, tests |
| `pnpm fix` | `lint:fix` then `format`: fixes what can be fixed automatically |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` / `pnpm lint:fix` | [oxlint](https://oxc.rs), warnings fail the run |
| `pnpm format` / `pnpm format:check` | [oxfmt](https://oxc.rs), settings in `.oxfmtrc.json` (140 columns) |
| `pnpm test` | vitest; `packages/timeline-core` has the tests |

## Export

Exporting needs ffmpeg and the render service running:

```bash
pnpm --filter @reel-studio/render-service dev
```

The service looks for ffmpeg in this order:

1. `FFMPEG_PATH`, if set
2. `ffmpeg` on your `PATH`: install it with your system's package manager (`brew install ffmpeg` on macOS,
   `apt-get install ffmpeg` on Debian/Ubuntu)
3. the ffmpeg binary from the npm package `@ffmpeg-installer/ffmpeg`. It isn't installed by default; add it when the
   machine has no ffmpeg and you can't install one:

   ```bash
   pnpm --filter @reel-studio/render-service add @ffmpeg-installer/ffmpeg
   ```

   It ships ffmpeg 4.x (with `drawtext`) inside the npm package, so no other download is needed. `ffprobe` isn't included.

Then click "Export" in the editor. The editor uploads the project's media to the local render service (`http://localhost:4310`), which runs ffmpeg and streams progress back; when it finishes you get a download link for the rendered MP4.

**Title overlays need a drawtext-capable ffmpeg.** Homebrew's plain `ffmpeg` formula doesn't compile in `libfreetype`, so `drawtext` isn't available and export fails with `No such filter: 'drawtext'` for any project containing a title. Exports with no titles work fine on the plain build. To get titles working:

```bash
brew install ffmpeg-full
brew link --overwrite ffmpeg-full   # makes it the default `ffmpeg` on PATH
```

`ffmpeg-full` is keg-only and won't replace the plain build automatically — the `link --overwrite` step is a deliberate choice since it changes the default `ffmpeg` for your whole system, not just this project.
