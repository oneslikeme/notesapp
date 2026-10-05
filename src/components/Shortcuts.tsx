import { useStore, setState } from '../lib/store';
import { Modal } from './ui';
import { modKey } from '../lib/util';

const GROUPS: [string, [string, string][]][] = [
  ['Anywhere', [
    [`${modKey} K`, 'Jump to note / command palette'],
    [`${modKey} ⇧ P`, 'Commands'],
    [`${modKey} ⇧ F`, 'Search everything'],
    ['Alt Q', 'Quick capture'],
    ['Alt N', 'New page'],
    ['Alt ⇧ N', 'New scratch note'],
    ['Alt 1–9', 'Switch to tab'],
    ['Alt [  /  Alt ]', 'Previous / next tab'],
    ['Alt W', 'Close tab'],
    ['Alt ← / →', 'Back / forward'],
    [`${modKey} \\`, 'Toggle sidebar'],
    [`${modKey} .`, 'Info & backlinks panel'],
    [`${modKey} S`, 'Save a version now'],
    ['?', 'This list'],
  ]],
  ['Page notes', [
    ['/', 'Insert block (handwriting, audio, image, to-do…)'],
    ['[[', 'Link to another note'],
    [`${modKey} B / I / U`, 'Bold / italic / underline'],
    [`${modKey} ⇧ H`, 'Highlight'],
    ['# + space', 'Heading (##, ### for smaller)'],
    ['- [ ] + space', 'To-do item'],
    [`${modKey} Z / ${modKey} ⇧ Z`, 'Undo / redo'],
  ]],
  ['Canvas', [
    ['V  H  P  M  E', 'Select, pan, pen, highlighter, eraser'],
    ['T  /  S', 'Text box / sticky note'],
    ['I  /  L', 'Insert image / note card'],
    ['Space + drag', 'Pan'],
    [`${modKey} scroll / pinch`, 'Zoom'],
    ['⇧ 1', 'Zoom to fit everything'],
    [`${modKey} D`, 'Duplicate selection'],
    ['Delete', 'Delete selection'],
  ]],
  ['PDF', [
    ['V', 'Select text → highlight, underline, quote'],
    ['P  M  E  T', 'Pen, highlighter, eraser, text box'],
    ['J / K  or  ← / →', 'Next / previous page'],
    ['B', 'Bookmark page'],
    [`${modKey} + / − / 0`, 'Zoom in / out / fit width'],
  ]],
];

export function ShortcutsDialog() {
  const open = useStore((s) => s.shortcuts);
  if (!open) return null;
  return (
    <Modal onClose={() => setState({ shortcuts: false })} title="Keyboard shortcuts" wide>
      <div className="shortcuts">
        {GROUPS.map(([g, rows]) => (
          <div key={g} className="shortcut-group">
            <h4>{g}</h4>
            {rows.map(([k, d]) => (
              <div key={k} className="shortcut-row">
                <span>{d}</span>
                <kbd className="kbd">{k}</kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
