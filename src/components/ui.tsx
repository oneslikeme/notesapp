import { create } from 'zustand';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* ---------------- Icon button ---------------- */

export function IconBtn({
  icon: Icon,
  label,
  onClick,
  active,
  size = 18,
  className = '',
  disabled,
  kbd,
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  size?: number;
  className?: string;
  disabled?: boolean;
  kbd?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? 'is-active' : ''} ${className}`}
      onClick={onClick}
      aria-label={label}
      title={kbd ? `${label}  (${kbd})` : label}
      disabled={disabled}
      {...rest}
    >
      <Icon size={size} strokeWidth={1.75} />
    </button>
  );
}

/* ---------------- Menus ---------------- */

export type MenuItem =
  | 'sep'
  | { header: string }
  | {
      label: string;
      icon?: LucideIcon;
      onClick?: () => void;
      danger?: boolean;
      hint?: string;
      checked?: boolean;
      disabled?: boolean;
      children?: MenuItem[];
    };

interface MenuState {
  open: null | { x: number; y: number; items: MenuItem[]; minWidth?: number; alignRight?: boolean };
}
const useMenuStore = create<MenuState>(() => ({ open: null }));

export function openMenu(at: { x: number; y: number } | DOMRect | HTMLElement, items: MenuItem[], opts: { alignRight?: boolean } = {}) {
  let x: number, y: number;
  if (at instanceof HTMLElement) at = at.getBoundingClientRect();
  if (at instanceof DOMRect) {
    x = opts.alignRight ? at.right : at.left;
    y = at.bottom + 4;
  } else ({ x, y } = at);
  useMenuStore.setState({ open: { x, y, items, alignRight: opts.alignRight } });
}
export function closeMenu() {
  useMenuStore.setState({ open: null });
}

export function MenuHost() {
  const open = useMenuStore((s) => s.open);
  if (!open) return null;
  return (
    <div className="menu-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeMenu()} onContextMenu={(e) => (e.preventDefault(), closeMenu())}>
      <MenuList items={open.items} x={open.x} y={open.y} alignRight={open.alignRight} root />
    </div>
  );
}

function MenuList({ items, x, y, alignRight, root }: { items: MenuItem[]; x: number; y: number; alignRight?: boolean; root?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, ready: false });
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null);
  const [focus, setFocus] = useState(-1);

  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    let nx = alignRight ? x - r.width : x;
    let ny = y;
    if (nx + r.width > window.innerWidth - 8) nx = window.innerWidth - r.width - 8;
    if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, nx), y: ny, ready: true });
  }, [x, y, alignRight]);

  const actionable = items.map((it, i) => (typeof it === 'object' && 'label' in it && !it.disabled ? i : -1)).filter((i) => i >= 0);

  useEffect(() => {
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return closeMenu();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = actionable.indexOf(focus);
        const next = e.key === 'ArrowDown' ? actionable[(idx + 1) % actionable.length] : actionable[(idx - 1 + actionable.length) % actionable.length];
        setFocus(next ?? -1);
      }
      if (e.key === 'Enter' && focus >= 0) {
        e.preventDefault();
        const it = items[focus] as any;
        closeMenu();
        it.onClick?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y, visibility: pos.ready ? 'visible' : 'hidden' }} role="menu">
      {items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="menu-sep" />;
        if ('header' in it) return <div key={i} className="menu-header">{it.header}</div>;
        const Icon = it.icon;
        return (
          <button
            key={i}
            role="menuitem"
            className={`menu-item ${it.danger ? 'is-danger' : ''} ${focus === i ? 'is-focus' : ''}`}
            disabled={it.disabled}
            onMouseEnter={(e) => {
              setFocus(i);
              if (it.children) {
                const r = e.currentTarget.getBoundingClientRect();
                setSub({ i, x: r.right - 4, y: r.top - 6 });
              } else setSub(null);
            }}
            onClick={() => {
              if (it.children) return;
              closeMenu();
              it.onClick?.();
            }}
          >
            <span className="menu-icon">{it.checked ? <Check size={15} /> : Icon ? <Icon size={15} strokeWidth={1.75} /> : null}</span>
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
            {it.children && <ChevronRight size={14} className="menu-hint" />}
          </button>
        );
      })}
      {sub && <MenuList items={(items[sub.i] as any).children} x={sub.x} y={sub.y} />}
    </div>
  );
}

/* ---------------- Dialogs ---------------- */

interface DialogState {
  stack: { id: number; node: (close: () => void) => ReactNode }[];
}
const useDialogStore = create<DialogState>(() => ({ stack: [] }));
let dialogId = 0;

export function openDialog(node: (close: () => void) => ReactNode) {
  const id = ++dialogId;
  useDialogStore.setState((s) => ({ stack: [...s.stack, { id, node }] }));
  return () => useDialogStore.setState((s) => ({ stack: s.stack.filter((d) => d.id !== id) }));
}

export function DialogHost() {
  const stack = useDialogStore((s) => s.stack);
  return (
    <>
      {stack.map((d) => {
        const close = () => useDialogStore.setState((s) => ({ stack: s.stack.filter((x) => x.id !== d.id) }));
        return <div key={d.id}>{d.node(close)}</div>;
      })}
    </>
  );
}

export function Modal({
  onClose,
  children,
  className = '',
  title,
  wide,
}: {
  onClose: () => void;
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'is-wide' : ''} ${className}`} role="dialog" aria-modal>
        {title && <div className="modal-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function askText(opts: { title: string; placeholder?: string; initial?: string; confirm?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    openDialog((close) => <PromptDialog {...opts} done={(v) => (close(), resolve(v))} />);
  });
}

function PromptDialog({ title, placeholder, initial, confirm, done }: { title: string; placeholder?: string; initial?: string; confirm?: string; done: (v: string | null) => void }) {
  const [v, setV] = useState(initial ?? '');
  return (
    <Modal onClose={() => done(null)} title={title} className="is-small">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          done(v.trim() ? v.trim() : null);
        }}
      >
        <input className="input" autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => done(null)}>Cancel</button>
          <button type="submit" className="btn is-primary">{confirm ?? 'OK'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function confirmDialog(opts: { title: string; body?: string; confirm?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    openDialog((close) => (
      <Modal onClose={() => (close(), resolve(false))} title={opts.title} className="is-small">
        {opts.body && <p className="modal-body">{opts.body}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={() => (close(), resolve(false))}>Cancel</button>
          <button autoFocus className={`btn ${opts.danger ? 'is-danger' : 'is-primary'}`} onClick={() => (close(), resolve(true))}>
            {opts.confirm ?? 'Confirm'}
          </button>
        </div>
      </Modal>
    ));
  });
}

/* ---------------- Misc ---------------- */

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} title={o.title} className={o.value === value ? 'is-on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={28} strokeWidth={1.5} />
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}
