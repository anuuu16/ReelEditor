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
