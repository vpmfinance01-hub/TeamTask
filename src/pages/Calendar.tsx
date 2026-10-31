import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { OCC_SELECT, type Occurrence, type Task } from "../lib/types";
import { addDays, errMsg, monthName, niceDate, parseYmd, taskOccursOn, weekdayName, ymd } from "../lib/util";
import { t } from "../lib/i18n";
import OccCard from "../components/OccCard";
import { Alert, Empty, Spinner, isLate } from "../components/ui";

const WEEK_ANCHOR = [5, 6, 7, 8, 9, 10, 11]; // 2026-10-05 е понеделник – за имена на дните на езика на потребителя
const weekLabel = (i: number) => weekdayName(new Date(2026, 9, WEEK_ANCHOR[i]), "short");

type StatusFilter = "all" | "todo" | "late" | "submitted" | "approved" | "rejected";
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Всички" },
  { key: "todo", label: "За изпълнение" },
  { key: "late", label: "Просрочени" },
  { key: "submitted", label: "Чакат одобрение" },
  { key: "approved", label: "Одобрени" },
  { key: "rejected", label: "Върнати" },
]; // текстовете се превеждат при показване

const monthStart = (d: string) => d.slice(0, 7) + "-01";
function shiftMonth(ms: string, n: number): string {
  const d = parseYmd(ms);
  return ymd(new Date(d.getFullYear(), d.getMonth() + n, 1));
}
/** 6 седмици (Пн–Нд), които покриват месеца. */
function gridDays(ms: string): string[] {
  const dow = (parseYmd(ms).getDay() + 6) % 7;
  const start = addDays(ms, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export default function CalendarPage() {
  const { org, me, isManager, myGroupIds, groups, members, groupMembers } = useApp();
  const today = ymd();
  const [month, setMonth] = useState(monthStart(today));
  const [selected, setSelected] = useState(today);
  const [occ, setOcc] = useState<Occurrence[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [err, setErr] = useState("");

  const [status, setStatus] = useState<StatusFilter>("all");
  const [groupF, setGroupF] = useState("");
  const [personF, setPersonF] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Occurrence[] | null>(null);
  const searching = q.trim().length >= 2;

  const days = useMemo(() => gridDays(month), [month]);

  /** Само „моите“ за служителите; ръководителите виждат всичко в обхвата си (правата ги ограничава базата). */
  const relevant = useCallback(
    (o: Occurrence) =>
      isManager || o.assignee_id === me?.id || (o.assignee_id === null && o.group_id !== null && myGroupIds.includes(o.group_id)),
    [isManager, me, myGroupIds],
  );

  const load = useCallback(async () => {
    if (!org) return;
    setErr("");
    const [a, t] = await Promise.all([
      supabase.from("occurrences").select(OCC_SELECT).eq("org_id", org.id).gte("due_date", days[0]).lte("due_date", days[41]),
      supabase.from("tasks").select("*").eq("org_id", org.id).eq("active", true),
    ]);
    if (a.error) setErr(errMsg(a.error));
    setOcc(((a.data as unknown as Occurrence[]) ?? []).filter(relevant));
    setTasks((t.data as Task[]) ?? []);
  }, [org, days, relevant]);

  useEffect(() => {
    setOcc(null);
    load();
  }, [load]);

  // като при „Днес“: при отваряне на ден от днес нататък заданията му се създават (идемпотентно)
  useEffect(() => {
    if (!org || selected < today) return;
    supabase.rpc("ensure_occurrences", { p_org: org.id, p_from: selected, p_to: selected }).then(() => load());
  }, [org, selected, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- филтри
  const personGroups = useMemo(() => {
    if (!personF) return null;
    return new Set(groupMembers.filter((g) => g.membership_id === personF).map((g) => g.group_id));
  }, [personF, groupMembers]);

  const passes = useCallback(
    (o: Occurrence) => {
      if (groupF && o.group_id !== groupF) return false;
      if (personF && (o.assignee_id ?? o.completed_by) !== personF && !(o.assignee_id === null && o.group_id && personGroups?.has(o.group_id)))
        return false;
      switch (status) {
        case "todo":
          return o.status === "pending" || o.status === "rejected";
        case "late":
          return isLate(o);
        case "all":
          return true;
        default:
          return o.status === status;
      }
    },
    [groupF, personF, personGroups, status],
  );

  // ---------- данни за мрежата
  const byDay = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    for (const o of occ ?? []) if (passes(o)) m.set(o.due_date, [...(m.get(o.due_date) ?? []), o]);
    return m;
  }, [occ, passes]);

  const hasAny = useMemo(() => new Set((occ ?? []).map((o) => o.due_date)), [occ]);

  /** Планирани задачи за бъдещи дни, за които още няма създадени задания. */
  const planned = useCallback(
    (d: string): number => {
      if (d <= today || hasAny.has(d)) return 0;
      return tasks.filter((t) => {
        if (!taskOccursOn(t, d)) return false;
        if (!isManager && !(t.assignee_id === me?.id || (t.group_id && myGroupIds.includes(t.group_id)))) return false;
        if (groupF && t.group_id !== groupF) return false;
        if (personF && t.assignee_id !== personF && !(t.assignee_id === null && t.group_id && personGroups?.has(t.group_id))) return false;
        return status === "all" || status === "todo";
      }).length;
    },
    [today, hasAny, tasks, isManager, me, myGroupIds, groupF, personF, personGroups, status],
  );

  const dayItems = (byDay.get(selected) ?? []).slice().sort((a, b) => a.status.localeCompare(b.status) || (a.tasks.due_time ?? "99").localeCompare(b.tasks.due_time ?? "99"));

  // ---------- търсене
  useEffect(() => {
    if (!searching || !org) return;
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("occurrences")
        .select(OCC_SELECT)
        .eq("org_id", org.id)
        .gte("due_date", addDays(today, -180))
        .lte("due_date", addDays(today, 30));
      if (!alive) return;
      if (error) setErr(errMsg(error));
      setFound(((data as unknown as Occurrence[]) ?? []).filter(relevant));
    })();
    return () => {
      alive = false;
    };
  }, [searching, org, today, relevant]);

  const results = useMemo(() => {
    if (!searching || !found) return null;
    const needle = q.trim().toLowerCase();
    return found
      .filter(passes)
      .filter((o) =>
        [o.tasks.title, o.tasks.description, o.groups?.name, o.assignee?.display_name, o.completer?.display_name, o.note, o.review_comment]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
      .sort((a, b) => b.due_date.localeCompare(a.due_date))
      .slice(0, 150);
  }, [searching, found, q, passes]);

  const byDate = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    for (const o of results ?? []) m.set(o.due_date, [...(m.get(o.due_date) ?? []), o]);
    return m;
  }, [results]);

  function jump(d: string) {
    setQ("");
    setSelected(d);
    setMonth(monthStart(d));
  }

  const activeMembers = members.filter((m) => m.active);
  const filtersOn = Boolean(groupF || personF || status !== "all");

  return (
    <div className="stack">
      <div className="row between">
        <h1>{t("Календар")}</h1>
        <button className="btn small" onClick={() => jump(today)}>
          {t("Днес")}
        </button>
      </div>

      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Търси задача, човек, група или бележка…")} aria-label={t("Търсене")} />

      <div className="row wrap" style={{ gap: 8 }}>
        {isManager && (
          <>
            <select style={{ width: "auto", flex: 1, minWidth: 130 }} value={groupF} onChange={(e) => setGroupF(e.target.value)} aria-label="Група">
              <option value="">Всички групи</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select style={{ width: "auto", flex: 1, minWidth: 130 }} value={personF} onChange={(e) => setPersonF(e.target.value)} aria-label="Човек">
              <option value="">Всички хора</option>
              {activeMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <div className="tabs">
        {STATUS_FILTERS.map((s) => (
          <button key={s.key} className={`tab ${status === s.key ? "active" : ""}`} onClick={() => setStatus(s.key)}>
            {t(s.label)}
          </button>
        ))}
      </div>
      {err && <Alert kind="bad">{err}</Alert>}

      {searching ? (
        <div className="stack">
          <div className="section-title" style={{ margin: "4px 0 0" }}>
            {t("Резултати")}
            {results ? ` (${results.length}${results.length === 150 ? "+" : ""})` : ""} · {t("последните 6 месеца и следващите 30 дни")}
          </div>
          {results === null ? (
            <Spinner />
          ) : results.length === 0 ? (
            <Empty icon="🔎">{t("Нищо не е намерено за „{q}“.", { q: q.trim() })}</Empty>
          ) : (
            [...byDate.entries()].map(([d, items]) => (
              <div key={d} className="stack">
                <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => jump(d)}>
                  📅 {niceDate(d)}
                </button>
                {items.map((o) => (
                  <OccCard key={o.id} o={o} showWho />
                ))}
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="card stack">
            <div className="daynav">
              <button className="btn small" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("Предишен месец")}>
                ‹
              </button>
              <div className="label-date">
                {monthName(parseYmd(month).getMonth()).replace(/^./, (c) => c.toUpperCase())} {parseYmd(month).getFullYear()}
              </div>
              <button className="btn small" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t("Следващ месец")}>
                ›
              </button>
            </div>
            <div className="cal" role="grid" aria-label={t("Календар")}>
              {WEEK_ANCHOR.map((_, i) => (
                <div key={i} className="wd">
                  {weekLabel(i)}
                </div>
              ))}
              {days.map((d) => {
                const items = byDay.get(d) ?? [];
                const plan = planned(d);
                const counts = {
                  approved: items.filter((o) => o.status === "approved").length,
                  submitted: items.filter((o) => o.status === "submitted").length,
                  rejected: items.filter((o) => o.status === "rejected").length,
                  late: items.filter((o) => isLate(o)).length,
                  pending: items.filter((o) => o.status === "pending" && !isLate(o)).length,
                };
                const kinds = (Object.keys(counts) as (keyof typeof counts)[]).filter((k) => counts[k] > 0);
                const total = items.length + plan;
                return (
                  <button
                    key={d}
                    type="button"
                    className={`day ${d.slice(0, 7) !== month.slice(0, 7) ? "out" : ""} ${d === today ? "today" : ""} ${d === selected ? "sel" : ""}`}
                    onClick={() => setSelected(d)}
                    aria-label={`${niceDate(d)}${total ? `: ${t("{n} задачи", { n: total })}` : ""}`}
                    aria-pressed={d === selected}
                  >
                    <span>{parseYmd(d).getDate()}</span>
                    <span className="dots">
                      {kinds.map((k) => (
                        <i key={k} className={`cdot ${k}`} />
                      ))}
                      {plan > 0 && <i className="cdot planned" />}
                    </span>
                    {total > 0 && <span className="cnt">{total}</span>}
                  </button>
                );
              })}
            </div>
            <div className="row wrap small muted" style={{ gap: 12 }}>
              <span className="row" style={{ gap: 4 }}><i className="cdot pending" /> {t("за изпълнение")}</span>
              <span className="row" style={{ gap: 4 }}><i className="cdot submitted" /> {t("чака одобрение")}</span>
              <span className="row" style={{ gap: 4 }}><i className="cdot approved" /> {t("одобрено")}</span>
              <span className="row" style={{ gap: 4 }}><i className="cdot late" /> {t("просрочено/върнато")}</span>
              <span className="row" style={{ gap: 4 }}><i className="cdot planned" /> {t("планирано")}</span>
            </div>
          </div>

          <div className="row between">
            <h2>{niceDate(selected)}</h2>
            {isManager && (
              <Link className="btn small" to="/tasks/new">
                + Нова задача
              </Link>
            )}
          </div>
          {occ === null ? (
            <Spinner />
          ) : dayItems.length === 0 ? (
            <Empty icon="🌤️">{filtersOn ? t("Няма задачи за този ден при избраните филтри.") : t("Няма задачи за този ден.")}</Empty>
          ) : (
            <div className="stack">
              {dayItems.map((o) => (
                <OccCard key={o.id} o={o} showWho={isManager} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
