export type Point = [number, number];
export type Result = 'ok' | 'ng' | 'unsure';
export type Typing = { at: Point; text: string };
export type Option = { id: string; label: string; recommended?: boolean };
export type AdjustmentContext = { request: string; response: string };
export type Change = { what: string; why?: string };
export type Scene = {
  image?: string;
  src?: string;
  svg?: string;
  svgText?: string;
  caption?: string;
  check?: number;
  option?: string;
  hold?: number;
  trim?: Point;
  speed?: number;
  mediaDuration?: number;
  mediaSize?: Point;
  cursor?: { from?: Point; to: Point };
  click?: Point;
  zoom?: { center: Point; scale: number };
  highlight?: [number, number, number, number];
  // `type` is already the scene discriminator; overlays.type holds the typing overlay.
  overlays?: { type?: Typing };
  typing?: Typing;
  reveal?: string[];
  result?: Result;
  results?: Result[];
  text?: string;
} & ({ type: 'context' } & AdjustmentContext | { type: 'changes'; items: Change[] } | { type: 'title' | 'shot' | 'clip' | 'diagram' | 'end' });
export type TimedScene = Scene & {
  from: number;
  durationInFrames: number;
  contentFrames: number;
  itemStarts?: number[];
  keepZoomIn: boolean;
  keepZoomOut: boolean;
  /** 読み上げ音声（public 内のファイル名）と、場面の頭から鳴らし始めるまでのフレーム数。 */
  audio?: string;
  audioDelayFrames?: number;
};
export type Storyboard = {
  pace?: number;
  size: Point;
  title: string;
  subtitle?: string;
  context?: AdjustmentContext | AdjustmentContext[];
  changes?: Change[];
  checks?: string[];
  options?: Option[];
  scenes: Scene[];
};
export type Timeline = Omit<Storyboard, 'scenes'> & {
  durationInFrames: number;
  scenes: TimedScene[];
};
