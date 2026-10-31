import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { t } from "../lib/i18n";
import type { Membership } from "../lib/types";
import { addDays, errMsg, niceDate, parseYmd, ymd } from "../lib/util";
import {
  downloadCsv, entryMinutes, fmtClock, fmtDur, fromLocalInput, hhmm, monthEnd, monthStart, shiftMinutes, toLocalInput, weekStart,
  type Shift, type TimeEntry,
} from "../lib/time";
import ClockCard from "../components/ClockCard";
import { Alert, Empty, Field, Modal, Spinner } from "../components/ui";

type Period = "week" | "month";

function range(p: Period, anchor: string): [string, string] {
  return p === "week" ? [weekStart(anchor), addDays(weekStart(anchor), 6)] : [monthStart(anchor), monthEnd(anchor)];
}
function shiftAnchor(p: Period, anchor: string, dir: number): string {
  if (p === "week") return addDays(anchor, 7 * dir);
  const d = parseYmd(anchor);
  return ymd(new Date(d.getFullYear(), d.getMonth() + dir, 1));
}
function periodLabel(p: Period, anchor: string): string {
  const [a, b] = range(p, anchor);
  const f = (s: string) => `${String(parseYmd(s).getDate()).padStart(2, "0")}.${String(parseYmd(s).getMonth() + 1).padStart(2, "0")}`;
  return p === "week" ? `${f(a)} – ${f(b)}.${parseYmd(b).getFullYear()}` : new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(parseYmd(a));
}
/** Закъснение в минути спрямо началото на смяната (само ако е повече от 10). */
function lateMin(e: TimeEntry, shifts: Shift[]): number {
  const s = shifts.find((x) => x.id === e.shift_id) ?? shifts.find((x) => x.membership_id === e.membership_id && x.date === e.work_date && x.kind === "work");
  if (!s?.start_time) return 0;
  const [h, m] = s.start_time.split(":").map(Number);
  const d = parseYmd(e.work_date);
  const planned = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
  const late = Math.round((new Date(e.started_at).getTime() - planned) / 60000);
  return late > 10 ? late : 0;
}
const plannedMin = (shifts: Shift[], id: string, upTo: string) =>
  shifts.filter((s) => s.membership_id === id && s.kind === "work" && s.date <= upTo).reduce((a, s) => a + shiftMinutes(s.start_time, s.end_time, s.break_min), 0);

export default function Hours() {
  const { isManager } = useApp();
  return isManager ? <ManagerHours /> : <EmployeeHours />;
}

/* ================================================================ служител */
function EmployeeHours() {
  const { org, me, perm } = useApp();
  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(ymd());
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [from, to] = range(period, anchor);
  const today = ymd();

  const load = useCallback(async () => {
    if (!org || !me) return;
    const [e, s] = await Promise.all([
      supabase.from("time_entries").select("*").eq("org_id", org.id).eq("membership_id", me.id).gte("work_date", from).lte("work_date", to).order("started_at", { ascending: false }),
      supabase.from("shifts").select("*").eq("org_id", org.id).eq("membership_id", me.id).gte("date", from).lte("date", to),
    ]);
    setEntries((e.data as TimeEntry[]) ?? []);
    setShifts((s.data as Shift[]) ?? []);
  }, [org, me, from, to]);

  useEffect(() => {
    setEntries(null);
    load();
  }, [load]);

  if (!me) return null;
  const worked = (entries ?? []).reduce((a, e) => a + entryMinutes(e), 0);
  const planned = plannedMin(shifts, me.id, today < to ? today : to);
  const diff = worked - planned;
  const byDay = new Map<string, TimeEntry[]>();
  for (const e of entries ?? []) byDay.set(e.work_date, [...(byDay.get(e.work_date) ?? []), e]);

  return (
    <div className="stack">
      <h1>{t("Часове")}</h1>
      {perm.clock && <ClockCard onChange={load} />}

      {perm.seeHours ? (
        <>
          <div className="row between wrap">
            <div className="seg" role="group">
              <button className={period === "week" ? "on" : ""} onClick={() => setPeriod("week")}>
                {t("Седмица")}
              </button>
              <button className={period === "month" ? "on" : ""} onClick={() => setPeriod("month")}>
                {t("Месец")}
              </button>
            </div>
          </div>
          <div className="daynav">
            <button className="btn small" onClick={() => setAnchor(shiftAnchor(period, anchor, -1))} aria-label={t("Назад")}>
              ‹
            </button>
            <div className="label-date">{periodLabel(period, anchor)}</div>
            <button className="btn small" onClick={() => setAnchor(shiftAnchor(period, anchor, 1))} aria-label={t("Напред")}>
              ›
            </button>
          </div>

          <div className="stats">
            <div className="stat">
              <div className="k">{t("Отработено")}</div>
              <div className="v">{fmtDur(worked)}</div>
            </div>
            <div className="stat">
              <div className="k">{t("По график")}</div>
              <div className="v">{fmtDur(planned)}</div>
            </div>
            <div className="stat">
              <div className="k">{t("Разлика")}</div>
              <div className={`v ${diff > 0 ? "pos" : diff < 0 ? "neg" : ""}`}>
                {diff > 0 ? "+" : diff < 0 ? "−" : ""}
                {fmtDur(Math.abs(diff))}
              </div>
            </div>
          </div>

          {entries === null ? (
            <Spinner />
          ) : entries.length === 0 ? (
            <Empty icon="⏱️">{t("Няма записани часове за този период.")}</Empty>
          ) : (
            <div className="stack">
              {[...byDay.entries()].map(([d, list]) => (
                <div key={d} className="card stack" style={{ gap: 8 }}>
                  <div className="row between">
                    <b>{niceDate(d)}</b>
                    <b>{fmtDur(list.reduce((a, e) => a + entryMinutes(e), 0))}</b>
                  </div>
                  {list.map((e) => {
                    const late = lateMin(e, shifts);
                    return (
                      <div key={e.id} className="row wrap small muted" style={{ gap: 10 }}>
                        <span>
                          {fmtClock(e.started_at)} – {e.ended_at ? fmtClock(e.ended_at) : t("в момента")}
                        </span>
                        {e.break_min > 0 && <span>{t("почивка {m} м", { m: e.break_min })}</span>}
                        {late > 0 && <span className="chip late">{t("закъснение {m} м", { m: late })}</span>}
                        {e.ended_at ? (
                          <span className={`chip ${e.approved ? "approved" : "submitted"}`}>{e.approved ? t("Одобрено") : t("Чака одобрение")}</span>
                        ) : (
                          <span className="chip pending">{t("На смяна")}</span>
                        )}
                        {e.note && <span>· {e.note}</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <Alert kind="info">{t("Часовете ви се виждат от ръководителя.")}</Alert>
      )}
    </div>
  );
}

/* ================================================================ ръководител / работодател */
function ManagerHours() {
  const { org, isOwner, groups, leaderGroupIds, members, groupMembers } = useApp();
  const mineGroups = useMemo(() => (isOwner ? groups : groups.filter((g) => leaderGroupIds.includes(g.id))), [isOwner, groups, leaderGroupIds]);
  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(ymd());
  const [gid, setGid] = useState("");
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ entry?: TimeEntry; person?: string } | null>(null);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [from, to] = range(period, anchor);
  const today = ymd();

  const people = useMemo(() => {
    const groupIds = gid ? [gid] : mineGroups.map((g) => g.id);
    const ids = new Set(groupMembers.filter((g) => groupIds.includes(g.group_id)).map((g) => g.membership_id));
    return members.filter((m) => ids.has(m.id) && m.active && m.role !== "owner");
  }, [gid, mineGroups, groupMembers, members]);
  const ids = useMemo(() => people.map((p) => p.id), [people]);

  const load = useCallback(async () => {
    if (!org) return;
    const [e, s] = await Promise.all([
      supabase.from("time_entries").select("*").eq("org_id", org.id).gte("work_date", from).lte("work_date", to).order("started_at"),
      supabase.from("shifts").select("*").eq("org_id", org.id).gte("date", from).lte("date", to),
    ]);
    setEntries(((e.data as TimeEntry[]) ?? []).filter((x) => ids.includes(x.membership_id)));
    setShifts(((s.data as Shift[]) ?? []).filter((x) => ids.includes(x.membership_id)));
  }, [org, from, to, ids]);

  useEffect(() => {
    setEntries(null);
    load();
  }, [load]);

  if (mineGroups.length === 0) return <Alert kind="warn">Нямате групи за управление. Създайте група от „Хора → Групи“.</Alert>;

  const list = entries ?? [];
  const rows = people.map((p) => {
    const mine = list.filter((e) => e.membership_id === p.id);
    const worked = mine.reduce((a, e) => a + entryMinutes(e), 0);
    const planned = plannedMin(shifts, p.id, today < to ? today : to);
    return { p, mine, worked, planned, diff: worked - planned, pending: mine.filter((e) => e.ended_at && !e.approved).length };
  });
  const pendingAll = rows.reduce((a, r) => a + r.pending, 0);
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

  async function approveAll() {
    setErr("");
    const idsToApprove = list.filter((e) => e.ended_at && !e.approved).map((e) => e.id);
    const { error } = await supabase.from("time_entries").update({ approved: true }).in("id", idsToApprove);
    if (error) return setErr(errMsg(error));
    setInfo(`Одобрени са ${idsToApprove.length} записа.`);
    await load();
  }
  async function toggleApprove(e: TimeEntry) {
    const { error } = await supabase.from("time_entries").update({ approved: !e.approved }).eq("id", e.id);
    if (error) return setErr(errMsg(error));
    await load();
  }
  function exportCsv() {
    const hrs = (m: number) => (m / 60).toFixed(2).replace(".", ",");
    const name = (id: string) => members.find((m) => m.id === id)?.display_name ?? "";
    const data: (string | number)[][] = [["Служител", "Дата", "Начало", "Край", "Почивка (мин)", "Отработени (ч)", "Закъснение (мин)", "Одобрено", "Бележка"]];
    for (const e of list)
      data.push([name(e.membership_id), e.work_date, fmtClock(e.started_at), e.ended_at ? fmtClock(e.ended_at) : "", e.break_min, hrs(entryMinutes(e)), lateMin(e, shifts), e.approved ? "да" : "не", e.note ?? ""]);
    data.push([]);
    data.push(["Обобщение", "", "", "", "", "", "", "", ""]);
    data.push(["Служител", "Отработени (ч)", "По график до днес (ч)", "Разлика (ч)"]);
    for (const r of rows) data.push([r.p.display_name, hrs(r.worked), hrs(r.planned), hrs(r.diff)]);
    downloadCsv(`chasove_${from}_${to}.csv`, data);
  }

  return (
    <div className="stack">
      <div className="row between wrap">
        <h1>Часове</h1>
        <button className="btn small primary" onClick={() => setEdit({})}>
          + Запис
        </button>
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <div className="seg" role="group">
          <button className={period === "week" ? "on" : ""} onClick={() => setPeriod("week")}>
            Седмица
          </button>
          <button className={period === "month" ? "on" : ""} onClick={() => setPeriod("month")}>
            Месец
          </button>
        </div>
        <select style={{ width: "auto", flex: 1, minWidth: 150 }} value={gid} onChange={(e) => setGid(e.target.value)} aria-label="Група">
          <option value="">Всички мои групи</option>
          {mineGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <div className="daynav">
        <button className="btn small" onClick={() => setAnchor(shiftAnchor(period, anchor, -1))} aria-label="Назад">
          ‹
        </button>
        <div className="label-date">{periodLabel(period, anchor)}</div>
        <button className="btn small" onClick={() => setAnchor(shiftAnchor(period, anchor, 1))} aria-label="Напред">
          ›
        </button>
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn small" onClick={approveAll} disabled={pendingAll === 0}>
          ✓ Одобри всички{pendingAll ? ` (${pendingAll})` : ""}
        </button>
        <button className="btn small" onClick={exportCsv} disabled={list.length === 0}>
          ⬇ Експорт за Excel
        </button>
      </div>
      {info && <Alert kind="ok">{info}</Alert>}
      {err && <Alert kind="bad">{err}</Alert>}

      {entries === null ? (
        <Spinner />
      ) : people.length === 0 ? (
        <Empty icon="👥">Няма хора в избраните групи.</Empty>
      ) : (
        <div className="card tswrap" style={{ padding: 8 }}>
          <table className="ts">
            <thead>
              <tr>
                <th>Служител</th>
                <th className="num">Отработено</th>
                <th className="num">По график</th>
                <th className="num">Разлика</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <TsRow key={r.p.id} r={r} open={open === r.p.id} onToggle={() => setOpen(open === r.p.id ? null : r.p.id)} shifts={shifts} sign={sign} onEdit={(e) => setEdit({ entry: e })} onApprove={toggleApprove} onAdd={() => setEdit({ person: r.p.id })} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">„По график“ е до днес. Закъснение се отбелязва при начало над 10 минути след смяната.</p>

      {edit && (
        <EntryModal
          people={people}
          entry={edit.entry}
          person={edit.person}
          shifts={shifts}
          onClose={async (changed) => {
            setEdit(null);
            if (changed) await load();
          }}
        />
      )}
    </div>
  );
}

function TsRow({
  r, open, onToggle, shifts, sign, onEdit, onApprove, onAdd,
}: {
  r: { p: Membership; mine: TimeEntry[]; worked: number; planned: number; diff: number; pending: number };
  open: boolean; onToggle: () => void; shifts: Shift[]; sign: (n: number) => string;
  onEdit: (e: TimeEntry) => void; onApprove: (e: TimeEntry) => void; onAdd: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          <b>{r.p.display_name}</b>
          {r.pending > 0 && <span className="chip submitted" style={{ marginLeft: 8 }}>{r.pending} за одобрение</span>}
        </td>
        <td className="num">{fmtDur(r.worked)}</td>
        <td className="num">{fmtDur(r.planned)}</td>
        <td className={`num ${r.diff > 0 ? "pos" : r.diff < 0 ? "neg" : ""}`}>
          {sign(r.diff)}
          {fmtDur(Math.abs(r.diff))}
        </td>
        <td className="num">
          <button className="btn ghost small" onClick={onToggle} aria-expanded={open}>
            {open ? "Скрий" : "Дни"}
          </button>
        </td>
      </tr>
      {open && (
        <>
          {r.mine.length === 0 && (
            <tr className="sub">
              <td colSpan={5} className="muted">
                Няма записи за периода.
              </td>
            </tr>
          )}
          {r.mine.map((e) => {
            const late = lateMin(e, shifts);
            return (
              <tr key={e.id} className="sub">
                <td>
                  {niceDate(e.work_date)}
                  {late > 0 && <span className="chip late" style={{ marginLeft: 8 }}>закъснение {late} м</span>}
                  {e.method === "manager" && <span className="muted small"> · въведено от ръководител</span>}
                  {e.note && <div className="muted small">{e.note}</div>}
                </td>
                <td className="num">
                  {fmtClock(e.started_at)} – {e.ended_at ? fmtClock(e.ended_at) : "в момента"}
                </td>
                <td className="num">{fmtDur(entryMinutes(e))}</td>
                <td className="num">
                  {e.ended_at && (
                    <button className={`chip ${e.approved ? "approved" : "submitted"}`} style={{ border: 0, cursor: "pointer" }} onClick={() => onApprove(e)} title="Смяна на състоянието">
                      {e.approved ? "одобрено" : "одобри"}
                    </button>
                  )}
                </td>
                <td className="num">
                  <button className="btn ghost small" onClick={() => onEdit(e)}>
                    Редакция
                  </button>
                </td>
              </tr>
            );
          })}
          <tr className="sub">
            <td colSpan={5}>
              <button className="btn ghost small" onClick={onAdd}>
                + Добави запис за {r.p.display_name.split(" ")[0]}
              </button>
            </td>
          </tr>
        </>
      )}
    </>
  );
}

function EntryModal({
  people, entry, person, shifts, onClose,
}: {
  people: Membership[]; entry?: TimeEntry; person?: string; shifts: Shift[]; onClose: (changed: boolean) => void;
}) {
  const { org } = useApp();
  const [who, setWho] = useState(entry?.membership_id ?? person ?? people[0]?.id ?? "");
  const nowLocal = toLocalInput(new Date().toISOString());
  const [start, setStart] = useState(entry ? toLocalInput(entry.started_at) : `${ymd()}T08:00`);
  const [end, setEnd] = useState(entry?.ended_at ? toLocalInput(entry.ended_at) : entry ? "" : `${ymd()}T16:00`);
  const [brk, setBrk] = useState(String(entry?.break_min ?? 30));
  const [note, setNote] = useState(entry?.note ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // при избор на човек и дата – предлагаме времето от неговата смяна
  function fillFromShift(personId: string, startVal: string) {
    const date = startVal.slice(0, 10);
    const s = shifts.find((x) => x.membership_id === personId && x.date === date && x.kind === "work");
    if (s?.start_time && s.end_time) {
      setStart(`${date}T${hhmm(s.start_time)}`);
      const crosses = s.end_time <= s.start_time;
      setEnd(`${crosses ? addDays(date, 1) : date}T${hhmm(s.end_time)}`);
      setBrk(String(s.break_min));
    }
  }

  async function save() {
    if (!org || !who) return;
    setErr("");
    if (!start) return setErr("Въведете начало.");
    if (end && new Date(end) <= new Date(start)) return setErr("Краят трябва да е след началото.");
    setBusy(true);
    const row = {
      org_id: org.id, membership_id: who, work_date: start.slice(0, 10), started_at: fromLocalInput(start),
      ended_at: end ? fromLocalInput(end) : null, break_min: Math.max(0, Number(brk) || 0), note: note.trim() || null,
      shift_id: shifts.find((x) => x.membership_id === who && x.date === start.slice(0, 10) && x.kind === "work")?.id ?? null,
    };
    const { error } = entry
      ? await supabase.from("time_entries").update(row).eq("id", entry.id)
      : await supabase.from("time_entries").insert({ ...row, method: "manager", approved: true });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    onClose(true);
  }
  async function remove() {
    if (!entry || !confirm("Да изтрия ли този запис?")) return;
    const { error } = await supabase.from("time_entries").delete().eq("id", entry.id);
    if (error) return setErr(errMsg(error));
    onClose(true);
  }

  return (
    <Modal title={entry ? "Редакция на запис" : "Нов запис за часове"} onClose={() => onClose(false)}>
      <div className="stack">
        <Field label="Служител">
          <select value={who} onChange={(e) => (setWho(e.target.value), !entry && fillFromShift(e.target.value, start))} disabled={Boolean(entry)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </Field>
        <div className="row wrap">
          <div className="field grow">
            <label>Начало</label>
            <input type="datetime-local" value={start} max={nowLocal} onChange={(e) => (setStart(e.target.value), !entry && fillFromShift(who, e.target.value))} />
          </div>
          <div className="field grow">
            <label>Край {entry && !entry.ended_at ? "(смяната върви)" : ""}</label>
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="row wrap">
          <div className="field" style={{ width: 130 }}>
            <label>Почивка, мин</label>
            <input type="number" min={0} value={brk} onChange={(e) => setBrk(e.target.value)} />
          </div>
          <div className="field grow">
            <label>Бележка</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        {err && <Alert kind="bad">{err}</Alert>}
        <button className="btn primary block" onClick={save} disabled={busy}>
          Запази
        </button>
        {entry && (
          <button className="btn danger block" onClick={remove}>
            Изтрий записа
          </button>
        )}
      </div>
    </Modal>
  );
}
