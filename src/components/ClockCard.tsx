import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { t } from "../lib/i18n";
import { errMsg, ymd } from "../lib/util";
import { entryMinutes, fmtClock, fmtDur, hhmm, type Shift, type TimeEntry } from "../lib/time";
import { Alert, Field, Modal } from "./ui";

/** „Начало / край на смяна“ – служителят отбелязва присъствието си с един бутон. */
export default function ClockCard({ onChange }: { onChange?: () => void }) {
  const { org, me } = useApp();
  const [open, setOpen] = useState<TimeEntry | null | undefined>(undefined);
  const [shift, setShift] = useState<Shift | null>(null);
  const [now, setNow] = useState(Date.now());
  const [ending, setEnding] = useState(false);
  const [brk, setBrk] = useState("0");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!org || !me) return;
    const [e, s] = await Promise.all([
      supabase.from("time_entries").select("*").eq("org_id", org.id).eq("membership_id", me.id).is("ended_at", null).order("started_at", { ascending: false }).limit(1),
      supabase.from("shifts").select("*").eq("org_id", org.id).eq("membership_id", me.id).eq("date", ymd()).eq("kind", "work"),
    ]);
    setOpen(((e.data as TimeEntry[]) ?? [])[0] ?? null);
    setShift(((s.data as Shift[]) ?? [])[0] ?? null);
  }, [org, me]);

  useEffect(() => {
    load();
  }, [load]);

  // тиктакане само докато смяната върви
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  async function start() {
    if (!org || !me) return;
    setBusy(true);
    setErr("");
    const { error } = await supabase.from("time_entries").insert({
      org_id: org.id,
      membership_id: me.id,
      shift_id: shift?.id ?? null,
      work_date: ymd(),
      started_at: new Date().toISOString(),
      method: "self",
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    await load();
    onChange?.();
  }

  async function finish() {
    if (!open) return;
    setBusy(true);
    setErr("");
    const { error } = await supabase
      .from("time_entries")
      .update({ ended_at: new Date().toISOString(), break_min: Math.max(0, Number(brk) || 0), note: note.trim() || null })
      .eq("id", open.id);
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setEnding(false);
    setNote("");
    await load();
    onChange?.();
  }

  if (open === undefined) return null;
  const secs = open ? Math.max(0, Math.floor((now - new Date(open.started_at).getTime()) / 1000)) : 0;
  const clock = `${String(Math.floor(secs / 3600)).padStart(2, "0")}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div className="card stack">
      <div className="label">{t("Присъствие")}</div>
      {open ? (
        <div className="clock">
          <div className="stack" style={{ gap: 6 }}>
            <span className="live">{t("На смяна от {time}", { time: fmtClock(open.started_at) })}</span>
            <span className="big">{clock}</span>
            <span className="muted small">{t("Отработени до момента: {d}", { d: fmtDur(entryMinutes(open, now)) })}</span>
          </div>
          <div className="grow" />
          <button
            className="btn big"
            onClick={() => {
              setBrk(String(shift?.break_min ?? 0));
              setEnding(true);
            }}
          >
            ■ {t("Край на смяна")}
          </button>
        </div>
      ) : (
        <div className="clock">
          <div className="stack" style={{ gap: 4 }}>
            <b>{shift ? t("По график: {time}", { time: `${hhmm(shift.start_time)}–${hhmm(shift.end_time)}` }) : t("Днес нямате смяна по график")}</b>
            <span className="muted small">{t("Натиснете, когато започнете работа.")}</span>
          </div>
          <div className="grow" />
          <button className="btn primary big" onClick={start} disabled={busy}>
            ▶ {t("Начало на смяна")}
          </button>
        </div>
      )}
      {err && <Alert kind="bad">{err}</Alert>}

      {ending && open && (
        <Modal title={t("Край на смяната")} onClose={() => setEnding(false)}>
          <div className="stack">
            <p className="muted">
              {t("Започнахте в {a}. Общо: {d}.", { a: fmtClock(open.started_at), d: fmtDur(entryMinutes({ ...open, break_min: Number(brk) || 0 }, Date.now())) })}
            </p>
            <Field label={t("Почивка (минути)")}>
              <input type="number" min={0} max={600} value={brk} onChange={(e) => setBrk(e.target.value)} />
            </Field>
            <Field label={t("Бележка (по желание)")}>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 64 }} />
            </Field>
            <button className="btn primary block" onClick={finish} disabled={busy}>
              {t("Приключи смяната")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
