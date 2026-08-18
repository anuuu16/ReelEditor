# Reel Studio — Design Document

**An open-source, Canva-like video editor for making reels locally.**

Version 0.1 · Design & architecture · No code, logic only

---

## 1. What this is

An approachable, format-first video editor for short social videos — reels, square posts, stories, YouTube shorts, and wide clips. The bar is Canva, not Premiere: the person should be able to drop in a few clips, pick a shape, tweak, and export, without understanding codecs, keyframes, or timelines-as-a-profession.

Four commitments shape every decision below:

- **Local-first.** It runs on the person's machine. Their footage never leaves it. There is no cloud bill and no upload wait.
- **Format-first.** Like Canva, you choose the output shape (9:16, 1:1, 16:9…) up front, and everything composes into that frame. Switching shape recomposes the whole reel instantly.
- **Approachable over powerful.** Templates and presets do the heavy lifting. Advanced controls exist but stay out of the way.
- **All TypeScript.** So contributors to an open-source project have one language to learn, top to bottom.

An explicit non-goal for v1: professional color grading, motion graphics, and multicam. Those are what make pro tools intimidating, and they are not what a reel needs.

---

## 2. The one principle everything hangs on

**You never edit video. You edit a *description* of a video, and two separate engines read that description.**

- The **preview engine** interprets the description in the browser, on a canvas, in real time — so editing feels instant.
- The **export engine** interprets the same description once, through ffmpeg, to produce the final file at full quality.

They share no rendering code. They share only the **project model** — the recipe. This is the most important idea in the whole system, because it is what guarantees that *what you see in preview is what you get on export*: both engines are reading the same recipe, so they cannot drift apart.

Every feature in this document is either (a) a way to change the recipe, (b) a way the preview engine reads the recipe, or (c) a way the export engine reads the recipe.

---

## 3. Architecture and framework

### 3.1 Shape of the system

A single monorepo with four parts:

- **`editor-ui`** — the web application. Everything the user touches: the canvas preview, the timeline, the media panel, templates, and controls. Built with a web UI framework (React or Svelte) plus Vite. This is where *all editing* happens.
- **`render-service`** — a separate local Node process whose only job is the final export. It receives a finished project, runs native ffmpeg, and streams progress back. It lives in its own process so a ten-minute export can never freeze or crash the editor, and can be cancelled cleanly.
- **`shared-types`** — a small library defining the project model. Imported by both the UI and the service so the two can never disagree about what a clip, a track, or a reel is. This shared contract is the single strongest reason to use a monorepo.
- **`timeline-core`** — pure logic, no input/output. It translates a project into the instructions ffmpeg needs. Because it touches nothing external, it is trivially testable, which matters because it is the part most likely to have subtle bugs.

Two backend processes is the ceiling. There is no microservice fleet: a single-user tool editing one project at a time has nothing to scale independently, so splitting further would add distributed-systems cost for zero benefit. Persistence is a local SQLite file, not a database server.

### 3.2 The stack, and why

- **UI framework: React or Svelte + Vite + TypeScript.** Either is fine; Svelte is lighter, React has the larger contributor pool and more prior art for video editors. *Confidence: high that it doesn't matter much; pick for your contributors.*
- **Preview rendering: HTML Canvas, driven by WebCodecs where available.** WebCodecs exposes the browser's hardware video decoders, which is what makes smooth real-time preview possible. Its weakness is that it is strongest in Chromium browsers and weaker in Firefox/Safari, so those are treated as second-class for preview. *Confidence: high.*
- **Export: native ffmpeg, run by the service — not ffmpeg compiled to WebAssembly.** The WebAssembly build is 5–20× slower, cannot use GPU encoders, and hits a roughly 2 GB memory wall that makes large files unreliable. Native ffmpeg has none of these limits. *Confidence: high.*
- **Persistence: SQLite.** A project is a small structured record plus references to files on disk. This is not a web-scale data problem; SQLite is the correct, dependency-light choice. *Confidence: high.*
- **Progress streaming: server-sent events.** Render progress flows one direction, service → UI, so SSE is simpler and sufficient; WebSockets would be over-engineering. *Confidence: moderate-high.*
- **Job handling: an in-process queue.** No Redis. Adding a Redis dependency would break the "just install and run" story for a local tool. *Confidence: high.*

### 3.3 The distribution choice you must make

There is one genuine fork that changes packaging:

- **Local service + browser (recommended).** The app is a small server the user runs, opening in their browser. Full native ffmpeg, no file-size limits, but "install" means running a process. You can hide this behind a one-command launcher, or later wrap the whole thing in a desktop shell (Tauri) so it becomes a single double-clickable app.
- **Pure browser (alternative).** Zero install, shareable by URL, everything runs in the tab using WebCodecs for preview and a WebAssembly/WebCodecs pipeline for export. Genuinely nice for *short* clips, but it inherits hard walls: large files crash the tab, and reliable export is effectively Chromium-only.

Recommendation: build local service + browser. It keeps the Canva-like ease in the UI while giving real performance where it counts, and leaves the door open to a desktop wrapper later.

---

## 4. The project model — the spine

The project is a plain data object. Nothing in it is a pixel or an encoded byte; it is entirely a recipe. Its parts:

- **Canvas.** The output frame: an aspect ratio (9:16, 1:1, 16:9, 4:5, 4:3, or custom) and a frame rate. This belongs to the *project*, not to any clip — it is the shape everything composes into.
- **Tracks.** Layered lanes stacked back to front. At minimum: one or more video/visual tracks, a text/overlay track, and one or more audio tracks. Higher tracks draw on top of lower ones.
- **Clips.** Each clip lives on a track and carries: a reference to its source file, a trim (in-point and out-point in seconds), a position on the timeline (when it starts playing), a fit mode (fit / fill / stretch), an optional transform (scale, position, rotation) within the frame, and per-clip settings like volume, speed, opacity, and filter.
- **Overlays.** Text titles and graphics, each with content, a time range (when it appears and disappears), a position, styling, and an optional animation preset.
- **Audio.** The clips' own audio plus any added music or voiceover, each track with a volume level and optional fades.
- **Metadata.** Name, the template it was created from, timestamps.

Editing means mutating this object. Preview and export mean reading it. Save means serializing it to SQLite. Undo means restoring a previous version of it. Everything routes through this one structure.

---

## 5. Feature catalogue

Grouped by area. For each: what it is, and how it works as logic.

### 5.1 Media and import

- **Import video, audio, and images.** The person selects files. Each becomes an entry that stores the real file path (for the export service) and a temporary in-browser reference (for preview). On import, the app reads each file's duration and native dimensions so it can lay clips out and compose them.
- **Media library panel.** A shelf of imported assets the person drags onto the timeline. Assets can be reused across multiple clips without re-importing.
- **Images as clips.** A still image becomes a clip with a chosen duration and an optional slow pan/zoom (the "Ken Burns" effect), which is just the transform animating over the clip's length.
- **Stock and starter assets (optional).** A bundled set of royalty-free backgrounds, shapes, and music so an empty project isn't a dead end.

### 5.2 Canvas and formats

- **Aspect-ratio presets.** One-tap output shapes for each social platform. Choosing one sets the canvas dimensions; the preview recomposes on the next frame and the export uses the same numbers. The footage never changes — only the frame it pours into.
- **Custom size.** Free width/height for anything not covered by presets.
- **Fit / fill / stretch per clip.** The core of format handling, and it is pure arithmetic. The canvas has a width and height; the clip has its own. Compute two ratios (canvas-width ÷ clip-width, canvas-height ÷ clip-height) and then:
  - **Fit (letterbox):** use the *smaller* ratio — the whole clip fits inside the frame, empty space becomes bars.
  - **Fill (crop):** use the *larger* ratio — the clip covers the frame, the overflow is cropped off the edges.
  - **Stretch:** scale width and height independently to exactly fill, accepting distortion.
  Center the scaled clip and draw. That single choice of smaller-vs-larger ratio is the entire "handle mixed aspect ratios" feature.
- **Pan, zoom, and position.** A transform on top of the fit mode lets the person nudge the crop or punch in. In preview it offsets the draw; on export it maps to the crop/scale parameters.
- **Background fill.** What shows behind a letterboxed clip: a solid color, a blur of the clip itself, or an image.

### 5.3 Timeline and editing

The timeline renders no video — it is a visual editor for the model. A pixels-per-second scale maps screen position to time and back; every interaction mutates the model, and the preview re-reads it.

- **Drag and drop.** Drag assets from the library onto tracks; drag clips to reposition them in time or move them between tracks.
- **Trim.** Dragging a clip's edge changes its in- or out-point. The source file is untouched; only the trim numbers change.
- **Split.** Cutting a clip at the playhead turns one clip into two adjacent clips sharing the source, with the cut point as one's out and the other's in.
- **Reorder.** Changing the order (or timeline position) of clips changes playback order.
- **Ripple delete.** Removing a clip and closing the gap so later clips slide earlier.
- **Snapping.** As clips are dragged, their edges snap to the playhead, to other clip edges, and to markers, so alignment is effortless. Logic: while dragging, if an edge is within a few pixels of a snap target, pull it exactly onto the target.
- **Zoom.** Changing the pixels-per-second scale to see the whole reel or work frame-by-frame.
- **Clip thumbnails and audio waveforms.** Video clips show sampled frames along their length; audio clips show a waveform. Both are generated once on import and cached, purely as visual aids.
- **Playhead and scrubbing.** The playhead is a time value. Clicking the ruler or dragging the playhead sets that time, and the compositor immediately draws that exact moment.
- **Undo / redo.** Every edit is a reversible change to the model. Keeping a history stack of model states (or of the changes themselves) lets the person step backward and forward. This is essential for a Canva-like feel and should be built early, not bolted on.
- **Keyboard shortcuts.** Space to play/pause, split at playhead, delete, undo/redo, nudge — the muscle-memory layer that makes editing fast.

### 5.4 Preview / playback engine (the compositor)

One canvas sized to the project's aspect ratio, and one hidden video element per clip (the browser decodes them; the compositor only draws from them). A playback clock ticks on the animation frame loop. On each tick:

1. From the playhead time, determine which clip is active and how far into it you are (sum the durations before it; the remainder is the local time inside it).
2. Draw the active clip's current frame onto the canvas, positioned by its fit mode and transform.
3. Composite any higher-track overlays whose time range contains the playhead — a title is text painted onto the canvas; a sticker is an image drawn on top.
4. Apply the clip's filter/color adjustment to the drawn frame.
5. When the active clip reaches its out-point, hand off to the next clip.

Because no encoder runs in this loop, it stays smooth. This is exactly why preview must never route through ffmpeg — doing so turns editing into a slideshow. Switching aspect ratio, changing a fit mode, or moving a clip all just change what the next tick draws.

The hardest detail here is the **clip hand-off**: starting the next clip's playback cleanly at a boundary without a stutter. The fix is to pre-buffer — seek and ready the next clip slightly before the current one ends — so the switch is seamless.

### 5.5 Text and titles

- **Text presets.** Ready-made title styles (headline, lower-third, caption, callout) the person picks and edits, rather than styling from scratch. This is very Canva.
- **Timing.** Each title has a start and end on the reel timeline; it is drawn only while the playhead is inside that range.
- **Positioning and style.** Position (as fractions of the frame so it survives aspect changes), font, size, color, alignment, background/outline.
- **Animated titles.** Presets like fade, slide-in, pop, and typewriter. In preview these are drawn by interpolating the animation over the title's time range; on export they are reproduced by the export engine (the robust path is to pre-render each animated title to a short transparent video/image sequence and overlay it, which sidesteps ffmpeg's fragile text handling and gives real fonts and emoji).

### 5.6 Transitions

- **Between-clip transitions.** Fade to black, cross-dissolve, slide, wipe, zoom. Logic: a transition is a short overlap region between two clips where the compositor blends both frames — e.g. a dissolve draws the outgoing clip at decreasing opacity over the incoming one. On export, ffmpeg has direct equivalents for the common transitions.

### 5.7 Filters, color, and effects

- **One-tap filters / looks.** Preset color adjustments (warm, cool, mono, vintage) applied per clip. In preview, applied as a canvas filter or shader on the drawn frame; on export, applied as ffmpeg color operations. Presets, not manual grading, keep it approachable.
- **Basic adjustments.** Brightness, contrast, saturation as simple sliders for people who want a little more.
- **Speed.** Slow-motion and fast-forward per clip. It changes how the clip's source time maps to timeline time (and correspondingly stretches or compresses its audio).
- **Opacity.** Per-clip transparency, mainly for overlay tracks and blends.
- **Background removal (advanced/optional).** Separating a subject from its background, useful for overlaying a person onto a different scene. Heavier; a later addition.

### 5.8 Audio

- **Clip audio.** Plays naturally in preview because the active clip's video element plays; muted on inactive clips.
- **Background music and voiceover.** Added as their own audio tracks that play *under* the clips throughout, independent of which clip is showing.
- **Mixing.** Real multi-track audio needs an audio graph: every source (each clip, the music, the voiceover) routes through its own volume control into a mixer and then to the speakers. The playhead drives all sources so they stay in sync. This graph is what makes "audio along with video" work rather than just sequential clip sound.
- **Per-track volume, fade in/out.** Volume levels and fades are properties on the tracks; the graph applies them.
- **Ducking.** Automatically lowering the music when a clip has speech, so narration stays audible.
- **Auto-captions (advanced/optional).** Transcribing speech to timed text and adding it as an editable title track — a signature modern Canva feature, powered by a speech-to-text step.

### 5.9 Templates and presets — the Canva core

- **Templates.** A template is simply a pre-filled project model — a reel with placeholder clips, titles, timing, music, and transitions already arranged. The person swaps their own footage into the placeholders and it inherits the design. This is the single feature that most defines "Canva-like," and it costs little because it reuses the exact same model as everything else.
- **Save as template.** Any finished project can become a reusable template by stripping its specific media and keeping the arrangement.
- **Preset library.** Curated collections of text styles, transitions, filters, and music that make good defaults trivially reachable.

### 5.10 Brand kit

- **Saved brand assets.** Fonts, a color palette, and a logo the person defines once and applies across projects, so their reels stay consistent. Applying the brand kit means the app fills title styles and accents from these saved values.

### 5.11 Export

- **Output presets.** Platform-shaped exports (Instagram Reel, TikTok, YouTube Short, square post) that set resolution, frame rate, and quality appropriately, so the person picks a destination rather than codec settings.
- **How it runs.** The finished project goes to the render service, which translates it (via `timeline-core`) into a single ffmpeg instruction: trim each clip, normalize it to the canvas size and frame rate, apply its fit (letterbox = scale-plus-pad, fill = scale-plus-crop — the same rectangles the canvas drew), apply filters and speed, concatenate in order with transitions, overlay the titles at their timings, and mix the audio at its volumes.
- **Progress and cancel.** ffmpeg emits machine-readable progress; the service divides it by the known total reel duration to produce a real percentage and streams it to the UI. Because export lives in its own process, a render can be cancelled by stopping that process without disturbing the editor.
- **Fidelity guarantee.** The fit math, timings, and effects all come from the *same model the compositor used*, so the exported file reproduces what the person saw. That is the entire payoff of the two-engines-one-model design.

### 5.12 Project persistence

- **Save / open.** A project is serialized to the local SQLite store as its model plus references to media on disk.
- **Autosave.** The model is saved continuously so a crash costs nothing.
- **Recent projects.** A simple list to reopen recent work.

---

## 6. How a full session flows

The person starts from a template or a blank reel and picks an aspect ratio. They drag in a few video files; each becomes a clip. They trim two of them, reorder, set one to fill and one to fit, add a titled intro from a preset, drop a transition between two clips, add a music track and lower its volume, and apply a warm filter to everything. The whole time, the compositor has been redrawing the canvas from the model, so they are watching the finished reel as they build it. They hit export, choose "Instagram Reel," and the render service produces the file while a progress bar fills. They get an MP4 that looks exactly like the preview.

---

## 7. Build order (so you don't drown)

Build in layers; each is usable on its own.

1. **The model + the compositor.** Load clips, one canvas, aspect-ratio presets, fit/fill, sequential playback with clean clip hand-off. This is the riskiest core; get it smooth first and everything else is UI on top of a clean data model.
2. **The timeline.** Visual tracks, trim, split, reorder, snapping, playhead, undo/redo. Now it is a real editor.
3. **Text and audio.** Title presets with timing; the audio graph for background music and mixing. This completes the stated feature set.
4. **Export.** The render service, the model-to-ffmpeg translation, progress and cancel. Now reels leave the app.
5. **The Canva layer.** Templates, transitions, filters, brand kit, output presets. This is what makes it feel like Canva rather than a raw editor.
6. **Advanced.** Auto-captions, background removal, animated titles, keyframed transforms.

---

## 8. The genuinely hard parts (spend care here)

- **Clip hand-off during playback.** Seamless boundaries without a stutter; solved by pre-buffering the next clip.
- **Audio sync.** Keeping multiple audio sources locked to the playhead and to the video, especially with speed changes and after seeking.
- **Preview-to-export fidelity.** Every effect must have a matching interpretation in both engines, or preview and export drift. Adding a preview effect without its export equivalent is the classic trap.
- **Undo/redo across everything.** It must cover every kind of edit; retrofitting it later is painful, so design it into the model from the start.
- **Animated text on export.** ffmpeg's native text handling is fragile; pre-rendering titles to transparent overlays is the reliable path.
- **Large-file performance in the browser preview.** Very long or very high-resolution source clips strain browser decoding; proxies (low-res stand-ins for editing, full-res only at export) are the eventual answer.

---

## 9. Tech decisions at a glance

- **Runs:** locally, all TypeScript.
- **Monorepo:** Nx, or pnpm workspaces + Turborepo.
- **UI:** React or Svelte + Vite.
- **Preview:** Canvas + WebCodecs, in the browser, never through ffmpeg.
- **Export:** native ffmpeg, in a separate local process.
- **Persistence:** SQLite, model-as-recipe.
- **Backend footprint:** two processes max, in-process queue, SSE for progress.
- **Distribution:** local service + browser now, optional desktop wrapper later.
- **The invariant:** one project model, two engines reading it — preview for speed, export for quality — which is what keeps what-you-see equal to what-you-get.
