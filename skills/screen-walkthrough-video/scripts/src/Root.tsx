import React from 'react';
import { Composition } from 'remotion';
import { buildTimeline, FPS } from '../timing.mjs';
import { StoryboardVideo } from './StoryboardVideo';
import type { Timeline } from './types';

const preview: Timeline = buildTimeline({
  size: [1280, 720],
  title: '確認動画',
  subtitle: 'render.mjs に台本 JSON を渡して書き出します',
  checks: ['見るところを台本に書く'],
  scenes: [{ type: 'title' }, { type: 'end', results: ['unsure'] }],
});

export const Root: React.FC = () => (
  <Composition
    id="BoardVideo"
    component={StoryboardVideo}
    fps={FPS}
    width={1280}
    height={720}
    durationInFrames={preview.durationInFrames}
    defaultProps={{ timeline: preview }}
    calculateMetadata={({ props }) => ({
      width: props.timeline.size[0],
      height: props.timeline.size[1],
      fps: FPS,
      durationInFrames: props.timeline.durationInFrames,
    })}
  />
);
