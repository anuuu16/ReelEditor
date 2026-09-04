#!/usr/bin/env bash
# Repeats a video clip and an audio clip independently (e.g. a chant video looped 112x against
# a chant audio looped 27x), scales the video to the target resolution, and muxes them into one
# file. Uses ffmpeg's -stream_loop (demuxer-level repeat through a single linear filter chain)
# instead of building a branching filter_complex graph — the latter is what makes the editor's
# own export hang at high repeat counts / 4K (see packages/timeline-core/src/ffmpeg-plan.ts,
# which fans a repeated clip out into N parallel trim/scale chains feeding one big concat).
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: repeat-chant.sh -v VIDEO -a AUDIO -vn VIDEO_REPEATS -an AUDIO_REPEATS [options]

Required:
  -v,  --video FILE       source video clip to repeat
  -a,  --audio FILE       source audio clip to repeat
  -vn, --video-reps N     number of times to repeat the video (e.g. 112)
  -an, --audio-reps N     number of times to repeat the audio (e.g. 27)

Options:
  -o,  --output FILE      output file (default: chant_output.mp4)
  -w,  --width N          output width  (default: 3840)
       --height N          output height (default: 2160)
  -r,  --fps N            output frame rate (default: source video's fps)
       --fit MODE         fill|fit|stretch (default: fill)
       --crf N            x264 CRF, lower = higher quality (default: 20)
       --preset NAME      x264 preset (default: veryfast)
       --no-shortest      don't trim to the shorter of the two repeated tracks
  -h,  --help             show this help
EOF
  exit 1
}

VIDEO=""; AUDIO=""; VIDEO_REPS=""; AUDIO_REPS=""
OUTPUT="chant_output.mp4"
WIDTH=3840; HEIGHT=2160; FPS=""
FIT="fill"; CRF=20; PRESET="veryfast"
SHORTEST=1

while [ $# -gt 0 ]; do
  case "$1" in
    -v|--video) VIDEO="$2"; shift 2 ;;
    -a|--audio) AUDIO="$2"; shift 2 ;;
    -vn|--video-reps) VIDEO_REPS="$2"; shift 2 ;;
    -an|--audio-reps) AUDIO_REPS="$2"; shift 2 ;;
    -o|--output) OUTPUT="$2"; shift 2 ;;
    -w|--width) WIDTH="$2"; shift 2 ;;
    --height) HEIGHT="$2"; shift 2 ;;
    -r|--fps) FPS="$2"; shift 2 ;;
    --fit) FIT="$2"; shift 2 ;;
    --crf) CRF="$2"; shift 2 ;;
    --preset) PRESET="$2"; shift 2 ;;
    --no-shortest) SHORTEST=0; shift ;;
    --help) usage ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
done

[ -n "$VIDEO" ] && [ -n "$AUDIO" ] && [ -n "$VIDEO_REPS" ] && [ -n "$AUDIO_REPS" ] || usage
command -v ffmpeg >/dev/null || { echo "ffmpeg not found on PATH" >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "ffprobe not found on PATH" >&2; exit 1; }
[ -f "$VIDEO" ] || { echo "Video file not found: $VIDEO" >&2; exit 1; }
[ -f "$AUDIO" ] || { echo "Audio file not found: $AUDIO" >&2; exit 1; }
[ "$VIDEO_REPS" -ge 1 ] 2>/dev/null || { echo "--video-reps must be a positive integer" >&2; exit 1; }
[ "$AUDIO_REPS" -ge 1 ] 2>/dev/null || { echo "--audio-reps must be a positive integer" >&2; exit 1; }

case "$FIT" in
  fill)    FIT_FILTER="scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}" ;;
  fit)     FIT_FILTER="scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black" ;;
  stretch) FIT_FILTER="scale=${WIDTH}:${HEIGHT}" ;;
  *) echo "--fit must be one of fill|fit|stretch" >&2; exit 1 ;;
esac

if [ -z "$FPS" ]; then
  FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$VIDEO")
fi

video_duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO")
audio_duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO")
video_total=$(awk -v d="$video_duration" -v n="$VIDEO_REPS" 'BEGIN{printf "%.2f", d*n}')
audio_total=$(awk -v d="$audio_duration" -v n="$AUDIO_REPS" 'BEGIN{printf "%.2f", d*n}')
echo "Video: ${video_duration}s x ${VIDEO_REPS} = ${video_total}s"
echo "Audio: ${audio_duration}s x ${AUDIO_REPS} = ${audio_total}s"
diff=$(awk -v a="$video_total" -v b="$audio_total" 'BEGIN{d=a-b; if(d<0)d=-d; printf "%.2f", d}')
if awk -v d="$diff" 'BEGIN{exit !(d>2)}'; then
  echo "Warning: repeated tracks differ by ${diff}s — output will be trimmed to the shorter one unless --no-shortest is set" >&2
fi

SHORTEST_ARGS=()
[ "$SHORTEST" -eq 1 ] && SHORTEST_ARGS=(-shortest)

ffmpeg -y \
  -stream_loop $((VIDEO_REPS - 1)) -i "$VIDEO" \
  -stream_loop $((AUDIO_REPS - 1)) -i "$AUDIO" \
  -map 0:v:0 -map 1:a:0 \
  -vf "${FIT_FILTER},fps=${FPS},setsar=1" \
  -c:v libx264 -preset "$PRESET" -crf "$CRF" -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  "${SHORTEST_ARGS[@]}" \
  -movflags +faststart \
  "$OUTPUT"

echo "Done: $OUTPUT"
