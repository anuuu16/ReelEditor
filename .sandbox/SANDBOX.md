# ReelEditor × Taiga — command sheet

Lives in `.sandbox/` on branch `sandbox-base`. The upload script leaves this folder out, so the model never sees it.

```
<parent folder>/
├── ReelEditor/                      ← the git repo (branches: main, sandbox-base, task_*)
│   └── .sandbox/                    ← on sandbox-base only, never uploaded
│       ├── make-sandbox-zip.sh      ← builds + verifies the upload
│       └── SANDBOX.md               ← this file
└── reel-editor-sandbox.zip          ← the upload (built by the script)
```

## Build the upload (always use the script)
```bash
bash .sandbox/make-sandbox-zip.sh                         # from the repo root; packs sandbox-base
git show sandbox-base:.sandbox/make-sandbox-zip.sh | REPO=. bash -s -- task_1   # with another branch checked out
```
It uses `git archive` (committed files only, so `.git`, `node_modules`, `.env`, `dist/` and `.turbo/` are never included) and
refuses to finish unless all checks pass:
- no agent files and no `.sandbox/`
- no private-registry URLs and no API keys
- no `engines` pin
- no media files except the 6 in `samples/`

Left out of the zip (still on the branch): `.sandbox/`, `README.md`, `DESIGN.md`.

## What's in `sandbox-base`
`main` + `engines` removed from the root `package.json`. `packageManager` (`pnpm@10.10.0`) is kept: turbo 2.10 can't find the workspace without it.

`main` itself:
- the lockfile uses the public npm registry (`654a30e`)
- `.npmrc` → `registry=https://registry.npmjs.org/`
- MIT `LICENSE` with your contact email

If the Taiga npm mirror lacks a version, downgrade it here and commit, as in reactive-resume.

## Samples
`samples/` (on this branch only), all generated test signals; see `samples/README.md`:
- Task 10 (video export): `clip-landscape-4s.mp4`, `clip-portrait-3s-silent.mp4` (no audio track), `music-9s.m4a`
- Task 11 (audio editor): `voice-like-20s.wav`, `music-loud-24s.m4a`, `quiet-tone-8s.wav`

## Start a task branch
```bash
cd ReelEditor
git switch -c task_N sandbox-base
```

## In the sandbox (`/workspace/reel-editor`)
```bash
pnpm install
pnpm check                                       # typecheck + lint + format check + tests (timeline-core: 43)
pnpm fix                                         # lint --fix + format
pnpm --filter @reel-studio/editor-ui dev         # the editor (Vite), http://localhost:5173
pnpm --filter @reel-studio/render-service dev    # export service, port 4310
```
- **ffmpeg isn't installed by `pnpm install`.** The service uses `FFMPEG_PATH`, then `ffmpeg` on `PATH`, then
  `@ffmpeg-installer/ffmpeg` if it was added. The model can install ffmpeg itself (for example `apt-get install ffmpeg`), or
  add the package as a fallback: `pnpm --filter @reel-studio/render-service add @ffmpeg-installer/ffmpeg`. The README says the same.
- `ffprobe` only comes with a system install.
- Tests exist only in `packages/timeline-core` (43). `render-service` and `editor-ui` have none.
- The prompt studio needs `OPENAI_API_KEY`. Don't use it in tasks, and never upload a `.env`.
- Projects are saved in `~/ReelStudioProjects`, outside the repo.
