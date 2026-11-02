#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const FPS = 30;
const USAGE = 'Usage: node inspect.mjs <video.mp4> <inspection-dir>\nRequires <video.mp4>.checks.json, ffprobe and ffmpeg. Extracted PNGs require visual review; this tool does not judge check results.';

export function validateSidecar(value) {
  if (!value || typeof value.duration !== 'number' || !Number.isFinite(value.duration) || value.duration <= 0) throw new Error('Sidecar duration must be a positive number');
  if (!Array.isArray(value.checks)) throw new Error('Sidecar checks must be an array');
  const numbers = new Set();
  for (const check of value.checks) {
    if (!check || !Number.isInteger(check.n) || check.n < 1 || numbers.has(check.n)) throw new Error('Each check needs a unique positive integer n');
    numbers.add(check.n);
    if (typeof check.at !== 'number' || !Number.isFinite(check.at) || check.at < 0 || check.at >= value.duration) throw new Error(`Check ${check.n}: at must be inside the video`);
    if (typeof check.text !== 'string' || !check.text.trim()) throw new Error(`Check ${check.n}: text must be nonempty`);
    if (check.result !== undefined && !['ok', 'ng', 'unsure'].includes(check.result)) throw new Error(`Check ${check.n}: invalid result`);
  }
  return value;
}

const rate = (value) => {
  const match = /^(\d+)(?:\/(\d+))?$/.exec(String(value));
  return match ? Number(match[1]) / Number(match[2] ?? 1) : NaN;
};

export function validateMetadata(probe, expectedDuration) {
  const stream = probe?.streams?.find((item) => item.codec_type === 'video');
  if (!stream || stream.codec_name !== 'h264') throw new Error('Video codec must be H.264');
  if (stream.pix_fmt !== 'yuv420p') throw new Error('Video pixel format must be yuv420p');
  if (![stream.avg_frame_rate, stream.r_frame_rate].every((value) => Number.isFinite(rate(value)) && Math.abs(rate(value) - FPS) <= 1e-6)) throw new Error('Video frame rate must be 30fps');
  if (![stream.width, stream.height].every((n) => Number.isInteger(n) && n > 0 && n % 2 === 0)) throw new Error('Video size must have positive even dimensions');
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || Math.abs(duration - expectedDuration) > 1 / FPS + 1e-6) throw new Error('Video duration differs from sidecar by more than one frame');
  if (stream.duration !== undefined && (!Number.isFinite(Number(stream.duration)) || Math.abs(Number(stream.duration) - expectedDuration) > 1 / FPS + 1e-6)) throw new Error('Video stream duration differs from sidecar by more than one frame');
  return { codec: stream.codec_name, pixelFormat: stream.pix_fmt, fps: FPS, width: stream.width, height: stream.height, duration };
}

export function inspectionFrames(sidecar, actualDuration = sidecar.duration) {
  validateSidecar(sidecar);
  const end = Math.min(sidecar.duration, actualDuration);
  if (!Number.isFinite(end) || end <= 0) throw new Error('Video duration must be positive');
  const frames = [{ kind: 'opening', at: 0, file: 'opening.png' }];
  for (const check of sidecar.checks) {
    const next = Math.min(end, ...sidecar.checks.filter((other) => other.at > check.at).map((other) => other.at));
    if (check.at >= next) throw new Error(`Check ${check.n} is outside actual video duration`);
    // Sample after the fade, close to the check start: later scenes may have no check.
    frames.push({ kind: 'check', n: check.n, at: check.at + Math.min(1, (next - check.at) / 2), file: `check-${check.n}.png`, text: check.text, ...(check.result === undefined ? {} : { result: check.result }) });
  }
  frames.push({ kind: 'ending', at: Math.max(0, end - Math.min(0.5, end / 2)), file: 'ending.png' });
  return frames;
}

function command(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    child.stdout.on('data', (data) => stdout.push(data));
    child.stderr.on('data', (data) => stderr.push(data));
    child.once('error', reject);
    child.once('close', (code) => {
      const errors = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0 || errors) reject(new Error(`${executable} failed (${code}): ${errors}`));
      else resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

export async function inspectVideo(input, directory) {
  const video = path.resolve(input), output = path.resolve(directory);
  if (path.extname(video).toLowerCase() !== '.mp4') throw new Error('Input must be an .mp4 video');
  const sidecar = validateSidecar(JSON.parse(await readFile(`${video}.checks.json`, 'utf8')));
  const probe = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video]));
  const metadata = validateMetadata(probe, sidecar.duration);
  // Decode every audio/video packet, not only the frames extracted below.
  await command('ffmpeg', ['-v', 'error', '-xerror', '-i', video, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-']);
  const frames = inspectionFrames(sidecar, metadata.duration);
  await mkdir(output, { recursive: true });
  for (const frame of frames) {
    await rm(path.join(output, frame.file), { force: true });
    await command('ffmpeg', ['-v', 'error', '-xerror', '-y', '-i', video, '-ss', String(frame.at), '-frames:v', '1', '-update', '1', path.join(output, frame.file)]);
    // ffmpeg can exit successfully without writing an image for an empty seek.
    const png = await readFile(path.join(output, frame.file));
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Missing PNG frame: ${frame.file}`);
  }
  const report = { video, metadata, decode: 'passed', visualReview: 'required', frames };
  await writeFile(path.join(output, 'inspection.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log(USAGE);
  else if (args.length !== 2 || args.some((arg) => arg.startsWith('--'))) { console.error(USAGE); process.exitCode = 1; }
  else inspectVideo(...args).then((report) => console.log(`Decoded video and extracted ${report.frames.length} frames. Review ${path.resolve(args[1], 'inspection.json')}`)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
