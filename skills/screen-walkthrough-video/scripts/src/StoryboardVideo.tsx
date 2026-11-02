import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { CROSSFADE } from '../timing.mjs';
import { MediaScene, SummaryScene, ChangesScene, ContextScene, CheckLabel, OptionLabel, Caption } from './scenes';
import type { Timeline, TimedScene } from './types';

const fontFamily = '"Hiragino Sans", "Noto Sans JP", sans-serif';

const SceneLayer: React.FC<{ timeline: Timeline; scene: TimedScene; index: number }> = ({ timeline, scene, index }) => {
  const frame = useCurrentFrame();
  const first = index === 0;
  // The incoming opaque scene fades over the outgoing scene during their overlap.
  const opacity = first ? 1 : interpolate(frame, [0, CROSSFADE], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const summary = scene.type === 'title' || scene.type === 'end';
  return <AbsoluteFill style={{ opacity, background: 'white' }}>
    {summary ? <SummaryScene timeline={timeline} scene={scene} /> : scene.type === 'changes' ? <ChangesScene items={scene.items} itemStarts={scene.itemStarts!} /> : scene.type === 'context' ? <ContextScene context={scene} /> : <MediaScene scene={scene} />}
  </AbsoluteFill>;
};

export const StoryboardVideo: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  // Persistent overlays are drawn once: identical adjacent captions never fade/reappear.
  const active = [...timeline.scenes].reverse().find((scene) => scene.from <= frame) ?? timeline.scenes[0];
  const optionIndex = timeline.options?.findIndex((option) => option.id === active?.option) ?? -1;
  const option = timeline.options?.[optionIndex];
  return <AbsoluteFill style={{ background: 'white', color: '#20252c', fontFamily, fontSize: 30 * width / 1280 }}>
    {timeline.scenes.map((scene, index) => <Sequence key={index} from={scene.from} durationInFrames={scene.durationInFrames} layout="none">
      <SceneLayer timeline={timeline} scene={scene} index={index} />
      {scene.audio ? <Sequence from={scene.audioDelayFrames ?? 0} layout="none"><Audio src={staticFile(scene.audio)} /></Sequence> : null}
    </Sequence>)}
    <div style={{ position: 'absolute', right: '3%', top: '4%', maxWidth: '73%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      {active?.check && timeline.checks?.[active.check - 1] ? <CheckLabel n={active.check} text={timeline.checks[active.check - 1]} /> : null}
      {option ? <OptionLabel option={option} index={optionIndex} /> : null}
    </div>
    {active?.caption ? <Caption text={active.caption} /> : null}
  </AbsoluteFill>;
};
