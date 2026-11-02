// Rendering and sidecar timestamps share this frame-based timeline.
export const FPS = 30;
export const CROSSFADE = Math.round(FPS * 0.4);
export const ZOOM_SECONDS = 0.9;
export const CURSOR_SECONDS = 0.8;
export const CLICK_SECONDS = 0.4;
export const POST_CLICK_SECONDS = 0.8;
const chars = (text = '') => [...text].length;
// 読む速さ（1 秒あたりの文字数）。字幕は一度で読み切る速さ、見るところの一覧や変更の理由は流し読みの速さで見積もる。
// 一覧と理由はボードにも同じ文があるので、動画では目で追えれば足りる。
export const READ = { caption: 10, label: 15, what: 14, why: 28 };
// Avoid an extra frame for decimal noise such as (1.5 + 0.8 * 3) * 30.
const toFrames = (seconds) => Math.ceil(seconds * FPS - 1e-9);

// 読み上げは場面の切り替えが落ち着いてから始め、読み終えてから少し間を置いて次へ進む。
export const NARRATION_LEAD_SECONDS = 0.35;
export const NARRATION_TAIL_SECONDS = 0.45;

/**
 * @param {any} storyboard
 * @param {{ narration?: ({ file: string, seconds: number } | null | undefined)[] }} [options]
 *   narration は changes 自動挿入後の場面の並びと同じ順。読み上げのある場面は、読み終わるまで長さを延ばす。
 */
export function buildTimeline(storyboard, { narration = [] } = {}) {
  const pace = storyboard.pace === undefined ? 1 : storyboard.pace;
  if (typeof pace !== 'number' || !Number.isFinite(pace) || pace < 0.5 || pace > 2) throw new Error('pace must be a number between 0.5 and 2.0');
  const seenChecks = new Set();
  const seenOptions = new Set();
  const contexts = storyboard.context === undefined ? [] : Array.isArray(storyboard.context) ? storyboard.context : [storyboard.context];
  const validateContext = (context) => {
    if (!context || typeof context.request !== 'string' || typeof context.response !== 'string') throw new Error('context は request・response を文字列で指定してください');
  };
  contexts.forEach(validateContext);
  const validateChanges = (items) => {
    if (!Array.isArray(items) || !items.length || items.some((item) => !item || typeof item.what !== 'string' || !item.what.trim() || (item.why !== undefined && typeof item.why !== 'string'))) {
      throw new Error('changes は what（必須）・why（任意）を文字列で持つ配列を指定してください');
    }
  };
  // context（旧形式）は「何を変えたか = response、なぜ = request」として changes に寄せる。
  const changes = [...(storyboard.changes ?? []), ...contexts.map(({ request, response }) => ({ what: response, why: request }))];
  if (changes.length) validateChanges(changes);
  const inputs = storyboard.scenes.map((scene) => scene.type === 'context' ? (validateContext(scene), { ...scene, type: 'changes', items: [{ what: scene.response, why: scene.request }] }) : scene);
  const titleIndex = inputs.findIndex((scene) => scene.type === 'title');
  if (changes.length) inputs.splice(titleIndex + 1, 0, { type: 'changes', items: changes });
  let nextFrame = 0;
  let previousCursor;
  const scenes = inputs.map((input, index) => {
    const scene = { ...input };
    if (scene.type === 'changes') validateChanges(scene.items);
    const previous = inputs[index - 1];
    const next = inputs[index + 1];
    const sameZoom = (other) => Boolean(scene.zoom && other?.zoom && JSON.stringify(scene.zoom) === JSON.stringify(other.zoom));
    const keepZoomIn = sameZoom(previous);
    const keepZoomOut = sameZoom(next);
    const checkLabel = !seenChecks.has(scene.check) ? storyboard.checks?.[scene.check - 1] : undefined;
    const optionLabel = !seenOptions.has(scene.option) ? storyboard.options?.find((option) => option.id === scene.option)?.label : undefined;
    if (scene.check !== undefined) seenChecks.add(scene.check);
    if (scene.option !== undefined) seenOptions.add(scene.option);
    const introducesLabel = checkLabel !== undefined || optionLabel !== undefined;
    const labelSeconds = (chars(checkLabel) + chars(optionLabel)) / READ.label;
    const mediaSeconds = scene.type === 'clip' ? ((scene.trim?.[1] ?? scene.mediaDuration) - (scene.trim?.[0] ?? 0)) / (scene.speed ?? 1) : undefined;
    if (scene.type === 'clip' && (!Number.isFinite(mediaSeconds) || mediaSeconds <= 0)) throw new Error(`Scene ${index + 1}: invalid duration`);
    if (scene.hold !== undefined && (!Number.isFinite(scene.hold) || scene.hold <= 0)) throw new Error(`Scene ${index + 1}: invalid duration`);
    let seconds;
    let itemStarts;
    if (scene.type === 'title') {
      // 冒頭は具体から入る。見るところや選択肢の一覧は先に並べず、各場面のラベルと最後のまとめで出す。
      seconds = 1.2 + (chars(storyboard.title) + chars(storyboard.subtitle)) / READ.caption;
    } else if (scene.type === 'end') {
      seconds = 1.5 + 0.5 * ((storyboard.checks?.length ?? 0) + (storyboard.options?.length ?? 0));
    } else if (scene.type === 'changes') {
      seconds = 0.6;
      itemStarts = scene.items.map((item) => {
        const start = seconds * pace;
        seconds += 0.5 + chars(item.what) / READ.what + chars(item.why) / READ.why;
        return start;
      });
    } else {
      seconds = 1 + chars(scene.caption) / READ.caption + labelSeconds;
      if (introducesLabel) seconds = Math.max(2.6, seconds);
      seconds = Math.max(seconds, mediaSeconds ?? 0);
    }
    // Zoom-in and cursor movement run concurrently. Finish the click ripple,
    // leave time to inspect its result, then zoom out before the outgoing fade.
    const motionSeconds = Math.max(scene.zoom && !keepZoomIn ? ZOOM_SECONDS : 0,
      (scene.cursor ? CURSOR_SECONDS : 0) + (scene.click ? CLICK_SECONDS + POST_CLICK_SECONDS : 0))
      + (scene.zoom && !keepZoomOut ? ZOOM_SECONDS : 0);
    seconds = Math.max(scene.hold ?? 0, seconds, motionSeconds) * pace;
    // 読み上げの速さは pace で変わらないので、pace を掛けた後で読み終わる長さを確保する。
    const voice = narration[index];
    if (voice && Number.isFinite(voice.seconds) && voice.seconds > 0) {
      seconds = Math.max(seconds, NARRATION_LEAD_SECONDS + voice.seconds + NARRATION_TAIL_SECONDS);
      scene.audio = voice.file;
      scene.audioDelayFrames = toFrames(NARRATION_LEAD_SECONDS);
    }
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Scene ${index + 1}: invalid duration`);
    // Preserve physical motion/inspection minima even at a faster reading pace.
    const outgoingFade = index < inputs.length - 1 ? CROSSFADE : 0;
    const contentFrames = Math.max(1, toFrames(mediaSeconds ?? seconds));
    const captionFrames = scene.caption ? toFrames(1.4 * pace) + outgoingFade : 0;
    const durationInFrames = Math.max(CROSSFADE * 2, toFrames(seconds), captionFrames,
      motionSeconds ? toFrames(motionSeconds) + outgoingFade : 0);
    const from = nextFrame;
    nextFrame += durationInFrames - (index < inputs.length - 1 ? CROSSFADE : 0);
    const cursor = scene.cursor ? { ...scene.cursor, from: scene.cursor.from ?? previousCursor ?? scene.cursor.to } : undefined;
    previousCursor = scene.cursor?.to ?? scene.click ?? previousCursor;
    return { ...scene, cursor, from, durationInFrames, contentFrames, itemStarts,
      keepZoomIn, keepZoomOut };
  });
  return { ...storyboard, scenes, durationInFrames: nextFrame };
}

/** @param {any} timeline */
export function makeChecks(timeline) {
  const results = [...timeline.scenes].reverse().find((scene) => scene.type === 'end')?.results ?? [];
  return {
    duration: timeline.durationInFrames / FPS,
    ...(timeline.scenes.some((scene) => scene.audio) ? { narrated: true } : {}),
    checks: (timeline.checks ?? []).map((text, index) => {
      const n = index + 1;
      const first = timeline.scenes.find((scene) => scene.check === n);
      const title = timeline.scenes.find((scene) => scene.type === 'title');
      return { n, text, at: (first?.from ?? title?.from ?? 0) / FPS, ...(results[index] ? { result: results[index] } : {}) };
    }),
    options: (timeline.options ?? []).map(({ id, label }) => {
      const first = timeline.scenes.find((scene) => scene.option === id);
      return first ? { id, label, at: first.from / FPS } : { id, label };
    }),
  };
}
