#!/bin/bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo '使い方: to-mp4.sh <input.gif|input.webm|input.mov|画像ディレクトリ> <out.mp4>' >&2
  exit 1
fi
command -v ffmpeg >/dev/null || { echo 'ffmpeg が必要です' >&2; exit 1; }
input=$1
output=$2
if [[ -d "$input" ]]; then
  manifest=$(mktemp "${TMPDIR:-/tmp}/walkthrough-video-slides.XXXXXX")
  trap 'rm -f "$manifest"' EXIT
  # Node provides portable filename sorting, including spaces and apostrophes.
  duration=$(node --input-type=module - "$input" "$manifest" <<'JS'
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const directory = path.resolve(process.argv[2]);
const files = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(png|jpe?g)$/i.test(entry.name))
  .map((entry) => entry.name).sort();
if (!files.length) throw new Error('png / jpg がありません');
const quote = (name) => "'" + path.join(directory, name).replace(/'/g, "'\\''") + "'";
if (files.some((name) => /[\r\n]/.test(name))) throw new Error('改行を含むファイル名は使用できません');
writeFileSync(process.argv[3], files.map((name) => `file ${quote(name)}\nduration 1.2\n`).join('') + `file ${quote(files.at(-1))}\n`);
console.log((files.length * 1.2).toFixed(1));
JS
  )
  ffmpeg -y -f concat -safe 0 -i "$manifest" -t "$duration" \
    -vf 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1' \
    -r 30 -c:v libx264 -pix_fmt yuv420p -an -movflags +faststart "$output"
else
  case "$input" in
    *.[gG][iI][fF]|*.[wW][eE][bB][mM]|*.[mM][oO][vV]) ;;
    *) echo '入力は gif / webm / mov または画像ディレクトリを指定してください' >&2; exit 1 ;;
  esac
  ffmpeg -y -i "$input" -vf 'scale=trunc(min(1280\,iw)/2)*2:-2,setsar=1' \
    -c:v libx264 -pix_fmt yuv420p -an -movflags +faststart "$output"
fi
