// 読み上げ（ナレーション）。読み上げサービスのキーがあるときだけ動き、なければ今までどおり無音で書き出す。
// キーは環境変数から読むだけで、ファイルやログには書かない。
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const TTS_KEYS = ['WALKTHROUGH_VIDEO_TTS', 'DECISION_BOARD_TTS', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL', 'GOOGLE_TTS_API_KEY', 'GOOGLE_TTS_VOICE'];

/**
 * 読み上げのキーは環境変数か、$WALKTHROUGH_VIDEO_HOME/.env（KEY=値 の行）から読む。環境変数が優先。
 * .env からは読み上げ用のキーだけを取り込む。値は表示しない。
 */
export async function ttsEnv(home, env = process.env) {
  const merged = { ...env };
  let text = '';
  try { text = await readFile(path.join(home, '.env'), 'utf8'); } catch { return merged; }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !TTS_KEYS.includes(match[1])) continue;
    // TextEdit などで付いた引用符（飾り引用符も）を外す。
    const value = match[2].replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
    if (value && !merged[match[1]]) merged[match[1]] = value;
  }
  return merged;
}

/**
 * 読み方の辞書。読み上げに送る文だけを置き換え、字幕の表記は変えない。
 * $WALKTHROUGH_VIDEO_HOME/readings.txt の「表記=読み」の行と、台本の readings（{ 表記: 読み }）を合わせる。台本が優先。
 * @returns {Promise<[string, string][]>} 長い表記から順に並べたもの（短い表記が長い表記の一部を壊さないため）
 */
export async function loadReadings(home, storyboard = {}) {
  const readings = new Map();
  let text = '';
  try { text = await readFile(path.join(home, 'readings.txt'), 'utf8'); } catch { /* The dictionary is optional. */ }
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const from = line.slice(0, index).trim();
    const to = line.slice(index + 1).trim();
    if (from && to) readings.set(from, to);
  }
  for (const [from, to] of Object.entries(storyboard.readings ?? {})) if (typeof to === 'string' && from && to) readings.set(from, to);
  return [...readings].sort((a, b) => b[0].length - a[0].length);
}

export function applyReadings(text, readings) {
  if (!text || !readings.length) return text;
  // 一度に置き換え、置き換えた後の読みを別の表記として置き換え直さない。
  const pattern = new RegExp(readings.map(([from]) => from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const table = new Map(readings);
  return text.replace(pattern, (match) => table.get(match));
}

const circledNumber = (n) => `${n}つ目`;
const resultWord = { ok: 'OK', ng: '直すところあり', unsure: '気になるところあり' };

/**
 * 場面ごとに読み上げる文。scene.narration が文字列ならそれを、false なら読まない。
 * 省略時は字幕を読み、冒頭は見るところ・選択肢、変更点は what、最後は結果を読む。
 * @param {any} timeline buildTimeline の結果（changes の自動挿入後の場面）
 * @returns {(string|null)[]}
 */
export function narrationTexts(timeline) {
  let previousCaption;
  // 見るところと選択肢は冒頭で並べず、初めて出てくる場面で読む。
  const spokenChecks = new Set();
  const spokenOptions = new Set();
  return timeline.scenes.map((scene) => {
    if (scene.narration === false) return null;
    if (typeof scene.narration === 'string') return scene.narration.trim() || null;
    if (scene.type === 'title') return `${timeline.title}。`;
    if (scene.type === 'changes') return ['前回からの変更です', ...scene.items.map((item) => item.what)].join('。') + '。';
    if (scene.type === 'end') {
      const results = scene.results ?? [];
      if (timeline.checks?.length && results.length) return ['確認の結果です', ...timeline.checks.map((_, index) => `${circledNumber(index + 1)}は${resultWord[results[index]] ?? '未確認'}`)].join('。') + '。';
      const recommended = timeline.options?.find((option) => option.recommended);
      if (recommended) return `推奨は${recommended.label}です。`;
      return scene.text ? `${scene.text}。` : null;
    }
    // 同じ字幕が続く場面は、読み直さない。
    const caption = scene.caption?.trim();
    const repeated = caption && caption === previousCaption;
    previousCaption = caption;
    const parts = [];
    const optionIndex = timeline.options?.findIndex((option) => option.id === scene.option) ?? -1;
    if (optionIndex >= 0 && !spokenOptions.has(scene.option)) {
      spokenOptions.add(scene.option);
      parts.push(`${String.fromCharCode(65 + optionIndex)}案、${timeline.options[optionIndex].label}`);
    }
    if (caption && !repeated) parts.push(caption);
    const check = timeline.checks?.[scene.check - 1];
    if (check && !spokenChecks.has(scene.check)) {
      spokenChecks.add(scene.check);
      parts.push(`ここで見るのは${circledNumber(scene.check)}、${check}`);
    }
    return parts.length ? parts.join('。') + '。' : null;
  });
}

/**
 * 使う読み上げサービス。台本の voice.provider か環境変数 WALKTHROUGH_VIDEO_TTS（旧名 DECISION_BOARD_TTS も可）で明示できる。
 * 明示がなければ、キーのあるものを ElevenLabs → Google の順に選ぶ。say（macOS）は明示したときだけ。
 * @returns {null | { provider: 'elevenlabs'|'google'|'say', voice?: string, model?: string, speed?: number }}
 */
export function resolveVoice(storyboard, env = process.env) {
  const voice = storyboard.voice;
  if (voice === false) return null;
  const requested = (voice && typeof voice === 'object' ? voice.provider : undefined) ?? env.WALKTHROUGH_VIDEO_TTS ?? env.DECISION_BOARD_TTS;
  const provider = requested ?? (env.ELEVENLABS_API_KEY ? 'elevenlabs' : env.GOOGLE_TTS_API_KEY ? 'google' : null);
  if (!provider || provider === 'none') return null;
  if (!['elevenlabs', 'google', 'say'].includes(provider)) throw new Error(`voice.provider は elevenlabs / google / say のどれかを指定してください: ${provider}`);
  if (provider === 'elevenlabs' && !env.ELEVENLABS_API_KEY) throw new Error('ElevenLabs を使うには環境変数 ELEVENLABS_API_KEY が必要です');
  if (provider === 'google' && !env.GOOGLE_TTS_API_KEY) throw new Error('Google の読み上げを使うには環境変数 GOOGLE_TTS_API_KEY が必要です');
  const options = voice && typeof voice === 'object' ? voice : {};
  if (provider === 'elevenlabs') return { provider, voice: options.voice ?? env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM', model: options.model ?? env.ELEVENLABS_MODEL ?? 'eleven_v4' };
  if (provider === 'google') return { provider, voice: options.voice ?? env.GOOGLE_TTS_VOICE ?? 'ja-JP-Chirp3-HD-Charon', speed: options.speed ?? 1.1 };
  return { provider, voice: options.voice ?? 'Kyoko' };
}

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(`${executable} failed (${code})`)));
  });
}

// 混み合い（429）やサーバー側のエラーは、少し待ってやり直す。失敗の理由はサービスの返す内容から短く添える（キーは含めない）。
async function request(name, fetchImpl, url, init, { retries = 4, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, init);
    if (response.ok) return response;
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      const after = Number(response.headers?.get?.('retry-after'));
      await wait(Number.isFinite(after) && after > 0 ? after * 1000 : 1500 * 2 ** attempt);
      continue;
    }
    let reason = '';
    try {
      const body = await response.json();
      reason = String(body?.detail?.status ?? body?.detail?.message ?? body?.error?.status ?? body?.error?.message ?? '').slice(0, 120);
    } catch { /* The body is optional. */ }
    throw new Error(`${name} の読み上げに失敗しました（${response.status}${reason ? `: ${reason}` : ''}）`);
  }
}

async function synthesize(voice, text, env, fetchImpl, options) {
  if (voice.provider === 'elevenlabs') {
    const response = await request('ElevenLabs', fetchImpl, `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voice)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
      // 言語を指定できるモデル（v2.5 系・v3・v4）には日本語を明示し、カタカナ語を英語として読ませない。
      body: JSON.stringify({ text, model_id: voice.model, ...(/v2_5|v3|v4/.test(voice.model ?? '') ? { language_code: voice.language ?? 'ja' } : {}) }),
    }, options);
    return Buffer.from(await response.arrayBuffer());
  }
  if (voice.provider === 'google') {
    // キーは URL に載せず、ヘッダーで渡す。
    const response = await request('Google', fetchImpl, 'https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { 'x-goog-api-key': env.GOOGLE_TTS_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice: { languageCode: voice.voice.split('-').slice(0, 2).join('-'), name: voice.voice }, audioConfig: { audioEncoding: 'MP3', speakingRate: voice.speed } }),
    }, options);
    const body = await response.json();
    if (typeof body.audioContent !== 'string') throw new Error('Google の読み上げが音声を返しませんでした');
    return Buffer.from(body.audioContent, 'base64');
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'walkthrough-video-say-'));
  try {
    const aiff = path.join(directory, 'voice.aiff');
    const mp3 = path.join(directory, 'voice.mp3');
    await run('say', ['-v', voice.voice, '-o', aiff, text]);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-codec:a', 'libmp3lame', '-b:a', '128k', mp3]);
    return await readFile(mp3);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function audioSeconds(file) {
  const value = Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])).trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`音声の長さを取得できません: ${file}`);
  return value;
}

/**
 * 読み上げ音声を作る。同じサービス・声・文なら cacheDir から使い回す（料金と時間をかけない）。
 * @returns {Promise<string>} mp3 のパス
 */
export async function narrationFile(voice, text, { cacheDir, env = process.env, fetchImpl = globalThis.fetch, retry } = {}) {
  const key = createHash('sha256').update(JSON.stringify([voice.provider, voice.voice, voice.model ?? '', voice.speed ?? '', text])).digest('hex');
  const file = path.join(cacheDir, `${key}.mp3`);
  try { await readFile(file); return file; } catch { /* Not cached yet. */ }
  await mkdir(cacheDir, { recursive: true });
  const audio = await synthesize(voice, text, env, fetchImpl, retry);
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, audio);
  await rename(temporary, file);
  return file;
}
