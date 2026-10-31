import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { confetti } from "../lib/fx";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { REFRESH_EVENT } from "../lib/watch";
import { OCC_SELECT, type Occurrence } from "../lib/types";
import { addDays, errMsg, niceDate, ymd } from "../lib/util";
import OccCard from "../components/OccCard";
import { Alert, Empty, ProgressRing, Spinner } from "../components/ui";
import Welcome from "../components/Welcome";
import ClockCard from "../components/ClockCard";
import { t } from "../lib/i18n";

export default function Today() {
  const { org, me, myGroupIds, perm } = useApp();
  const [date, setDate] = useState(ymd());
  const [list, setList] = useState<Occurrence[] | null>(null);
  const [overdue, setOverdue] = useState<Occurrence[]>([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!org || !me) return;
    setErr("");
    const gen = await supabase.rpc("ensure_occurrences", { p_org: org.id, p_from: date, p_to: date });
    if (gen.error) setErr(errMsg(gen.error));

    const mine = (o: Occurrence) =>
      o.assignee_id === me.id || (o.assignee_id === null && o.group_id !== null && myGroupIds.includes(o.group_id));

    const day = await supabase
      .from("occurrences")
      .select(OCC_SELECT)
      .eq("org_id", org.id)
      .eq("due_date", date)
      .or(`assignee_id.eq.${me.id},assignee_id.is.null`);
    if (day.error) setErr(errMsg(day.error));
    setList(((day.data as unknown as Occurrence[]) ?? []).filter(mine));

    if (date === ymd()) {
      const late = await supabase
        .from("occurrences")
        .select(OCC_SELECT)
        .eq("org_id", org.id)
        .eq("assignee_id", me.id)
        .lt("due_date", date)
        .in("status", ["pending", "rejected"])
        .gte("due_date", addDays(date, -30))
        .order("due_date", { ascending: false });
      setOverdue((late.data as unknown as Occurrence[]) ?? []);
    } else {
      setOverdue([]);
    }
  }, [org, me, date, myGroupIds]);

  useEffect(() => {
    setList(null);
    load();
  }, [load]);

  // нова/върната задача (сигнал от watcher-а) – опресняваме списъка без презареждане
  useEffect(() => {
    window.addEventListener(REFRESH_EVENT, load);
    return () => window.removeEventListener(REFRESH_EVENT, load);
  }, [load]);

  // обновяване при връщане в приложението
  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  const rank = (o: Occurrence) => (o.status === "rejected" ? 0 : 1) * 10 - o.tasks.priority;
  const todo = (list ?? [])
    .filter((o) => o.status === "pending" || o.status === "rejected")
    .sort((a, b) => rank(a) - rank(b) || (a.tasks.due_time ?? "99").localeCompare(b.tasks.due_time ?? "99"));
  const waiting = (list ?? []).filter((o) => o.status === "submitted");
  const done = (list ?? []).filter((o) => o.status === "approved");
  const total = (list ?? []).length;

  // когато последната задача за деня бъде изпълнена – малко празнуване
  const prevTodo = useRef<number | null>(null);
  useEffect(() => {
    if (list === null) {
      prevTodo.current = null;
      return;
    }
    if (prevTodo.current !== null && prevTodo.current > 0 && todo.length === 0 && total > 0 && date === ymd()) confetti();
    prevTodo.current = todo.length;
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack">
      <div className="daynav">
        <button className="btn small" onClick={() => setDate(addDays(date, -1))} aria-label={t("Предишен ден")}>
          ‹
        </button>
        <div className="label-date">{niceDate(date)}</div>
        <button className="btn small" onClick={() => setDate(addDays(date, 1))} aria-label={t("Следващ ден")}>
          ›
        </button>
      </div>
      {date !== ymd() && (
        <button className="btn small ghost" onClick={() => setDate(ymd())}>
          {t("Към днес")}
        </button>
      )}
      {err && <Alert kind="bad">{err}</Alert>}
      {perm.qr && (
        <Link className="btn" to="/scan" style={{ alignSelf: "flex-start" }}>
          📍 {t("Сканирай QR код")}
        </Link>
      )}
      {perm.clock && date === ymd() && <ClockCard />}
      {list !== null && <Welcome todayCount={date === ymd() ? list.length : 0} />}
      {list === null ? (
        <Spinner />
      ) : (
        <>
          {total > 0 && (
            <div className="card summary">
              <ProgressRing ok={done.length} wait={waiting.length} total={total} />
              <div className="grow stack" style={{ gap: 8 }}>
                <div className="label">{t("Изпълнени днес")}</div>
                <div className="num">
                  {done.length + waiting.length}
                  <small>{t("от {total}", { total })}</small>
                </div>
                {todo.length === 0 ? (
                  <span className="chip approved">{t("Всичко е готово")} 🎉</span>
                ) : (
                  <span className="chip pending">{t("Остават {n}", { n: todo.length })}</span>
                )}
              </div>
            </div>
          )}

          {overdue.length > 0 && (
            <>
              <div className="section-title" style={{ color: "var(--bad)" }}>
                {t("Просрочени")} ({overdue.length})
              </div>
              {overdue.map((o) => (
                <OccCard key={o.id} o={o} showDate />
              ))}
            </>
          )}

          {todo.length > 0 && (
            <>
              <div className="section-title">
                {t("За изпълнение")} ({todo.length})
              </div>
              {todo.map((o) => (
                <OccCard key={o.id} o={o} />
              ))}
            </>
          )}
          {waiting.length > 0 && (
            <>
              <div className="section-title">
                {t("Чакат одобрение")} ({waiting.length})
              </div>
              {waiting.map((o) => (
                <OccCard key={o.id} o={o} />
              ))}
            </>
          )}
          {done.length > 0 && (
            <>
              <div className="section-title">
                {t("Одобрени")} ({done.length})
              </div>
              {done.map((o) => (
                <OccCard key={o.id} o={o} />
              ))}
            </>
          )}
          {total === 0 && overdue.length === 0 && <Empty icon="🌤️">{t("Няма задачи за този ден.")}</Empty>}
        </>
      )}
    </div>
  );
}
