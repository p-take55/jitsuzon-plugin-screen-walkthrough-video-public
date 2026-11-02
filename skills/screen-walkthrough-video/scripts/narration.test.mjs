import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { narrationTexts, resolveVoice, narrationFile, ttsEnv, loadReadings, applyReadings } from './narration.mjs';
import { writeFile } from 'node:fs/promises';
import { buildTimeline, makeChecks, FPS, NARRATION_LEAD_SECONDS, NARRATION_TAIL_SECONDS } from './timing.mjs';

const storyboard = {
  title: 'メンションの確認',
  checks: ['候補が出る', 'チップになる'],
  changes: [{ what: '共有も候補に出した', why: '出ないという指摘' }],
  scenes: [
    { type: 'title' },
    { type: 'shot', caption: '@ を打つ', check: 1 },
    { type: 'shot', caption: '@ を打つ', check: 1 },
    { type: 'shot', caption: '黙る場面', narration: false },
    { type: 'shot', caption: '字幕', narration: '字幕とは別の読み上げ' },
    { type: 'end', results: ['ok', 'ng'] },
  ],
};

test('narration starts concrete: title only, checks and options where they first appear, captions once, overrides, and results', () => {
  assert.deepEqual(narrationTexts(buildTimeline(storyboard)), [
    'メンションの確認。',
    '前回からの変更です。共有も候補に出した。',
    '@ を打つ。ここで見るのは1つ目、候補が出る。',
    null,
    null,
    '字幕とは別の読み上げ',
    '確認の結果です。1つ目はOK。2つ目は直すところあり。',
  ]);
  const decide = buildTimeline({ title: '並び順', options: [{ id: 'a', label: '最近使った順', recommended: true }, { id: 'b', label: '名前順' }], scenes: [{ type: 'title' }, { type: 'shot', caption: '開いた直後', option: 'a' }, { type: 'shot', caption: '並びが変わる', option: 'a' }, { type: 'end' }] });
  assert.deepEqual(narrationTexts(decide), ['並び順。', 'A案、最近使った順。開いた直後。', '並びが変わる。', '推奨は最近使った順です。']);
});

test('voice is chosen from keys (ElevenLabs first), explicit choices win, and say is never automatic', () => {
  assert.equal(resolveVoice({}, {}), null, 'no key keeps videos silent');
  assert.equal(resolveVoice({ voice: false }, { ELEVENLABS_API_KEY: 'k' }), null);
  assert.equal(resolveVoice({}, { WALKTHROUGH_VIDEO_TTS: 'none', ELEVENLABS_API_KEY: 'k' }), null);
  assert.deepEqual(resolveVoice({}, { ELEVENLABS_API_KEY: 'k', GOOGLE_TTS_API_KEY: 'g' }), { provider: 'elevenlabs', voice: '21m00Tcm4TlvDq8ikWAM', model: 'eleven_v4' });
  assert.deepEqual(resolveVoice({}, { ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'v1', ELEVENLABS_MODEL: 'm1' }), { provider: 'elevenlabs', voice: 'v1', model: 'm1' });
  assert.deepEqual(resolveVoice({}, { GOOGLE_TTS_API_KEY: 'g' }), { provider: 'google', voice: 'ja-JP-Chirp3-HD-Charon', speed: 1.1 });
  assert.equal(resolveVoice({ voice: { provider: 'google', voice: 'ja-JP-Neural2-C' } }, { ELEVENLABS_API_KEY: 'k', GOOGLE_TTS_API_KEY: 'g' }).voice, 'ja-JP-Neural2-C');
  assert.deepEqual(resolveVoice({ voice: { provider: 'say' } }, {}), { provider: 'say', voice: 'Kyoko' });
  assert.throws(() => resolveVoice({ voice: { provider: 'elevenlabs' } }, {}), /ELEVENLABS_API_KEY/);
  assert.throws(() => resolveVoice({}, { WALKTHROUGH_VIDEO_TTS: 'google' }), /GOOGLE_TTS_API_KEY/);
  assert.throws(() => resolveVoice({ voice: { provider: 'other' } }, {}), /voice.provider/);
});

test('ElevenLabs and Google requests carry keys in headers only, and audio is cached by voice and text', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'walkthrough-video-tts-'));
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith('https://api.elevenlabs.io/')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode('ELEVEN').buffer };
    return { ok: true, json: async () => ({ audioContent: Buffer.from('GOOGLE').toString('base64') }) };
  };
  const env = { ELEVENLABS_API_KEY: 'secret-eleven', GOOGLE_TTS_API_KEY: 'secret-google' };
  const eleven = { provider: 'elevenlabs', voice: 'v 1', model: 'eleven_multilingual_v2' };
  const first = await narrationFile(eleven, 'こんにちは', { cacheDir, env, fetchImpl });
  const again = await narrationFile(eleven, 'こんにちは', { cacheDir, env, fetchImpl });
  assert.equal(first, again);
  assert.equal(calls.length, 1, 'the same voice and text are not synthesized twice');
  assert.equal(await readFile(first, 'utf8'), 'ELEVEN');
  assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/text-to-speech/v%201?output_format=mp3_44100_128');
  assert.equal(calls[0].init.headers['xi-api-key'], 'secret-eleven');
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: 'こんにちは', model_id: 'eleven_multilingual_v2' });

  const google = await narrationFile({ provider: 'google', voice: 'ja-JP-Neural2-B', speed: 1.1 }, 'こんにちは', { cacheDir, env, fetchImpl });
  assert.notEqual(google, first, 'different voices are cached separately');
  assert.equal(await readFile(google, 'utf8'), 'GOOGLE');
  assert.equal(calls[1].url, 'https://texttospeech.googleapis.com/v1/text:synthesize');
  assert.equal(calls[1].init.headers['x-goog-api-key'], 'secret-google');
  assert.deepEqual(JSON.parse(calls[1].init.body).voice, { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' });
  for (const call of calls) assert.ok(!call.url.includes('secret'), 'keys never appear in URLs');

  await assert.rejects(narrationFile(eleven, '失敗', { cacheDir, env, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ detail: { status: 'invalid_api_key' } }) }) }), (error) => /401: invalid_api_key/.test(error.message) && !error.message.includes('secret'));
  let attempts = 0;
  const busy = async () => (++attempts < 3 ? { ok: false, status: 429, headers: { get: () => null } } : { ok: true, arrayBuffer: async () => new TextEncoder().encode('RETRY').buffer });
  const retried = await narrationFile(eleven, '混雑', { cacheDir, env, fetchImpl: busy, retry: { wait: async () => {} } });
  assert.equal(attempts, 3, '429 is retried');
  assert.equal(await readFile(retried, 'utf8'), 'RETRY');
  await assert.rejects(narrationFile(eleven, 'ずっと混雑', { cacheDir, env, fetchImpl: async () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({ detail: { status: 'too_many_concurrent_requests' } }) }), retry: { retries: 1, wait: async () => {} } }), /429: too_many_concurrent_requests/);
});

test('narrated scenes last until the voice ends, regardless of pace, and the sidecar says so', () => {
  const base = { title: 'x', scenes: [{ type: 'shot', caption: '短い' }, { type: 'shot', caption: '短い2' }] };
  const narration = [{ file: 'narration-0.mp3', seconds: 6 }, null];
  for (const pace of [0.5, 1]) {
    const timeline = buildTimeline({ ...base, pace }, { narration });
    const minimum = Math.ceil((NARRATION_LEAD_SECONDS + 6 + NARRATION_TAIL_SECONDS) * FPS - 1e-9);
    assert.ok(timeline.scenes[0].durationInFrames >= minimum, `pace ${pace}`);
    assert.equal(timeline.scenes[0].audio, 'narration-0.mp3');
    assert.equal(timeline.scenes[0].audioDelayFrames, Math.ceil(NARRATION_LEAD_SECONDS * FPS));
    assert.equal(timeline.scenes[1].audio, undefined);
    assert.equal(makeChecks(timeline).narrated, true);
  }
  assert.equal(makeChecks(buildTimeline(base)).narrated, undefined, 'silent videos keep the old sidecar shape');
});

test('keys can come from $WALKTHROUGH_VIDEO_HOME/.env, environment variables win, and only TTS keys are read', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'walkthrough-video-env-'));
  assert.deepEqual(await ttsEnv(home, { A: '1' }), { A: '1' }, 'a missing file changes nothing');
  await writeFile(path.join(home, '.env'), '# comment\nELEVENLABS_API_KEY=“from-file”\nexport ELEVENLABS_VOICE_ID = \'voice\'\nGOOGLE_TTS_API_KEY=\nPATH=/evil\n');
  const env = await ttsEnv(home, { ELEVENLABS_VOICE_ID: 'from-env' });
  assert.equal(env.ELEVENLABS_API_KEY, 'from-file', 'smart quotes from TextEdit are stripped');
  assert.equal(env.ELEVENLABS_VOICE_ID, 'from-env');
  assert.equal(env.GOOGLE_TTS_API_KEY, undefined, 'empty values are ignored');
  assert.equal(env.PATH, undefined, 'unrelated variables are not imported');
});

test('readings change only what is spoken: longest first, once, storyboard wins', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'walkthrough-video-readings-'));
  assert.deepEqual(await loadReadings(home), [], 'no dictionary file is fine');
  await writeFile(path.join(home, 'readings.txt'), '# 表記=読み\nエージェント=えーじぇんと\nエージェントボード=えーじぇんとぼーど\nPR=ぴーあーる\n壊れた行\n');
  const readings = await loadReadings(home, { readings: { PR: 'プルリク' } });
  assert.deepEqual(readings.map(([from]) => from), ['エージェントボード', 'エージェント', 'PR']);
  assert.equal(applyReadings('エージェントが PR を作る。エージェントボードを見る。', readings), 'えーじぇんとが プルリク を作る。えーじぇんとぼーどを見る。');
  assert.equal(applyReadings('a.b(c)', [['.', 'てん'], ['(', 'かっこ']]), 'aてんbかっこc)', 'symbols are matched literally');
  assert.equal(applyReadings(null, readings), null);
});
