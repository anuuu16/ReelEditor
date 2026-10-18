# Audio Editor: loudness + auto-ducking

Addresses three linked problems in the standalone Audio Editor (`AudioEditor.tsx` and this folder):

1. Voice-over added on top of music stays inaudible unless the music is manually cut/faded.
2. "Normalize" (peak-to -1 dBFS) doesn't tell you how loud the *mix* actually is, and doesn't fix
   a loud-music/quiet-voice balance even when applied to both clips.
3. No auto-ducking, and no clear model for "this clip is the voice, that one is backing".

## What changed

- **Clip roles** (`timeline.ts`): every clip now has `role: "music" | "voice" | "sfx"`. Set per-clip
  in the Clip inspector. This is the thing auto-ducking and the mix-health meter key off — nothing
  inspects file names or lane numbers.
- **Auto-ducking** (`duck.ts`, wired into `mixdown.ts`, controlled by `DuckingPanel.tsx`): while a
  "voice" clip's own resolved level crosses a threshold, every "music"/"sfx" clip's gain is pulled
  down (eased by attack/release) and released once the voice goes quiet. Applied inside `mixdown()`
  itself, so it's automatically in effect for live preview, Save, and every export format — no
  separate "bake it in" step.
- **Loudness + peak meter with plain-language verdicts** (`loudness.ts`, `mixHealth.ts`,
  `MixHealthPanel.tsx`): reports the mix's peak and an approximate integrated loudness, flags
  clipping/too-quiet/too-loud, and — when there's both a voice and a backing clip — renders each in
  isolation (reusing `mixdown()` with a role filter) to report how loud the backing track actually is
  *while the voice is speaking*, and warns if it's not sitting safely under it.
- **Loudness-based Normalize** (`dbUtils.ts`, `resolveClipBaseGain` in `mixdown.ts`): Normalize is now
  a 3-way choice — Off / Peak (the old behaviour) / Loudness. Peak normalize only looks at one
  sample; two peak-normalized clips can still sound very different (a squashed music bed vs. a
  dynamic voice take). Loudness normalize targets the clip's average level instead, which is a much
  better match for "make the voice and the music sound similarly loud".

All of the above is computed client-side in TypeScript/Web Audio, consistent with how this editor
already worked (no server involvement beyond the existing "transcode the final WAV" step).

## Ducking behaviour, verified scenario by scenario (`duck.scenarios.test.ts`)

| Scenario | Before | Now |
|---|---|---|
| Two voice clips on two lanes, overlapping | Already correct: overlap sums as energy, duck capped at the configured amount (no double-duck) | Same, now pinned by tests |
| Muted clip | Already correct: a muted voice clip triggers nothing; a muted music clip isn't rendered | Same, pinned by tests |
| Voice clip at 1.5× / 2× | Timing already correct; but the last analysis frame could read source audio *past* the clip's out-point | Clamped to the trimmed region |
| Short pauses between words | Music pumped ~3 dB up/down in every 150 ms gap and lagged ~300 ms behind each phrase onset | **Hold** (default 0.4 s) keeps it fully ducked through gaps; **look-ahead** (= attack time, free because the mix is rendered offline) has it ~2/3 of the way down when the first word lands |
| Music already quieter than the voice | Still ducked by the full fixed amount (30 dB under the voice → pulled down another 12) | **Adaptive** (default on): each backing clip is ducked only as far as *it* needs to sit `keepUnderDb` (10 dB) under the voice, capped at the max amount. Already-quiet music: 0 dB. Music with a quiet intro and loud chorus: intro untouched, chorus ducked. "Only as much as needed" off restores the fixed behaviour |

New `DuckingSettings` fields (`holdSec`, `adaptive`, `keepUnderDb`) are filled in for projects saved before they existed.

## Loudness meter (EBU R128 / ITU-R BS.1770)

`ebur128.ts` is a from-the-spec implementation — K-weighting, 400 ms gated blocks for integrated
loudness, 3 s short-term for LRA, 4× oversampled true peak — run in a Web Worker
(`loudnessWorker.ts` / `measureLoudness.ts`) on every re-render of the mix, and shown in
`LoudnessMeterPanel.tsx` under the timeline's transport with a selectable delivery target.

It is checked against ffmpeg's `ebur128` filter in `ebur128.test.ts` using the repo's sample files,
and end-to-end by exporting from the editor and re-measuring the exported file:

| | Editor meter | `ffmpeg -af ebur128=peak=true` on the export |
|---|---|---|
| `samples/music-dynamic-16s.wav` alone | −9.9 LUFS · 14.2 LU · −3.0 dBTP | −9.9 LUFS · 14.5 LU · −3.0 dBTP (source file) |
| + `voice-like-20s.wav` as Voice, ducking on → **Download WAV** | −15.3 LUFS · 8.0 LU · −4.8 dBTP | −15.3 LUFS · 8.1 LU · −4.8 dBTP |
| same → **Export MP3 192k** (render-service) | (same timeline) | −15.6 LUFS · 8.1 LU · −5.1 dBTP |

The MP3 differs by ~0.3 dB because the lossy encode changes the waveform — that's the codec, not
the meter; WAV is bit-for-bit what the meter measured.

The "Mix health" panel's overall-level verdicts (too quiet / too hot / over the true-peak ceiling)
now come from this measurement, so there's a single definition of "how loud". Note that the per-clip
**Loudness normalize** mode still uses the older block-RMS approximation in `loudness.ts`
(deliberately left untouched) — so a clip normalized to "~−16 dB" there won't read exactly −16 LUFS
on this meter.

## Export formats vs. the peak ceiling (`truePeakSafety.ts`)

The same mix exported as all four formats and re-measured with ffmpeg (`ebur128=peak=true` + `astats`):

| Export | Mix at −0.5 dBTP | Hot mix (+5.5 dBTP float) | Hot mix, with true-peak-safe export |
|---|---|---|---|
| WAV | −0.5 dBFS | **0.0 dBFS, flat factor 37.6** (hard-clipped) | −1.0 dBFS, flat factor 0 |
| MP3 192k | −0.8 dBFS | −0.2 dBFS | −1.3 dBFS |
| M4A (AAC) | −0.5 dBFS | **+0.5 dBFS** (over full scale) | −1.0 dBFS |
| Opus | −0.5 dBFS | **+0.5 dBFS** (over full scale) | −1.0 dBFS |

Why: the float mix can exceed ±1.0 (clips sum), and the 16-bit WAV writer hard-clips it at exactly
0 dBFS — that's the one that "goes till the peak ceiling", with long flattened sample runs (audible
distortion). The lossy codecs then encode that clipped waveform and their imperfect reconstruction
*overshoots* it, decoding to peaks above full scale. Even a legal −0.5 dBTP mix leaves every format
above the −1 dBTP delivery ceiling, which exists precisely to absorb that codec overshoot.

Fix: "True-peak safe" export (on by default): the rendered mix's true peak is measured and, if it's
over −1 dBTP, the whole mix is turned down by the difference before the WAV intermediate is written
— a static trim, so clip balance and ducking are untouched, and quiet mixes are never boosted.
After the fix all four formats land at −1.0 dBFS with zero clipping.

## Undo/redo covers every applied change

- **Coalescing** (`useAudioTimelineHistory.commit(fn, coalesceKey)`): a rapid run of commits with
  the same key — a Gain/Fade/Ducking slider being dragged, a note being typed, lane +/− clicks —
  collapses into one undo entry instead of one per tick/keystroke (which also used to flush real
  edits out of the 60-entry history). Checkpoint gestures, undo/redo, and unkeyed commits all break
  a run, so nothing ever merges across them.
- **Shortcut fix**: Cmd/Ctrl+Z used to be swallowed whenever any `<input>` had focus — and sliders/
  checkboxes keep focus after you use them, so "drag a slider, hit undo" silently did nothing. Now
  only text-entry fields (which own native text undo) swallow it.
- Pinned by `useAudioTimelineHistory.test.tsx` (8 cases, via @testing-library/react).

## Ducking drawn on the timeline; preferences persist

- Backing clips now render their waveform at the *ducked* level (the un-ducked shape stays faint
  behind it) with the gain envelope as a cyan line — `computeDuckCurves()` in mixdown.ts is the
  single source for both the audible automation and the drawing.
- The loudness meter's target and the export format / bitrate / true-peak-safe choices persist in
  localStorage (`prefs.ts`); the timeline itself (clips, roles, lanes, ducking settings) was already
  persisted in IndexedDB. Verified: a full reload reproduces the same project and the same meter
  readings to the decimal.

## A more practical alternative, if this needs to scale up

The ducking implementation here is a cheap approximation of a sidechain compressor: sample the
voice clip's own level, decide "speaking or not" against a threshold, ease the transition with an
attack/release envelope follower, and apply the resulting gain curve to the backing clips. That's
plenty for the common case (one voice-over track, one or two music/sfx beds), and it has the major
advantage of running entirely in the browser with no round-trip.

It has real limits, though:

- It ducks against the voice clip's *source* level, not against whatever the final mix actually
  sounds like after every other clip's own gain/EQ/etc. is applied.
- The attack/release envelope follower is a simplified one-pole filter, not a proper compressor
  (no knee, no ratio curve, no lookahead).
- It's recomputed by re-analyzing raw PCM in JS, which is fine at these project lengths but doesn't
  scale indefinitely.

If this editor ever needs to handle much longer timelines, more tracks, or wants broadcast-grade
ducking, the more practical approach would be to move it server-side (this project already has a
render-service with ffmpeg on the path — see `packages/render-service`) and use ffmpeg's
`sidechaincompress` filter: a real sidechain compressor, sample-accurate, with proper
attack/release/ratio/knee controls, driven by the actual voice track as the sidechain input rather
than an approximation of it. The tradeoff is the obvious one — it stops being instant/local and
becomes a render step — which is why the client-side version above is the better fit for this
editor's "everything updates live as you drag a slider" preview model.
