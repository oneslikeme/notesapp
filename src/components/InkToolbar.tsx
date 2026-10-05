import { Eraser, Highlighter, PenLine } from 'lucide-react';
import { useStore, setState } from '../lib/store';
import { HL_COLORS, HL_SIZES, PEN_COLORS, PEN_SIZES } from '../lib/ink';
import type { InkTool } from '../lib/types';

export function setInkTool(tool: InkTool) {
  setState((s) => ({ ink: { ...s.ink, tool } }));
}

/** Pen / highlighter / eraser plus colour + size for the active tool. */
export function InkControls({ showTools = true, compact = false, onPick }: { showTools?: boolean; compact?: boolean; onPick?: () => void }) {
  const ink = useStore((s) => s.ink);
  const isHl = ink.tool === 'highlighter';
  const colors = isHl ? HL_COLORS : PEN_COLORS;
  const sizes = isHl ? HL_SIZES : PEN_SIZES;
  const cur = isHl ? ink.hl : ink.pen;
  const set = (patch: Partial<typeof cur>) =>
    setState((s) => ({ ink: { ...s.ink, [isHl ? 'hl' : 'pen']: { ...(isHl ? s.ink.hl : s.ink.pen), ...patch } } }));

  return (
    <div className={`ink-controls ${compact ? 'is-compact' : ''}`}>
      {showTools && (
        <div className="tool-group">
          <ToolBtn tool="pen" icon={PenLine} label="Pen" kbd="P" onPick={onPick} />
          <ToolBtn tool="highlighter" icon={Highlighter} label="Highlighter" kbd="M" onPick={onPick} />
          <ToolBtn tool="eraser" icon={Eraser} label="Eraser" kbd="E" onPick={onPick} />
        </div>
      )}
      {ink.tool !== 'eraser' && (
        <>
          <div className="tool-group">
            {Object.entries(colors).map(([k, v]) => (
              <button
                key={k}
                className={`swatch ${cur.color === k ? 'is-on' : ''}`}
                style={{ ['--sw' as any]: v }}
                title={k}
                aria-label={`${k} colour`}
                onClick={() => (set({ color: k }), onPick?.())}
              />
            ))}
          </div>
          <div className="tool-group">
            {sizes.map((s) => (
              <button key={s} className={`size-dot ${cur.size === s ? 'is-on' : ''}`} title={`Size ${s}`} aria-label={`Size ${s}`} onClick={() => (set({ size: s }), onPick?.())}>
                <span style={{ width: Math.min(18, 3 + s * (isHl ? 0.5 : 1.3)), height: Math.min(18, 3 + s * (isHl ? 0.5 : 1.3)) }} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ToolBtn({ tool, icon: Icon, label, kbd, onPick }: { tool: InkTool; icon: any; label: string; kbd: string; onPick?: () => void }) {
  const active = useStore((s) => s.ink.tool === tool);
  return (
    <button className={`icon-btn ${active ? 'is-active' : ''}`} title={`${label} (${kbd})`} aria-label={label} onClick={() => (setInkTool(tool), onPick?.())}>
      <Icon size={18} strokeWidth={1.75} />
    </button>
  );
}
