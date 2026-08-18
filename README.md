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
pnpm dev        # runs all packages' dev tasks via Turborepo
pnpm build
pnpm typecheck
```

## Export

Exporting requires [ffmpeg](https://ffmpeg.org) on your `PATH` (`brew install ffmpeg` on macOS) and the render service running:

```bash
pnpm --filter @reel-studio/render-service dev
```

Then click "Export" in the editor. The editor uploads the project's media to the local render service (`http://localhost:4310`), which runs ffmpeg and streams progress back; when it finishes you get a download link for the rendered MP4.
