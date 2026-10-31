import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { t } from "../lib/i18n";
import type { Membership } from "../lib/types";
import { addDays, errMsg, parseYmd, uuid, weekdayName, ymd } from "../lib/util";
import {
  fmtDur, hhmm, KIND_COLOR, KIND_LABEL, shiftMinutes, weekDays, weekStart,
  type Shift, type ShiftKind, type ShiftType,
} from "../lib/time";
import { Alert, Empty, Field, Modal, Spinner } from "../components/ui";

const fmtWeek = (ws: string) => {
  const a = parseYmd(ws);
  const b = parseYmd(addDays(ws, 6));
  const f = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${f(a)} – ${f(b)}.${b.getFullYear()}`;
};

function cellText(s: Shift, types: ShiftType[]): { top: string; sub: string; color: string } {
  if (s.kind !== "work") return { top: t(KIND_LABEL[s.kind]), sub: "", color: KIND_COLOR[s.kind] };
  const ty = types.find((x) => x.id === s.shift_type_id);
  return { top: ty?.name ?? t("Смяна"), sub: `${hhmm(s.start_time)}–${hhmm(s.end_time)}`, color: ty?.color ?? KIND_COLOR.work };
}

export default function Schedule() {
  const { perm } = useApp();
  if (perm.schedule === "manage") return <ManagerSchedule />;
  if (perm.schedule === "none") return <Alert kind="info">{t("Графикът не е достъпен.")}</Alert>;
  return <EmployeeSchedule />;
}

/* ================================================================ служител */
function EmployeeSchedule() {
  const { org, me, perm, members, groupMembers, myGroupIds } = useApp();
  const [ws, setWs] = useState(weekStart(ymd()));
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [types, setTypes] = useState<ShiftType[]>([]);
  const [next, setNext] = useState<Shift | null>(null);
  const [view, setView] = useState<"mine" | "team">("mine");
  const days = weekDays(ws);
  const today = ymd();

  const teamIds = useMemo(() => {
    const ids = new Set(groupMembers.filter((g) => myGroupIds.includes(g.group_id) && !g.is_leader).map((g) => g.membership_id));
    if (me) ids.add(me.id);
    return ids;
  }, [groupMembers, myGroupIds, me]);

  const load = useCallback(async () => {
    if (!org || !me) return;
    const [s, ty, up] = await Promise.all([
      supabase.from("shifts").select("*").eq("org_id", org.id).gte("date", ws).lte("date", addDays(ws, 6)),
      supabase.from("shift_types").select("*").eq("org_id", org.id),
      supabase.from("shifts").select("*").eq("org_id", org.id).eq("membership_id", me.id).eq("kind", "work").gte("date", today).lte("date", addDays(today, 21)).order("date"),
    ]);
    setShifts((s.data as Shift[]) ?? []);
    setTypes((ty.data as ShiftType[]) ?? []);
    setNext(((up.data as Shift[]) ?? [])[0] ?? null);
  }, [org, me, ws, today]);

  useEffect(() => {
    setShifts(null);
    load();
  }, [load]);

  if (!me) return null;
  const mine = (shifts ?? []).filter((s) => s.membership_id === me.id);
  const hours = mine.filter((s) => s.kind === "work").reduce((a, s) => a + shiftMinutes(s.start_time, s.end_time, s.break_min), 0);
  const people = members.filter((m) => teamIds.has(m.id) && m.active);

  const when = (s: Shift) => {
    const d = s.date === today ? t("Днес") : s.date === addDays(today, 1) ? t("Утре") : `${weekdayName(parseYmd(s.date))}, ${parseYmd(s.date).getDate()}.${String(parseYmd(s.date).getMonth() + 1).padStart(2, "0")}`;
    return d.charAt(0).toUpperCase() + d.slice(1);
  };

  return (
    <div className="stack">
      <h1>{t("График")}</h1>

      {next && (
        <div className="shiftcard" style={{ ["--c" as string]: cellText(next, types).color }}>
          <i className="bar" />
          <div className="grow">
            <div className="label">{t("Следваща смяна")}</div>
            <div className="when">
              {when(next)} · {hhmm(next.start_time)}–{hhmm(next.end_time)}
            </div>
            <div className="muted small">{cellText(next, types).top}</div>
          </div>
        </div>
      )}

      <div className="daynav">
        <button className="btn small" onClick={() => setWs(addDays(ws, -7))} aria-label={t("Предишна седмица")}>
          ‹
        </button>
        <div className="label-date">{fmtWeek(ws)}</div>
        <button className="btn small" onClick={() => setWs(addDays(ws, 7))} aria-label={t("Следваща седмица")}>
          ›
        </button>
      </div>
      {ws !== weekStart(today) && (
        <button className="btn small ghost" onClick={() => setWs(weekStart(today))}>
          {t("Към тази седмица")}
        </button>
      )}

      {perm.schedule === "group" && (
        <div className="seg" role="group">
          <button className={view === "mine" ? "on" : ""} onClick={() => setView("mine")}>
            {t("Моят график")}
          </button>
          <button className={view === "team" ? "on" : ""} onClick={() => setView("team")}>
            {t("Екипът")}
          </button>
        </div>
      )}

      {shifts === null ? (
        <Spinner />
      ) : view === "mine" ? (
        <>
          <div className="stack">
            {days.map((d) => {
              const s = mine.find((x) => x.date === d);
              const c = s ? cellText(s, types) : null;
              const dd = parseYmd(d);
              return (
                <div key={d} className={`shiftcard ${!s || s.kind !== "work" ? "off" : ""}`} style={{ ["--c" as string]: c?.color ?? "var(--line)" }}>
                  <i className="bar" />
                  <div style={{ minWidth: 92 }}>
                    <div className="when" style={d === today ? { color: "var(--accent, var(--primary))" } : undefined}>
                      {weekdayName(dd, "short")}
                    </div>
                    <div className="muted small">
                      {String(dd.getDate()).padStart(2, "0")}.{String(dd.getMonth() + 1).padStart(2, "0")}
                    </div>
                  </div>
                  <div className="grow">
                    {s ? (
                      <>
                        <b>{c!.top}</b>
                        {c!.sub && <div className="muted small">{c!.sub}</div>}
                        {s.note && <div className="muted small">{s.note}</div>}
                      </>
                    ) : (
                      <span className="muted">{t("Няма публикуван график")}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {mine.some((s) => s.kind === "work") && (
            <div className="muted small">{t("Общо по график през седмицата: {d}", { d: fmtDur(hours) })}</div>
          )}
        </>
      ) : (
        <TeamGrid days={days} people={people} shifts={shifts} types={types} meId={me.id} />
      )}
    </div>
  );
}

function TeamGrid({ days, people, shifts, types, meId }: { days: string[]; people: Membership[]; shifts: Shift[]; types: ShiftType[]; meId: string }) {
  const today = ymd();
  if (people.length === 0) return <Empty icon="👥">{t("Няма хора в групата.")}</Empty>;
  return (
    <div className="sched">
      <table>
        <thead>
          <tr>
            <th />
            {days.map((d) => (
              <th key={d} className={d === today ? "today" : ""}>
                {weekdayName(parseYmd(d), "short")} {parseYmd(d).getDate()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id}>
              <td className="who">{p.display_name}</td>
              {days.map((d) => {
                const s = shifts.find((x) => x.membership_id === p.id && x.date === d);
                if (!s)
                  return (
                    <td key={d}>
                      <span className="cell empty ro">·</span>
                    </td>
                  );
                const c = cellText(s, types);
                return (
                  <td key={d}>
                    <span className={`cell ro ${s.kind === "work" ? "shift" : ""} ${p.id === meId ? "mine" : ""}`} style={{ ["--c" as string]: c.color }}>
                      <span className="t">{c.top}</span>
                      {c.sub && <span className="h">{c.sub}</span>}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ================================================================ ръководител / работодател */
function ManagerSchedule() {
  const { org, isOwner, groups, leaderGroupIds, members, groupMembers } = useApp();
  const mine = useMemo(() => (isOwner ? groups : groups.filter((g) => leaderGroupIds.includes(g.id))), [isOwner, groups, leaderGroupIds]);
  const [gid, setGid] = useState(mine[0]?.id ?? "");
  const [ws, setWs] = useState(weekStart(ymd()));
  const [types, setTypes] = useState<ShiftType[]>([]);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [edit, setEdit] = useState<{ m: Membership; date: string } | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const days = weekDays(ws);
  const today = ymd();

  useEffect(() => {
    if (!mine.some((g) => g.id === gid)) setGid(mine[0]?.id ?? "");
  }, [mine, gid]);

  const people = useMemo(() => {
    const ids = new Set(groupMembers.filter((g) => g.group_id === gid).map((g) => g.membership_id));
    return members.filter((m) => ids.has(m.id) && m.active && m.role !== "owner");
  }, [members, groupMembers, gid]);
  const peopleIds = useMemo(() => people.map((p) => p.id), [people]);

  const load = useCallback(async () => {
    if (!org || !gid) return;
    const [ty, s] = await Promise.all([
      supabase.from("shift_types").select("*").eq("org_id", org.id).order("start_time"),
      supabase.from("shifts").select("*").eq("org_id", org.id).gte("date", ws).lte("date", addDays(ws, 6)),
    ]);
    setTypes((ty.data as ShiftType[]) ?? []);
    setShifts(((s.data as Shift[]) ?? []).filter((x) => peopleIds.includes(x.membership_id)));
  }, [org, gid, ws, peopleIds]);

  useEffect(() => {
    setShifts(null);
    load();
  }, [load]);

  if (mine.length === 0) return <Alert kind="warn">Нямате групи за управление. Създайте група от „Хора → Групи“.</Alert>;

  const list = shifts ?? [];
  const drafts = list.filter((s) => !s.published);
  const weekPublished = list.length > 0 && drafts.length === 0;
  const mins = (id: string) => list.filter((s) => s.membership_id === id && s.kind === "work").reduce((a, s) => a + shiftMinutes(s.start_time, s.end_time, s.break_min), 0);

  async function publish() {
    setErr("");
    const { error } = await supabase.from("shifts").update({ published: true }).in("id", drafts.map((d) => d.id));
    if (error) return setErr(errMsg(error));
    setInfo(`Публикувани са ${drafts.length} смени – служителите вече ги виждат.`);
    await load();
  }
  async function copyPrev() {
    if (!org) return;
    setErr("");
    const { data, error } = await supabase.from("shifts").select("*").eq("org_id", org.id).gte("date", addDays(ws, -7)).lte("date", addDays(ws, -1));
    if (error) return setErr(errMsg(error));
    const prev = ((data as Shift[]) ?? []).filter((x) => peopleIds.includes(x.membership_id));
    const rows = prev
      .map((p) => ({ ...p, date: addDays(p.date, 7) }))
      .filter((p) => !list.some((x) => x.membership_id === p.membership_id && x.date === p.date))
      .map((p) => ({
        org_id: org.id, membership_id: p.membership_id, group_id: gid, date: p.date, kind: p.kind, shift_type_id: p.shift_type_id,
        start_time: p.start_time, end_time: p.end_time, break_min: p.break_min, note: p.note, published: false,
      }));
    if (rows.length === 0) return setInfo("Няма какво да се копира (миналата седмица е празна или вече е попълнено).");
    const { error: e2 } = await supabase.from("shifts").insert(rows);
    if (e2) return setErr(errMsg(e2));
    setInfo(`Копирани са ${rows.length} смени като чернова. Прегледайте и публикувайте.`);
    await load();
  }

  return (
    <div className="stack">
      <div className="row between wrap">
        <h1>График</h1>
        <button className="btn small" onClick={() => setTypesOpen(true)}>
          Типове смени
        </button>
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <select style={{ width: "auto", flex: 1, minWidth: 160 }} value={gid} onChange={(e) => setGid(e.target.value)} aria-label="Група">
          {mine.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className="daynav">
        <button className="btn small" onClick={() => setWs(addDays(ws, -7))} aria-label="Предишна седмица">
          ‹
        </button>
        <div className="label-date">{fmtWeek(ws)}</div>
        <button className="btn small" onClick={() => setWs(addDays(ws, 7))} aria-label="Следваща седмица">
          ›
        </button>
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        {ws !== weekStart(today) && (
          <button className="btn small ghost" onClick={() => setWs(weekStart(today))}>
            Към тази седмица
          </button>
        )}
        <button className="btn small" onClick={copyPrev}>
          ⧉ Копирай миналата седмица
        </button>
        <button className="btn small primary" onClick={publish} disabled={drafts.length === 0}>
          {drafts.length ? `Публикувай (${drafts.length})` : weekPublished ? "✓ Публикувана" : "Публикувай"}
        </button>
      </div>
      {info && <Alert kind="ok">{info}</Alert>}
      {err && <Alert kind="bad">{err}</Alert>}

      {shifts === null ? (
        <Spinner />
      ) : people.length === 0 ? (
        <Empty icon="👥">Няма хора в тази група. Добавете ги от „Хора → Групи“.</Empty>
      ) : (
        <div className="sched">
          <table>
            <thead>
              <tr>
                <th />
                {days.map((d) => (
                  <th key={d} className={d === today ? "today" : ""}>
                    {weekdayName(parseYmd(d), "short")} {parseYmd(d).getDate()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const m = mins(p.id);
                return (
                  <tr key={p.id}>
                    <td className="who">
                      {p.display_name}
                      <small className={m > 40 * 60 ? "over" : ""}>
                        {fmtDur(m)}
                        {m > 40 * 60 ? " · над 40 ч" : ""}
                      </small>
                    </td>
                    {days.map((d) => {
                      const s = list.find((x) => x.membership_id === p.id && x.date === d);
                      const c = s ? cellText(s, types) : null;
                      return (
                        <td key={d}>
                          <button
                            className={`cell ${s ? (s.kind === "work" ? "shift" : "") : "empty"} ${s && !s.published ? "draft" : ""}`}
                            style={{ ["--c" as string]: c?.color }}
                            onClick={() => setEdit({ m: p, date: d })}
                            aria-label={`${p.display_name}, ${d}`}
                          >
                            {s ? (
                              <>
                                <span className="t">{c!.top}</span>
                                {c!.sub && <span className="h">{c!.sub}</span>}
                              </>
                            ) : (
                              "+"
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td />
                {days.map((d) => (
                  <td key={d}>{list.filter((s) => s.date === d && s.kind === "work").length} на смяна</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="muted small">Пунктираните клетки са чернова – служителите не ги виждат, докато не натиснете „Публикувай“.</p>

      {edit && (
        <ShiftModal
          m={edit.m}
          date={edit.date}
          gid={gid}
          types={types}
          existing={list.find((x) => x.membership_id === edit.m.id && x.date === edit.date)}
          prevDay={list.find((x) => x.membership_id === edit.m.id && x.date === addDays(edit.date, -1))}
          weekPublished={weekPublished}
          onClose={async (changed) => {
            setEdit(null);
            if (changed) await load();
          }}
        />
      )}
      {typesOpen && (
        <TypesModal
          types={types}
          onClose={async () => {
            setTypesOpen(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

const toMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
};

function ShiftModal({
  m, date, gid, types, existing, prevDay, weekPublished, onClose,
}: {
  m: Membership; date: string; gid: string; types: ShiftType[]; existing?: Shift; prevDay?: Shift;
  weekPublished: boolean; onClose: (changed: boolean) => void;
}) {
  const { org } = useApp();
  const first = types[0];
  const [kind, setKind] = useState<ShiftKind>(existing?.kind ?? "work");
  const [typeId, setTypeId] = useState(existing?.shift_type_id ?? (existing ? "" : first?.id ?? ""));
  const [start, setStart] = useState(hhmm(existing?.start_time ?? first?.start_time ?? "08:00"));
  const [end, setEnd] = useState(hhmm(existing?.end_time ?? first?.end_time ?? "16:00"));
  const [brk, setBrk] = useState(String(existing?.break_min ?? first?.break_min ?? 30));
  const [note, setNote] = useState(existing?.note ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function pickType(id: string) {
    setTypeId(id);
    const ty = types.find((x) => x.id === id);
    if (ty) {
      setStart(hhmm(ty.start_time));
      setEnd(hhmm(ty.end_time));
      setBrk(String(ty.break_min));
    }
  }

  // почивка по-малко от 11 ч след предишната смяна
  let warn = "";
  if (kind === "work" && prevDay?.kind === "work" && prevDay.start_time && prevDay.end_time) {
    const prevEnd = toMin(prevDay.end_time) <= toMin(prevDay.start_time) ? toMin(prevDay.end_time) : toMin(prevDay.end_time) - 1440;
    const rest = toMin(start) - prevEnd;
    if (rest < 11 * 60) warn = `Само ${fmtDur(Math.max(0, rest))} почивка след вчерашната смяна (препоръчително е поне 11 ч).`;
  }

  async function save() {
    if (!org) return;
    setErr("");
    setBusy(true);
    const row = {
      org_id: org.id, membership_id: m.id, group_id: gid, date, kind,
      shift_type_id: kind === "work" && typeId ? typeId : null,
      start_time: kind === "work" ? start : null,
      end_time: kind === "work" ? end : null,
      break_min: kind === "work" ? Math.max(0, Number(brk) || 0) : 0,
      note: note.trim() || null,
    };
    const { error } = existing
      ? await supabase.from("shifts").update(row).eq("id", existing.id)
      : await supabase.from("shifts").insert({ ...row, published: weekPublished });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    onClose(true);
  }
  async function remove() {
    if (!existing) return;
    const { error } = await supabase.from("shifts").delete().eq("id", existing.id);
    if (error) return setErr(errMsg(error));
    onClose(true);
  }

  const d = parseYmd(date);
  return (
    <Modal title={`${m.display_name} · ${weekdayName(d)} ${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}`} onClose={() => onClose(false)}>
      <div className="stack">
        <div className="seg" role="group">
          {(Object.keys(KIND_LABEL) as ShiftKind[]).map((k) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        {kind === "work" && (
          <>
            <Field label="Тип смяна">
              <select value={typeId} onChange={(e) => pickType(e.target.value)}>
                {types.map((ty) => (
                  <option key={ty.id} value={ty.id}>
                    {ty.name} ({hhmm(ty.start_time)}–{hhmm(ty.end_time)})
                  </option>
                ))}
                <option value="">Друго време…</option>
              </select>
            </Field>
            <div className="row wrap">
              <div className="field grow">
                <label>От</label>
                <input type="time" value={start} onChange={(e) => (setStart(e.target.value), setTypeId(""))} />
              </div>
              <div className="field grow">
                <label>До</label>
                <input type="time" value={end} onChange={(e) => (setEnd(e.target.value), setTypeId(""))} />
              </div>
              <div className="field" style={{ width: 110 }}>
                <label>Почивка, мин</label>
                <input type="number" min={0} value={brk} onChange={(e) => setBrk(e.target.value)} />
              </div>
            </div>
            <span className="muted small">Платени часове: {fmtDur(shiftMinutes(start, end, Number(brk) || 0))}</span>
          </>
        )}
        <Field label="Бележка (по желание)">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="напр. с ключове за склада" />
        </Field>
        {warn && <Alert kind="warn">{warn}</Alert>}
        {err && <Alert kind="bad">{err}</Alert>}
        <button className="btn primary block" onClick={save} disabled={busy}>
          Запази
        </button>
        {existing && (
          <button className="btn danger block" onClick={remove}>
            Изчисти деня
          </button>
        )}
      </div>
    </Modal>
  );
}

function TypesModal({ types, onClose }: { types: ShiftType[]; onClose: () => void }) {
  const { org } = useApp();
  const [rows, setRows] = useState<ShiftType[]>(types);
  const [err, setErr] = useState("");

  async function patch(id: string, p: Partial<ShiftType>) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const { error } = await supabase.from("shift_types").update(p).eq("id", id);
    if (error) setErr(errMsg(error));
  }
  async function add() {
    if (!org) return;
    const row = { id: uuid(), org_id: org.id, name: "Нова смяна", start_time: "08:00", end_time: "16:00", color: "#2e7d5a", break_min: 30 };
    const { data, error } = await supabase.from("shift_types").insert(row).select("*").single();
    if (error) return setErr(errMsg(error));
    setRows((r) => [...r, data as ShiftType]);
  }
  async function del(id: string) {
    if (!confirm("Да изтрия ли този тип? Вече зададените смени запазват своето време.")) return;
    const { error } = await supabase.from("shift_types").delete().eq("id", id);
    if (error) return setErr(errMsg(error));
    setRows((r) => r.filter((x) => x.id !== id));
  }

  return (
    <Modal title="Типове смени" onClose={onClose}>
      <div className="stack">
        <p className="muted small">Часове, които използвате често. Смяна, минаваща през полунощ, е с край по-малък от началото (напр. 23:00–07:00).</p>
        {rows.map((r) => (
          <div key={r.id} className="typerow">
            <input className="nm" type="text" value={r.name} onChange={(e) => setRows((x) => x.map((y) => (y.id === r.id ? { ...y, name: e.target.value } : y)))} onBlur={(e) => patch(r.id, { name: e.target.value.trim() || "Смяна" })} aria-label="Име" />
            <input type="time" value={hhmm(r.start_time)} onChange={(e) => patch(r.id, { start_time: e.target.value })} aria-label="От" />
            <input type="time" value={hhmm(r.end_time)} onChange={(e) => patch(r.id, { end_time: e.target.value })} aria-label="До" />
            <input type="number" min={0} value={r.break_min} onChange={(e) => patch(r.id, { break_min: Math.max(0, Number(e.target.value) || 0) })} aria-label="Почивка" title="Почивка, минути" />
            <button className="btn danger small" onClick={() => del(r.id)} aria-label="Изтрий">
              ✕
            </button>
          </div>
        ))}
        {err && <Alert kind="bad">{err}</Alert>}
        <button className="btn" onClick={add}>
          + Нов тип смяна
        </button>
      </div>
    </Modal>
  );
}
