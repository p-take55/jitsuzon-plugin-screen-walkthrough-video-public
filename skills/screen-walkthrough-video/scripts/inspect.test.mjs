import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSidecar, validateMetadata, inspectionFrames } from './inspect.mjs';
const sidecar = () => ({ duration: 10, checks: [{ n: 1, text: '保存される', at: 2 }, { n: 2, text: '再読込して残る', at: 6 }] });
const probe = () => ({ streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1280, height: 720, avg_frame_rate: '30/1', r_frame_rate: '30/1', duration: '10' }], format: { duration: '10' } });
test('extracts opening, check frames after their start, ending without inventing results', () => {
  const frames = inspectionFrames(sidecar());
  assert.deepEqual(frames.map(({ at }) => at), [0, 3, 7, 9.5]);
  assert.deepEqual(frames.filter(({ kind }) => kind === 'check').map(({ n }) => n), [1, 2]);
  assert.ok(frames.every((frame) => !Object.hasOwn(frame, 'result')));
  const input = sidecar(); input.checks[0].result = 'ng';
  assert.equal(inspectionFrames(input)[1].result, 'ng');
});
test('handles unsorted or simultaneous checks and clamps to actual duration', () => {
  const input = { duration: 1, checks: [{ n: 3, text: 'last', at: 0.99 }, { n: 1, text: 'first', at: 0 }, { n: 2, text: 'same', at: 0 }] };
  const frames = inspectionFrames(input);
  assert.equal(frames[1].at, 0.995);
  assert.equal(frames[2].at, 0.495);
  assert.equal(frames[3].at, 0.495);
  assert.ok(frames.every(({ at }) => at >= 0 && at < 1));
  assert.equal(inspectionFrames({ duration: 1, checks: [{ n: 1, text: 'last', at: 0.9 }] }, 0.98)[1].at, 0.94);
  assert.throws(() => inspectionFrames(input, 0.98), /outside actual/);
  assert.equal(inspectionFrames({ duration: 0.01, checks: [] })[1].at, 0.005);
});
test('rejects malformed sidecars before invoking tools', () => {
  for (const bad of [null, {}, { duration: '1', checks: [] }, { duration: Infinity, checks: [] }, { duration: 0, checks: [] }, { duration: 1 }, { duration: 1, checks: [null] }]) assert.throws(() => validateSidecar(bad));
  for (const at of [-1, 10, NaN, Infinity, '2']) {
    const input = sidecar(); input.checks[0].at = at;
    assert.throws(() => validateSidecar(input), /at must/);
  }
  const duplicate = sidecar(); duplicate.checks[1].n = 1;
  assert.throws(() => validateSidecar(duplicate), /unique/);
  const missingText = sidecar(); missingText.checks[0].text = '';
  assert.throws(() => validateSidecar(missingText), /text/);
  const invalidResult = sidecar(); invalidResult.checks[0].result = 'success';
  assert.throws(() => validateSidecar(invalidResult), /result/);
});
test('accepts H264 yuv420p 30fps even size and one frame duration tolerance', () => {
  assert.deepEqual(validateMetadata(probe(), 10), { codec: 'h264', pixelFormat: 'yuv420p', fps: 30, width: 1280, height: 720, duration: 10 });
  const input = probe(); input.format.duration = String(10 + 1 / 30); input.streams[0].duration = input.format.duration;
  assert.doesNotThrow(() => validateMetadata(input, 10));
});
test('rejects mismatching codec, format, rates, size and durations', () => {
  for (const [key, value] of [['codec_name', 'vp9'], ['pix_fmt', 'yuv444p'], ['avg_frame_rate', '30000/1001'], ['r_frame_rate', '0/0'], ['width', 0], ['height', 721], ['duration', '10.04']]) {
    const input = probe(); input.streams[0][key] = value;
    assert.throws(() => validateMetadata(input, 10), undefined, key);
  }
  for (const duration of ['N/A', '0', '10.04', '9.96']) {
    const input = probe(); input.format.duration = duration;
    assert.throws(() => validateMetadata(input, 10), /duration/);
  }
  assert.throws(() => validateMetadata({ streams: [], format: { duration: '10' } }, 10), /codec/);
});

test('a long ending does not move the last check sample into the summary', () => {
  const input = { duration: 40, checks: [{ n: 1, text: 'saved', at: 2 }] };
  assert.equal(inspectionFrames(input)[1].at, 3);
});
