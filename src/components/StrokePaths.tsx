import { memo } from 'react';
import type { Stroke } from '../lib/types';
import { cssColor, solidColor, strokePath } from '../lib/ink';

const StrokePath = memo(function StrokePath({ s, paper }: { s: Stroke; paper?: boolean }) {
  const fill = paper ? solidColor(s.color) : cssColor(s.color);
  if (s.tool === 'highlighter') return <path d={strokePath(s)} fill={fill} className="hl-stroke" />;
  return <path d={strokePath(s)} fill={fill} />;
});

/** Renders committed strokes. `paper` forces dark ink regardless of theme (PDF pages). */
export const StrokePaths = memo(function StrokePaths({ strokes, paper, selected }: { strokes: Stroke[]; paper?: boolean; selected?: Set<string> }) {
  return (
    <>
      {strokes.map((s) => (
        <g key={s.id} className={selected?.has(s.id) ? 'is-selected' : undefined}>
          <StrokePath s={s} paper={paper} />
        </g>
      ))}
    </>
  );
});
