# ReelEditor × Taiga — command sheet

Lives in `.sandbox/` on branch `sandbox-base`. The upload script leaves this folder out, so the model never sees it.

```
PersonalProjects/
├── ReelEditor/                      ← the git repo (branches: main, sandbox-base, task_*)
│   └── .sandbox/                    ← on sandbox-base only, never uploaded
│       ├── make-sandbox-zip.sh      ← builds + verifies the upload
│       └── SANDBOX.md               ← this file
└── reel-editor-sandbox.zip          ← the upload (built by the script)
```

## Build the upload (always use the script)
```bash
bash /Users/anu/Desktop/PersonalProjects/ReelEditor/.sandbox/make-sandbox-zip.sh           # from sandbox-base
git -C /Users/anu/Desktop/PersonalProjects/ReelEditor show sandbox-base:.sandbox/make-sandbox-zip.sh \
  | REPO=/Users/anu/Desktop/PersonalProjects/ReelEditor bash -s -- task_1                 # from another branch
```
It uses `git archive` (committed files only, so `.git`, `node_modules`, `.env`, `dist/` and `.turbo/` are never included) and
refuses to finish unless all checks pass:
- no agent files and no `.sandbox/`
- no private-registry URLs and no API keys
- no `engines` pin
- no media files

Left out of the zip (still on the branch): `.sandbox/`, `README.md`, `DESIGN.md`.

## What's in `sandbox-base`
`main` + `engines` removed from the root `package.json`. `packageManager` (`pnpm@10.10.0`) is kept: turbo 2.10 can't find the workspace without it.

`main` itself:
- the lockfile uses the public npm registry (`654a30e`)
- `.npmrc` → `registry=https://registry.npmjs.org/`
- MIT `LICENSE` with your contact email

If the Taiga npm mirror lacks a version, downgrade it here and commit, as in reactive-resume.

## Start a task branch
```bash
cd /Users/anu/Desktop/PersonalProjects/ReelEditor
git switch -c task_N sandbox-base
```

## In the sandbox (`/workspace/reel-editor`)
```bash
pnpm install
pnpm --filter @reel-studio/editor-ui dev        # the editor (Vite)
pnpm --filter @reel-studio/render-service dev   # export service, port 4310; needs ffmpeg on PATH
pnpm typecheck
```
- No tests exist yet: every package's `test` script prints "no tests yet".
- The prompt studio needs `OPENAI_API_KEY`. Don't use it in tasks, and never upload a `.env`.
