# Sample media

Generated with ffmpeg (test patterns and tones, no real footage), for trying out export:

| File | What it is |
|---|---|
| `clip-landscape-4s.mp4` | 1280×720, 4 s, moving colour bars with a tone |
| `clip-portrait-3s-silent.mp4` | 720×1280, 3 s, **no audio track** |
| `music-9s.m4a` | 9 s of beeps, longer than the video clip |
| `voice-like-20s.wav` | mono, 44.1 kHz, 20 s: tone bursts (1.8 s on, 1.2 s off) standing in for speech; −21.9 LUFS, −17.0 dBTP |
| `music-loud-24s.m4a` | stereo, 48 kHz AAC, 24 s, a steady chord; very loud: −5.9 LUFS, −0.4 dBTP |
| `quiet-tone-8s.wav` | mono, 48 kHz, 8 s, a 440 Hz tone; quiet: −33.8 LUFS, −30.1 dBTP |
| `music-dynamic-16s.wav` | stereo, 48 kHz, 16 s, a synth chord that goes quiet intro → medium → 1.5 s silence → loud → fade-out; deliberately *dynamic* (−9.9 LUFS, LRA 14.5 LU, −3.0 dBTP) so loudness gating and true-peak have something to do — the reference file for the Audio Editor's loudness meter |

Loudness values were measured with `ffmpeg -i <file> -af ebur128=peak=true -f null -`.

`music-dynamic-16s.wav` was generated with:

```sh
A='if(lt(t,3),0.03,if(lt(t,7),0.12,if(lt(t,8.5),0,if(lt(t,13),0.42,0.42*(16-t)/3))))'
ffmpeg -f lavfi -i "aevalsrc=exprs='($A)*(sin(2*PI*220*t)+0.5*sin(2*PI*330*t)+0.3*sin(2*PI*440*t)+0.2*sin(2*PI*880*t))|($A)*(sin(2*PI*220*t+0.4)+0.5*sin(2*PI*277*t)+0.3*sin(2*PI*554*t))':sample_rate=48000:duration=16" -c:a pcm_s16le music-dynamic-16s.wav
```

Images for the image editor (generated with Pillow; no real photos). Each has a "TOP ↑" marker, so a wrong rotation is easy to see:

| File | What it is |
|---|---|
| `photo-landscape-4000x3000.jpg` | a normal landscape picture: sky, sun, mountain, grid |
| `photo-phone-exif-rotated.jpg` | like a phone photo: pixels stored as 4000×3000 landscape with **EXIF Orientation = 6**, so it should *display* as a 3000×4000 portrait with "TOP ↑" at the top-left |
| `logo-transparent.png` | 1200×1200 logo with a transparent background |
| `photo-huge-9000x6000.jpg` | a very large picture (54 megapixels) |
| `photo-tiny-160x90.png` | a tiny picture (upscaling) |

For the export queue (generated with ffmpeg, see the task notes for the command):

| File | What it is |
|---|---|
| `clip-long-30s.mp4` | 1280×720, 30 fps, 30 s test pattern with a 330 Hz tone and a red bar that grows left → right over the 30 s, so a render takes long enough to queue, cancel or reload during it, and any cut-off is easy to see |

For captions (the video is generated with ffmpeg; the caption files are plain text):

| File | What it is |
|---|---|
| `talk-portrait-20s.mp4` | 720×1280, 20 s test pattern; its audio is `voice-like-20s.wav`: 7 "speech" bursts at 0, 3, 6, 9, 12, 15, 18 s, each 1.8 s long |
| `captions-basic.srt` | 7 clean cues, one per burst (0–1.8 s, 3–4.8 s …) |
| `captions.vtt` | the same 7 cues as WebVTT, with a header, a `NOTE`, cue ids, cue settings (`position`, `size`, `line`, `align`) and a two-line cue |
| `captions-messy.srt` | real-world mess: UTF-8 **BOM**, **CRLF** line endings, cues **out of order**, a cue with **no index** and `.` instead of `,` in the time, an **overlap** (10.5 s starts before 10.8 s ends), an **empty** cue, `<i>`/`<b>` tags, one very **long line**, emoji, trailing blank lines. `ffmpeg -i captions-messy.srt -f srt -` reads it as 7 cues (sorted, the empty one dropped, tags kept) |
| `captions-multilang.srt` | 4 cues: Hindi (needs text shaping), Arabic (right-to-left), Japanese (no spaces to break lines on), and accented Latin with curly quotes |

For keyframe motion (generated with Pillow):

| File | What it is |
|---|---|
| `grid-target-4000x3000.png` | 4000×3000 grid, 8 columns × 6 rows, cells labelled A1…F8, a red ring and cross at the exact centre and a black arrow at the top centre, so zoom, pan and rotation can be read off any frame |

For beat detection (generated with ffmpeg; no real songs, so the beat times are known):

| File | What it is |
|---|---|
| `beat-120bpm-16s.wav` | a kick every 0.5 s from 0 s (120 BPM), every 4th louder, a quiet hi-hat between |
| `beat-95bpm-intro-20s.m4a` | 1.5 s of quiet hum, then 95 BPM (a beat every 0.632 s) |
| `beat-tempo-change-24s.m4a` | 100 BPM (every 0.6 s) for 12 s, then 128 BPM (every 0.469 s) |
| `ambient-no-beat-12s.m4a` | a soft chord that slowly swells and fades: no beat at all |
