import { useEffect, useState, type ReactNode } from "react";
import type { Occurrence, OccStatus } from "../lib/types";
import { statusLabel, ymd } from "../lib/util";
import { t } from "../lib/i18n";

/** Скелет на списък, докато се зарежда (вместо въртележка). */
export function Spinner() {
  return (
    <div className="skeleton" role="status" aria-label={t("Зареждане")}>
      <i />
      <i />
      <i />
    </div>
  );
}

/** Пръстен с напредъка: зелено = одобрени, жълто = чакат одобрение. */
export function ProgressRing({ ok, wait, total }: { ok: number; wait: number; total: number }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const frac = (n: number) => (total ? Math.min(1, n / total) : 0);
  return (
    <svg className="ring" viewBox="0 0 76 76" role="img" aria-label={t("{n} от {total} изпълнени", { n: ok + wait, total })}>
      <circle className="track" cx="38" cy="38" r={r} />
      <circle className="bar wait" cx="38" cy="38" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - frac(ok + wait))} />
      <circle className="bar" cx="38" cy="38" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - frac(ok))} />
      <text x="38" y="39">{total ? Math.round((frac(ok + wait)) * 100) : 0}%</text>
    </svg>
  );
}

/** Превключвател (включено/изключено) с текст. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`switch ${disabled ? "disabled" : ""}`}>
      <span className="switch-text">
        <b>{label}</b>
        {hint && <span className="muted small">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i className="switch-ui" aria-hidden="true" />
    </label>
  );
}

export function Empty({ icon = "📭", children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div>{children}</div>
    </div>
  );
}

export function Alert({ kind = "info", children }: { kind?: "info" | "warn" | "bad" | "ok"; children: ReactNode }) {
  return <div className={`alert ${kind}`}>{children}</div>;
}

export function Chip({ status, late }: { status: OccStatus; late?: boolean }) {
  if (late && status === "pending") {
    return <span className="chip late">{t("Просрочено")}</span>;
  }
  return <span className={`chip ${status}`}>{statusLabel(status)}</span>;
}

export function isLate(o: Pick<Occurrence, "due_date" | "status">): boolean {
  return o.status === "pending" && o.due_date < ymd();
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2>{title}</h2>
          <button className="btn ghost small" onClick={onClose} aria-label={t("Затвори")}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}

export function useLightbox() {
  const [src, setSrc] = useState<string | null>(null);
  const node = src ? (
    <div className="lightbox" onClick={() => setSrc(null)}>
      <img src={src} alt="Снимка" />
    </div>
  ) : null;
  return { open: setSrc, node };
}

export function Progress({ ok, wait, total }: { ok: number; wait: number; total: number }) {
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <div className="progress" aria-label={`${ok} от ${total} одобрени`}>
      <i className="p-ok" style={{ width: `${pct(ok)}%` }} />
      <i className="p-warn" style={{ width: `${pct(wait)}%` }} />
    </div>
  );
}
