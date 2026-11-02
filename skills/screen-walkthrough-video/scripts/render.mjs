#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { buildTimeline, makeChecks, FPS } from './timing.mjs';
import { narrationTexts, resolveVoice, narrationFile, audioSeconds, ttsEnv, loadReadings, applyReadings } from './narration.mjs';

const project = path.dirname(fileURLToPath(import.meta.url));
const [input, output, ...extra] = process.argv.slice(2);
if (!input || !output || extra.length) throw new Error('使い方: node render.mjs <storyboard.json> <out.mp4>');
if (path.extname(output).toLowerCase() !== '.mp4') throw new Error('出力先は .mp4 を指定してください');

function command(executable, args, { capture = false, cwd = project } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    const chunks = [];
    if (capture) child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(`${executable} failed (${code})`)));
  });
}

async function probe(file) {
  const result = JSON.parse(await command('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { capture: true }));
  const stream = result.streams?.[0];
  if (!(stream?.width > 0 && stream?.height > 0)) throw new Error(`映像サイズを取得できません: ${file}`);
  return { size: [stream.width, stream.height], duration: Number(result.format?.duration) };
}

const storyboardPath = path.resolve(input);
const assetRoot = path.dirname(storyboardPath);
const out = path.resolve(output);
const storyboard = JSON.parse(await readFile(storyboardPath, 'utf8'));
storyboard.size ??= [1280, 720];
if (!Array.isArray(storyboard.size) || storyboard.size.length !== 2 || storyboard.size.some((n) => !Number.isInteger(n) || n < 2 || n % 2)) throw new Error('size は偶数の正整数 [width,height] を指定してください');
if (typeof storyboard.title !== 'string' || !Array.isArray(storyboard.scenes) || !storyboard.scenes.length) throw new Error('title と scenes が必要です');
if (storyboard.checks !== undefined && (!Array.isArray(storyboard.checks) || storyboard.checks.length > 3 || storyboard.checks.some((check) => typeof check !== 'string'))) throw new Error('checks は文字列の配列（最大3件）を指定してください');
if (storyboard.options !== undefined && (!Array.isArray(storyboard.options) || storyboard.options.some((option) => !option || typeof option.id !== 'string' || !option.id.trim() || typeof option.label !== 'string' || !option.label.trim() || (option.recommended !== undefined && typeof option.recommended !== 'boolean')))) throw new Error('options は id・label・任意の recommended を持つ配列を指定してください');
if (new Set(storyboard.options?.map((option) => option.id)).size !== (storyboard.options?.length ?? 0)) throw new Error('options の id は重複できません');
for (const [index, scene] of storyboard.scenes.entries()) {
  if (scene.option !== undefined && !storyboard.options?.some((option) => option.id === scene.option)) throw new Error(`Scene ${index + 1}: option の id が不正です`);
}

if (!existsSync(path.join(project, 'node_modules'))) {
  try { await command('pnpm', ['install', '--ignore-workspace', '--config.strict-dep-builds=false']); }
  catch { console.warn('pnpm install に失敗したため npm install を試します'); await command('npm', ['install']); }
}

const temporary = await mkdtemp(path.join(os.tmpdir(), 'walkthrough-video-'));
try {
  const publicDir = path.join(temporary, 'public');
  await mkdir(publicDir);
  const assets = new Map();
  async function asset(reference) {
    if (typeof reference !== 'string' || !reference) throw new Error('素材のパスが必要です');
    const source = path.resolve(assetRoot, reference);
    if (assets.has(source)) return assets.get(source);
    const extension = path.extname(source).toLowerCase();
    const convert = ['.gif', '.webm', '.mov'].includes(extension);
    const name = `asset-${assets.size}${convert ? '.mp4' : extension}`;
    const destination = path.join(publicDir, name);
    if (convert) {
      await command('ffmpeg', ['-y', '-i', source, '-an', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', destination]);
    } else await copyFile(source, destination);
    const value = { name, destination };
    assets.set(source, value);
    return value;
  }
  for (let index = 0; index < storyboard.scenes.length; index++) {
    const scene = storyboard.scenes[index];
    // `type` also names the typing overlay in the spec. Canonical JSON uses
    // overlays.type; accept image + a type object as the unambiguous shorthand.
    if (scene.type && typeof scene.type === 'object' && scene.image) {
      scene.typing = scene.type;
      scene.type = 'shot';
    }
    if (!['title', 'context', 'changes', 'shot', 'clip', 'diagram', 'end'].includes(scene.type)) throw new Error(`Scene ${index + 1}: 未対応の type`);
    if (scene.check !== undefined && (!Number.isInteger(scene.check) || scene.check < 1 || scene.check > (storyboard.checks?.length ?? 0))) throw new Error(`Scene ${index + 1}: check の番号が不正です`);
    if (scene.type === 'shot' || scene.type === 'clip') {
      const key = scene.type === 'shot' ? 'image' : 'src';
      const copied = await asset(scene[key]);
      scene[key] = copied.name;
      const metadata = await probe(copied.destination);
      scene.mediaSize = metadata.size;
      if (scene.type === 'clip') {
        scene.mediaDuration = metadata.duration;
        if (!Number.isFinite(scene.mediaDuration) || scene.mediaDuration <= 0 || !Number.isFinite(scene.speed ?? 1) || (scene.speed ?? 1) <= 0) throw new Error(`Scene ${index + 1}: 動画の長さまたは speed が不正です`);
        if (scene.trim !== undefined && (!Array.isArray(scene.trim) || scene.trim.length !== 2 || !scene.trim.every(Number.isFinite) || scene.trim[0] < 0 || scene.trim[1] <= scene.trim[0] || scene.trim[1] > scene.mediaDuration + 1 / FPS)) throw new Error(`Scene ${index + 1}: trim が動画の範囲外です`);
      }
    } else if (scene.type === 'diagram') {
      const copied = await asset(scene.svg);
      scene.svg = copied.name;
      scene.svgText = await readFile(copied.destination, 'utf8');
      const tag = scene.svgText.match(/<svg\b[^>]*>/i)?.[0] ?? '';
      const viewBox = tag.match(/\bviewBox\s*=\s*["']([^"']+)["']/)?.[1].trim().split(/[\s,]+/).map(Number);
      const width = Number.parseFloat(tag.match(/\bwidth\s*=\s*["']([\d.]+)/)?.[1]);
      const height = Number.parseFloat(tag.match(/\bheight\s*=\s*["']([\d.]+)/)?.[1]);
      scene.mediaSize = viewBox?.length === 4 ? viewBox.slice(2) : [width, height];
      if (scene.mediaSize.some((n) => !Number.isFinite(n) || n <= 0)) throw new Error(`Scene ${index + 1}: SVG の viewBox または width/height が必要です`);
    }
  }
  // 読み上げ: サービスのキーがあれば、場面ごとの文を音声にし、読み終わるまで場面を延ばす。なければ無音。
  // キー・読み方・キャッシュの置き場所。新しい置き場所がまだ無ければ decision-board の置き場所を使う。
  const defaultHome = path.join(os.homedir(), '.screen-walkthrough-video');
  const legacyHome = process.env.DECISION_BOARD_HOME || path.join(os.homedir(), '.decision-board');
  const home = path.resolve(process.env.WALKTHROUGH_VIDEO_HOME || (!existsSync(defaultHome) && existsSync(legacyHome) ? legacyHome : defaultHome));
  const env = await ttsEnv(home);
  const voice = resolveVoice(storyboard, env);
  let narration = [];
  if (voice) {
    const readings = await loadReadings(home, storyboard);
    const texts = narrationTexts(buildTimeline(storyboard)).map((text) => applyReadings(text, readings));
    // 読み上げサービスは同時に頼める数が限られるので、1 場面ずつ順に頼む。
    for (const [index, text] of texts.entries()) {
      if (!text) { narration.push(null); continue; }
      const cached = await narrationFile(voice, text, { cacheDir: path.join(home, 'tts-cache'), env });
      const name = `narration-${index}.mp3`;
      await copyFile(cached, path.join(publicDir, name));
      narration.push({ file: name, seconds: await audioSeconds(cached) });
    }
    console.log(`読み上げ: ${voice.provider}（${narration.filter(Boolean).length} 場面）`);
  }
  const timeline = buildTimeline(storyboard, { narration });
  const narrated = timeline.scenes.some((scene) => scene.audio);
  const inputProps = { timeline };
  const { bundle } = await import('@remotion/bundler');
  const { selectComposition, renderMedia } = await import('@remotion/renderer');
  const serveUrl = await bundle({ entryPoint: path.join(project, 'src/index.tsx'), publicDir, outDir: path.join(temporary, 'bundle') });
  const composition = await selectComposition({ serveUrl, id: 'BoardVideo', inputProps });
  await mkdir(path.dirname(out), { recursive: true });
  const rendered = path.join(temporary, 'rendered.mp4');
  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    outputLocation: rendered,
    codec: 'h264',
    pixelFormat: 'yuv420p',
    muted: !narrated,
  });
  // Re-encode to limited-range yuv420p (not yuvj), faststart. 読み上げがあれば AAC で音声を残す。
  // 読み上げサービスごとに音量が違うので、聞きやすい大きさにそろえる。
  const audioArgs = narrated ? ['-map', '0:a:0', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '128k'] : ['-an'];
  await command('ffmpeg', ['-y', '-i', rendered, '-map', '0:v:0', ...audioArgs, '-vf', 'scale=in_range=full:out_range=tv', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out]);
  await writeFile(`${out}.checks.json`, JSON.stringify(makeChecks(timeline), null, 2) + '\n');
  console.log(`${out}\n${out}.checks.json`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
