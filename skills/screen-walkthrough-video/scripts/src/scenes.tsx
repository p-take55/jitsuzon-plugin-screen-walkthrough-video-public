import React from 'react';
import { AbsoluteFill, Freeze, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { FPS, ZOOM_SECONDS, CURSOR_SECONDS, CLICK_SECONDS } from '../timing.mjs';
import type { Timeline, TimedScene, Result, Option, AdjustmentContext, Change } from './types';

const accent = '#2f7de1';
const circled = (n: number) => n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`;
const ease = (value: number) => value * value * (3 - 2 * value);
const progress = (frame: number, start: number, duration: number) => ease(Math.min(1, Math.max(0, (frame - start) / duration)));
const mark = (result?: Result) => result === 'ok' ? '✓' : result === 'ng' ? '!' : result === 'unsure' ? '?' : '';

const SceneLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ padding: '12px 20px', background: 'rgba(255,255,255,.95)', border: '1px solid #d9dde2', borderRadius: 6, fontSize: '0.76em', lineHeight: 1.5 }}>
    {children}
  </div>
);
export const CheckLabel: React.FC<{ n: number; text: string }> = ({ n, text }) => <SceneLabel>{circled(n)} {text}</SceneLabel>;
const Recommended = () => <span style={{ fontSize: '0.65em', marginLeft: 12, color: '#636b76' }}>推奨</span>;
export const OptionLabel: React.FC<{ option: Option; index: number }> = ({ option, index }) => (
  <SceneLabel>{String.fromCharCode(65 + index)} {option.label}{option.recommended ? <Recommended /> : null}</SceneLabel>
);

export const Caption: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ position: 'absolute', bottom: '5%', left: '5%', right: '5%', display: 'flex', justifyContent: 'center' }}>
    <div style={{ background: 'rgba(0,0,0,.73)', color: 'white', padding: '12px 24px', borderRadius: 5, fontSize: text.length > 38 ? '0.7em' : '0.9em', whiteSpace: 'nowrap' }}>{text}</div>
  </div>
);

export const SummaryScene: React.FC<{ timeline: Timeline; scene: TimedScene }> = ({ timeline, scene }) => {
  const end = scene.type === 'end';
  const hasOptions = Boolean(timeline.options?.length);
  const compact = hasOptions && Boolean(timeline.checks?.length);
  const rowStyle: React.CSSProperties = { display: 'flex', gap: 16, alignItems: 'baseline', fontSize: compact ? '0.78em' : '0.91em', lineHeight: 1.6, marginTop: compact ? 10 : 18 };
  return <AbsoluteFill style={{ padding: '7% 8%', justifyContent: 'center' }}>
    <div style={{ fontSize: end ? '1em' : '1.35em', fontWeight: 650, lineHeight: 1.45 }}>{end ? (scene.text ?? (hasOptions ? '選択肢' : '確認結果')) : timeline.title}</div>
    {!end && timeline.subtitle ? <div style={{ marginTop: 14, color: '#636b76', fontSize: '0.8em' }}>{timeline.subtitle}</div> : null}
    {end && timeline.checks?.length ? <div style={{ marginTop: compact ? 20 : 36 }}>
      <div style={{ fontSize: '0.6em', color: '#636b76', marginBottom: 18 }}>見るところ</div>
      {timeline.checks.map((text, index) => <div key={index} style={rowStyle}>
        <span>{circled(index + 1)}</span><span style={{ flex: 1 }}>{text}</span>
        {end ? <span style={{ color: '#636b76', minWidth: 28, textAlign: 'center' }}>{mark(scene.results?.[index])}</span> : null}
      </div>)}
    </div> : end && !hasOptions ? <div style={{ marginTop: 24, color: '#636b76' }}>{mark(scene.result)} {scene.result === 'ng' ? '要修正' : scene.result === 'unsure' ? '要確認' : scene.result === 'ok' ? '確認しました' : timeline.title}</div> : null}
    {end && hasOptions ? <div style={{ marginTop: compact ? 20 : 36 }}>
      {!end || timeline.checks?.length ? <div style={{ fontSize: '0.6em', color: '#636b76', marginBottom: compact ? 10 : 18 }}>選択肢</div> : null}
      {timeline.options?.map((option, index) => <div key={option.id} style={rowStyle}>
        <span>{String.fromCharCode(65 + index)}</span><span style={{ flex: 1 }}>{option.label}{!end && option.recommended ? <Recommended /> : null}</span>
        {end ? <span style={{ color: '#636b76', minWidth: 28, textAlign: 'center' }}>{option.recommended ? '✓' : ''}</span> : null}
      </div>)}
    </div> : null}
  </AbsoluteFill>;
};

export const ContextScene: React.FC<{ context: AdjustmentContext }> = ({ context }) => {
  const frame = useCurrentFrame();
  const responseOpacity = interpolate(frame, [FPS * .6, FPS * .9], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const labelStyle: React.CSSProperties = { fontSize: '0.6em', color: '#636b76', marginBottom: 12 };
  const textStyle: React.CSSProperties = { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.65 };
  return <AbsoluteFill style={{ padding: '7% 8%', justifyContent: 'center' }}>
    <div style={{ borderLeft: '2px solid #d9dde2', paddingLeft: 28 }}>
      <div style={labelStyle}>フィードバック</div>
      <blockquote style={textStyle}>{context.request}</blockquote>
      <div style={{ opacity: responseOpacity, marginTop: 30 }}>
        <div style={labelStyle}>対応</div>
        <p style={textStyle}>{context.response}</p>
      </div>
    </div>
  </AbsoluteFill>;
};

export const ChangesScene: React.FC<{ items: Change[]; itemStarts: number[] }> = ({ items, itemStarts }) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ padding: '7% 8%', justifyContent: 'center' }}>
    <div style={{ fontSize: '0.6em', color: '#636b76', marginBottom: 26 }}>前回からの変更</div>
    {items.map((item, index) => {
      const shown = progress(frame, FPS * itemStarts[index], FPS * 0.4);
      return <div key={index} style={{ opacity: shown, transform: `translateY(${(1 - shown) * 8}px)`, marginTop: index ? 30 : 0 }}>
        <div style={{ fontSize: '0.95em', fontWeight: 600, lineHeight: 1.55 }}>{item.what}</div>
        {item.why ? <div style={{ marginTop: 6, fontSize: '0.66em', color: '#636b76', lineHeight: 1.6 }}>{item.why}</div> : null}
      </div>;
    })}
  </AbsoluteFill>;
};

export const MediaScene: React.FC<{ scene: TimedScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const [sourceWidth, sourceHeight] = scene.mediaSize ?? [width, height];
  const fit = Math.min(width / sourceWidth, height / sourceHeight);
  const left = (width - sourceWidth * fit) / 2;
  const top = (height - sourceHeight * fit) / 2;
  const zoomIn = scene.keepZoomIn ? 1 : progress(frame, 0, FPS * ZOOM_SECONDS);
  const zoomOut = scene.keepZoomOut ? 1 : 1 - progress(frame, scene.durationInFrames - FPS * ZOOM_SECONDS, FPS * ZOOM_SECONDS);
  const zoom = 1 + ((scene.zoom?.scale ?? 1) - 1) * Math.min(zoomIn, zoomOut);
  const center = scene.zoom?.center ?? [sourceWidth / 2, sourceHeight / 2];
  const moveX = (width / 2 - (left + center[0] * fit)) * Math.min(zoomIn, zoomOut);
  const moveY = (height / 2 - (top + center[1] * fit)) * Math.min(zoomIn, zoomOut);
  const typing = scene.overlays?.type ?? scene.typing;
  const arrival = scene.cursor ? FPS * CURSOR_SECONDS : 0;
  const clickProgress = (frame - arrival) / (FPS * CLICK_SECONDS);
  const cursor = scene.cursor;
  const cursorFrom = cursor?.from ?? cursor?.to;
  const cursorProgress = progress(frame, 0, FPS * CURSOR_SECONDS);
  const cursorX = cursor && cursorFrom ? cursorFrom[0] + (cursor.to[0] - cursorFrom[0]) * cursorProgress : scene.click?.[0];
  const cursorY = cursor && cursorFrom ? cursorFrom[1] + (cursor.to[1] - cursorFrom[1]) * cursorProgress : scene.click?.[1];
  const h = scene.highlight;
  const diagramClass = `diagram-${scene.from}`;
  return <AbsoluteFill style={{ overflow: 'hidden' }}>
    <div style={{ position: 'absolute', width: sourceWidth * fit, height: sourceHeight * fit, left, top,
      transformOrigin: `${center[0] * fit}px ${center[1] * fit}px`, transform: `translate(${moveX}px, ${moveY}px) scale(${zoom})` }}>
    <div style={{ width: sourceWidth, height: sourceHeight, position: 'relative', transformOrigin: '0 0', transform: `scale(${fit})` }}>
      {scene.type === 'shot' && scene.image ? <Img src={staticFile(scene.image)} style={{ width: '100%', height: '100%' }} /> : null}
      {scene.type === 'clip' && scene.src ? <Freeze frame={Math.min(frame, scene.contentFrames - 1)}>
        <OffthreadVideo src={staticFile(scene.src)} muted playbackRate={scene.speed ?? 1} startFrom={Math.round((scene.trim?.[0] ?? 0) * FPS)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </Freeze> : null}
      {scene.type === 'diagram' && scene.svgText ? <>
        <style>{`.${diagramClass} > svg { display:block; width:100%; height:100%; }\n` + (scene.reveal ?? []).map((selector, index, all) => `.${diagramClass} ${selector} { opacity:${interpolate(frame, [index * Math.max(1, scene.durationInFrames - 15) / all.length, index * Math.max(1, scene.durationInFrames - 15) / all.length + 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}; }`).join('\n')}</style>
        <div className={diagramClass} style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: scene.svgText }} />
      </> : null}
      {h ? <>
        <div style={{ position: 'absolute', left: h[0], top: h[1], width: h[2] - h[0], height: h[3] - h[1], boxShadow: '0 0 0 10000px rgba(0,0,0,.22)', border: `2px solid ${accent}`, pointerEvents: 'none' }} />
      </> : null}
      {typing ? <div style={{ position: 'absolute', left: typing.at[0], top: typing.at[1], color: '#20252c', fontSize: 24, whiteSpace: 'pre' }}>{Array.from(typing.text).slice(0, Math.floor(frame / 3)).join('')}</div> : null}
      {scene.click && clickProgress >= 0 && clickProgress <= 1 ? <div style={{ position: 'absolute', left: scene.click[0], top: scene.click[1], width: 14 + clickProgress * 55, height: 14 + clickProgress * 55, transform: 'translate(-50%,-50%)', borderRadius: '50%', border: `3px solid ${accent}`, opacity: 1 - clickProgress }} /> : null}
      {cursorX !== undefined && cursorY !== undefined ? <svg width="28" height="38" viewBox="0 0 28 38" style={{ position: 'absolute', left: cursorX, top: cursorY, overflow: 'visible' }}><path d="M2 2 L2 28 L9 22 L15 35 L21 32 L15 20 L25 20 Z" fill="#20252c" stroke="white" strokeWidth="2" strokeLinejoin="round" /></svg> : null}
    </div>
    </div>
  </AbsoluteFill>;
};
