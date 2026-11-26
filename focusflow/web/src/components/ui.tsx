// Small, accessible UI primitives used across the app.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Link } from "react-router";

export function Toggle({ checked, onChange, label, hint, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field-row">
      <div className="field-text">
        <label htmlFor={id}>{label}</label>
        {hint && <p className="hint">{hint}</p>}
      </div>
      <button
        id={id} type="button" role="switch" aria-checked={checked} disabled={disabled}
        className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}
      >
        <span className="knob" />
      </button>
    </div>
  );
}

export function NumberField({ value, onChange, label, min, max, step = 1, suffix, hint }: {
  value: number; onChange: (v: number) => void; label: string; min: number; max: number; step?: number; suffix?: string; hint?: string;
}) {
  const id = useId();
  return (
    <div className="field-row">
      <div className="field-text">
        <label htmlFor={id}>{label}</label>
        {hint && <p className="hint">{hint}</p>}
      </div>
      <div className="stepper">
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(min, value - step))}>−</button>
        <input
          id={id} type="number" inputMode="numeric" min={min} max={max} step={step} value={value}
          onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }}
        />
        {suffix && <span className="suffix">{suffix}</span>}
        <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(Math.min(max, value + step))}>+</button>
      </div>
    </div>
  );
}

export function Slider({ value, onChange, label, min = 0, max = 1, step = 0.05, format }: {
  value: number; onChange: (v: number) => void; label: string; min?: number; max?: number; step?: number; format?: (v: number) => string;
}) {
  const id = useId();
  return (
    <div className="field-row">
      <div className="field-text"><label htmlFor={id}>{label}</label></div>
      <div className="slider">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <output htmlFor={id}>{format ? format(value) : `${Math.round(value * 100)}%`}</output>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value}
          className={o.value === value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal ${wide ? "wide" : ""}`} onClose={onClose} onCancel={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="modal-body">
          <header className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function ProBadge() {
  return <span className="pro-badge">PRO</span>;
}

export function ProLock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pro-lock card">
      <div className="pro-lock-icon" aria-hidden>✦</div>
      <h3>{title} <ProBadge /></h3>
      <div className="muted">{children}</div>
      <Link className="btn primary" to="/pricing">See Pro</Link>
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <div className="spinner" role="status" aria-label={label} />;
}

export function Stars({ value, onChange, label }: { value: number | null; onChange: (v: number) => void; label: string }) {
  return (
    <div className="stars" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} of 5`}
          className={value != null && n <= value ? "lit" : ""} onClick={() => onChange(n)}>
          ●
        </button>
      ))}
    </div>
  );
}
