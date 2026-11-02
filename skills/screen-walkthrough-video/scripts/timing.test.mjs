import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, makeChecks, FPS, CROSSFADE, ZOOM_SECONDS, CURSOR_SECONDS, CLICK_SECONDS, POST_CLICK_SECONDS, READ } from './timing.mjs';

const frames = (seconds) => Math.ceil(Number((seconds * FPS).toFixed(9)));
const at = (timeline, index) => timeline.scenes[index].from / FPS;

test('titles read only the title and sidecars use the first referenced scene', () => {
  const timeline = buildTimeline({
    title: 'Scope',
    options: [{ id: 'own', label: 'Own' }, { id: 'all', label: 'Shared', recommended: true }, { id: 'unused', label: 'Unused' }],
    scenes: [{ type: 'title' }, { type: 'shot', option: 'own', hold: 2 }, { type: 'diagram', option: 'all', hold: 3 }, { type: 'shot', option: 'own' }, { type: 'end' }],
  });
  assert.equal(timeline.scenes[0].durationInFrames, frames(1.2 + 5 / READ.caption));
  assert.deepEqual(makeChecks(timeline).options, [
    { id: 'own', label: 'Own', at: at(timeline, 1) },
    { id: 'all', label: 'Shared', at: at(timeline, 2) },
    { id: 'unused', label: 'Unused' },
  ]);
});

test('options coexist with checks and preserve check results and timestamps', () => {
  const timeline = buildTimeline({
    title: 'Both', checks: ['Visible'], options: [{ id: 'all', label: 'Shared' }],
    scenes: [{ type: 'title' }, { type: 'shot', hold: 2, check: 1, option: 'all' }, { type: 'end', results: ['ok'] }],
  });
  assert.deepEqual(makeChecks(timeline), {
    duration: timeline.durationInFrames / FPS,
    checks: [{ n: 1, text: 'Visible', at: at(timeline, 1), result: 'ok' }],
    options: [{ id: 'all', label: 'Shared', at: at(timeline, 1) }],
  });
});

test('legacy storyboards still emit an empty options array', () => {
  assert.deepEqual(makeChecks(buildTimeline({ title: 'Legacy', scenes: [{ type: 'title' }] })), {
    duration: frames(1.2 + 6 / READ.caption) / FPS, checks: [], options: [],
  });
});

test('title and end references are timed, while unused options have no scene time even with a later title', () => {
  const timeline = buildTimeline({
    title: 'Any scene',
    options: [{ id: 'title', label: 'Title' }, { id: 'end', label: 'End' }, { id: 'unused', label: 'Unused' }],
    scenes: [{ type: 'diagram', hold: 2 }, { type: 'title', option: 'title' }, { type: 'end', option: 'end' }],
  });
  assert.deepEqual(makeChecks(timeline).options, [
    { id: 'title', label: 'Title', at: at(timeline, 1) },
    { id: 'end', label: 'End', at: at(timeline, 2) },
    { id: 'unused', label: 'Unused' },
  ]);
});

test('top-level changes follow the title as one scene and shift checks and options on the shared timeline', () => {
  const storyboard = {
    title: '対応', changes: [{ what: '候補に所有者を表示した', why: '誰のデータベースか分からないという指摘' }],
    checks: ['所有者が見える'], options: [{ id: 'all', label: '共有も含める' }],
    scenes: [{ type: 'title' }, { type: 'shot', hold: 2, check: 1, option: 'all' }, { type: 'end', results: ['ok'] }],
  };
  const timeline = buildTimeline(storyboard);
  assert.deepEqual(timeline.scenes.map((scene) => scene.type), ['title', 'changes', 'shot', 'end']);
  assert.deepEqual(timeline.scenes[1].items, storyboard.changes);
  assert.deepEqual(makeChecks(timeline), {
    duration: timeline.durationInFrames / FPS,
    checks: [{ n: 1, text: '所有者が見える', at: at(timeline, 2), result: 'ok' }],
    options: [{ id: 'all', label: '共有も含める', at: at(timeline, 2) }],
  });
  assert.deepEqual(buildTimeline(storyboard), timeline, 'building twice must not insert duplicate scenes');
  assert.equal(storyboard.scenes.length, 3, 'the input remains unchanged');
});

test('legacy context becomes changes (what = response, why = request), merged in order; explicit scenes stay separate', () => {
  const timeline = buildTimeline({
    title: '対応', changes: [{ what: '変更0' }], context: [{ request: '一つ目', response: '対応1' }, { request: '二つ目', response: '対応2' }],
    scenes: [{ type: 'title' }, { type: 'context', request: '三つ目', response: '対応3', hold: 4 }, { type: 'end' }],
  });
  assert.deepEqual(timeline.scenes.map((scene) => scene.type), ['title', 'changes', 'changes', 'end']);
  assert.deepEqual(timeline.scenes[1].items, [{ what: '変更0' }, { what: '対応1', why: '一つ目' }, { what: '対応2', why: '二つ目' }]);
  assert.deepEqual(timeline.scenes[2].items, [{ what: '対応3', why: '三つ目' }]);
  assert.equal(timeline.scenes[2].durationInFrames, 120, 'explicit hold wins');
  assert.equal(timeline.scenes[1].durationInFrames, frames(0.6 + 1.5 + 9 / READ.what + 6 / READ.why), 'reading time grows with items');
});

test('changes without a title precede content and an empty list adds nothing', () => {
  const scenes = [{ type: 'shot', hold: 2 }];
  assert.deepEqual(buildTimeline({ title: '対応', changes: [{ what: '直した' }], scenes }).scenes.map((scene) => scene.type), ['changes', 'shot']);
  assert.equal(buildTimeline({ title: '対応', context: [], scenes }).durationInFrames, 60);
  assert.throws(() => buildTimeline({ title: '対応', changes: [{ why: '理由だけ' }], scenes }), /changes/);
});

test('context requires string request and response for both shorthand and explicit scenes', () => {
  for (const context of [null, 'comment', {}, { request: 1, response: '対応' }, { request: 'コメント' }]) {
    assert.throws(() => buildTimeline({ title: '対応', context, scenes: [{ type: 'title' }] }), /context/);
    assert.throws(() => buildTimeline({ title: '対応', scenes: [{ ...context, type: 'context' }] }), /context/);
  }
});

const one = (scene, fields = {}) => buildTimeline({ title: '', ...fields, scenes: [scene] }).scenes[0];

test('shot, clip and diagram reading time counts Unicode code points', () => {
  for (const type of ['shot', 'clip', 'diagram']) {
    const scene = one({ type, caption: '😀あいうえお', ...(type === 'clip' ? { mediaDuration: 0.5 } : {}) });
    assert.equal(scene.durationInFrames, frames(1 + 6 / READ.caption), type);
  }
});

test('first explicit check and option appearances add label reading time only once', () => {
  const timeline = buildTimeline({
    title: '', checks: ['12345678'], options: [{ id: 'a', label: '😀2345678' }],
    scenes: [
      { type: 'title' },
      { type: 'shot', check: 1, option: 'a', caption: '123456' },
      { type: 'clip', check: 1, option: 'a', mediaDuration: 1, caption: '123456' },
      { type: 'diagram', check: 1, option: 'a', caption: '123456' },
    ],
  });
  assert.deepEqual(timeline.scenes.slice(1).map((scene) => scene.durationInFrames), [
    frames(1 + 6 / READ.caption + 16 / READ.label),
    Math.max(frames(1 + 6 / READ.caption), frames(1.4) + CROSSFADE),
    frames(1 + 6 / READ.caption),
  ]);
  for (const type of ['shot', 'clip', 'diagram']) {
    for (const reference of [{ check: 1 }, { option: 'a' }]) {
      assert.equal(one({ type, ...reference, mediaDuration: 1 }, { checks: ['x'], options: [{ id: 'a', label: 'x' }] }).durationInFrames, frames(2.6));
    }
  }
});

test('title uses only the title and subtitle; checks and options are not listed up front', () => {
  assert.equal(one({ type: 'title' }, { title: '😀234', subtitle: '5678', checks: ['abcdefgh'.repeat(4)], options: [{ id: 'a', label: 'ABCDEFGH'.repeat(2) }] }).durationInFrames, frames(1.2 + 8 / READ.caption));
  assert.equal(one({ type: 'title' }).durationInFrames, frames(1.2));
});

test('clip duration retains trim/speed as a lower bound and freezes at the media end', () => {
  assert.equal(one({ type: 'clip', mediaDuration: 12, trim: [2, 10], speed: 2 }).durationInFrames, frames(4));
  const short = one({ type: 'clip', mediaDuration: 0.5, caption: '123456789012' });
  assert.equal(short.durationInFrames, frames(1 + 12 / READ.caption));
  assert.equal(short.contentFrames, frames(0.5));
  assert.equal(one({ type: 'clip', mediaDuration: 2, hold: 5 }).durationInFrames, frames(5));
  for (const mediaDuration of [undefined, NaN, 0, -1]) assert.throws(() => one({ type: 'clip', mediaDuration }), /invalid duration/);
});

test('changes expose cumulative item start seconds from the same reading schedule', () => {
  const items = [{ what: '😀2345678', why: 'abcdefgh' }, { what: '1234' }, { what: '12345678', why: '12345678' }];
  const starts = [];
  let total = 0.6;
  for (const [what, why] of [[8, 8], [4, 0], [8, 8]]) { starts.push(total); total += 0.5 + what / READ.what + why / READ.why; }
  const scene = one({ type: 'changes', items });
  assert.deepEqual(scene.itemStarts, starts);
  assert.equal(scene.durationInFrames, frames(total));
  const slower = one({ type: 'changes', items }, { pace: 2 });
  assert.deepEqual(slower.itemStarts, starts.map((start) => start * 2));
  assert.equal(slower.durationInFrames, frames(total * 2));
});

test('end reading time includes the number of checks and options', () => {
  assert.equal(one({ type: 'end' }).durationInFrames, frames(1.5));
  assert.equal(one({ type: 'end' }, { checks: ['a', 'b', 'c'] }).durationInFrames, frames(1.5 + 0.5 * 3));
  assert.equal(one({ type: 'end' }, { checks: ['a', 'b'], options: [{ id: 'a', label: 'c' }] }).durationInFrames, frames(1.5 + 0.5 * 3));
});

test('hold is a minimum for every scene type, then pace applies', () => {
  for (const type of ['shot', 'clip', 'diagram', 'title', 'changes', 'end']) {
    const scene = { type, mediaDuration: 2, items: [{ what: '12345678' }], hold: 0.1 };
    const computed = one({ ...scene, hold: undefined });
    assert.equal(one(scene).durationInFrames, computed.durationInFrames, type);
    assert.equal(one({ ...scene, hold: 10 }).durationInFrames, frames(10), type);
    assert.equal(one({ ...scene, hold: 10 }, { pace: 2 }).durationInFrames, frames(20), type);
  }
});

test('pace defaults to 1, scales every scene type and rejects values outside 0.5..2', () => {
  for (const type of ['shot', 'clip', 'diagram', 'title', 'changes', 'end']) {
    const scene = { type, mediaDuration: 4, ...(['shot', 'clip', 'diagram'].includes(type) ? { caption: '123456789012345678' } : {}), items: [{ what: '12345678901234' }] };
    const baseline = one(scene).durationInFrames;
    assert.equal(one(scene, { pace: 1 }).durationInFrames, baseline, type);
    assert.equal(one(scene, { pace: 0.5 }).durationInFrames, Math.max(CROSSFADE * 2, Math.ceil(baseline / 2)), type);
    assert.equal(one(scene, { pace: 2 }).durationInFrames, baseline * 2, type);
  }
  for (const pace of [0, 0.49, 2.01, -1, Infinity, NaN, '1', null, false]) {
    assert.throws(() => one({ type: 'title' }, { pace }), /pace/);
  }
});

test('motion fits zoom, cursor, click ripple and post-click inspection before the outgoing fade', () => {
  assert.equal(CROSSFADE, Math.round(FPS * 0.4));
  assert.equal(ZOOM_SECONDS, 0.9);
  assert.equal(CURSOR_SECONDS, 0.8);
  assert.equal(POST_CLICK_SECONDS, 0.8);
  const zoom = { center: [0, 0], scale: 2 };
  for (const pace of [0.5, 1, 2]) {
    const timeline = buildTimeline({ title: '', pace, scenes: [
      { type: 'shot', zoom, cursor: { to: [1, 1] }, click: [1, 1] }, { type: 'end' },
    ] });
    assert.ok(timeline.scenes[0].durationInFrames - CROSSFADE >= frames(CURSOR_SECONDS + CLICK_SECONDS + POST_CLICK_SECONDS + ZOOM_SECONDS));
  }
  const continued = buildTimeline({ title: '', scenes: [{ type: 'shot', zoom }, { type: 'shot', zoom }] });
  assert.equal(continued.scenes[0].keepZoomOut, true);
  assert.equal(continued.scenes[1].keepZoomIn, true);
  assert.equal(continued.scenes[0].durationInFrames, frames(ZOOM_SECONDS) + CROSSFADE);
});

test('caption minimum reading reservation survives overlap and sidecar times use the paced timeline', () => {
  const timeline = buildTimeline({ title: '', pace: 2, checks: ['x'], options: [{ id: 'a', label: 'y' }], scenes: [
    { type: 'shot', caption: 'x' }, { type: 'diagram', check: 1, option: 'a' }, { type: 'end' },
  ] });
  assert.equal(timeline.scenes[0].durationInFrames, frames(1.4 * 2) + CROSSFADE);
  assert.equal(timeline.scenes[1].from, frames(1.4 * 2));
  const sidecar = makeChecks(timeline);
  assert.equal(sidecar.checks[0].at, 2.8);
  assert.equal(sidecar.options[0].at, 2.8);
  assert.equal(sidecar.duration, (timeline.scenes.reduce((n, scene) => n + scene.durationInFrames, 0) - CROSSFADE * 2) / FPS);
});
