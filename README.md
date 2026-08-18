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
