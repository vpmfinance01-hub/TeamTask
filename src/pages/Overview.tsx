import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { OCC_SELECT, type Occurrence } from "../lib/types";
import { addDays, errMsg, niceDate, ymd } from "../lib/util";
import OccCard from "../components/OccCard";
import { Alert, Empty, Progress, Spinner } from "../components/ui";

/** Ръководителят вижда как върви денят по групи. */
export default function Overview() {
  const { org, groups } = useApp();
  const [date, setDate] = useState(ymd());
  const [list, setList] = useState<Occurrence[] | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!org) return;
    let alive = true;
    setList(null);
    (async () => {
      await supabase.rpc("ensure_occurrences", { p_org: org.id, p_from: date, p_to: date });
      const { data, error } = await supabase.from("occurrences").select(OCC_SELECT).eq("org_id", org.id).eq("due_date", date);
      if (!alive) return;
      if (error) setErr(errMsg(error));
      setList((data as unknown as Occurrence[]) ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [org, date]);

  const byGroup = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    for (const o of list ?? []) {
      const key = o.group_id ?? "none";
      m.set(key, [...(m.get(key) ?? []), o]);
    }
    return m;
  }, [list]);

  if (!org) return null;
  const keys = [...byGroup.keys()].filter((k) => filter === "all" || k === filter);
  const name = (k: string) => groups.find((g) => g.id === k)?.name ?? "Без група";
  const color = (k: string) => groups.find((g) => g.id === k)?.color ?? "#94a3b8";

  const all = list ?? [];
  const approved = all.filter((o) => o.status === "approved").length;
  const waiting = all.filter((o) => o.status === "submitted").length;

  return (
    <div className="stack">
      <h1>Преглед</h1>
      <div className="daynav">
        <button className="btn small" onClick={() => setDate(addDays(date, -1))} aria-label="Предишен ден">
          ‹
        </button>
        <div className="label-date">{niceDate(date)}</div>
        <button className="btn small" onClick={() => setDate(addDays(date, 1))} aria-label="Следващ ден">
          ›
        </button>
      </div>
      {err && <Alert kind="bad">{err}</Alert>}
      {list === null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty icon="🌤️">Няма задачи за този ден. Добавете ги от „Задачи“.</Empty>
      ) : (
        <>
          <div className="card stack">
            <div className="row between">
              <b>Общо</b>
              <span className="muted small">
                {approved} одобрени · {waiting} чакат · {all.length - approved - waiting} за изпълнение
              </span>
            </div>
            <Progress ok={approved} wait={waiting} total={all.length} />
          </div>
          <div className="tabs">
            <button className={`tab ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
              Всички
            </button>
            {[...byGroup.keys()].map((k) => (
              <button key={k} className={`tab ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>
                {name(k)}
              </button>
            ))}
          </div>
          {keys.map((k) => {
            const items = byGroup.get(k)!;
            const ok = items.filter((o) => o.status === "approved").length;
            const wt = items.filter((o) => o.status === "submitted").length;
            return (
              <div key={k} className="stack">
                <div className="row between" style={{ marginTop: 8 }}>
                  <h2 className="row" style={{ gap: 8 }}>
                    <i className="dot" style={{ background: color(k) }} />
                    {name(k)}
                  </h2>
                  <span className="muted small">
                    {ok}/{items.length}
                  </span>
                </div>
                <Progress ok={ok} wait={wt} total={items.length} />
                {items
                  .sort((a, b) => a.status.localeCompare(b.status))
                  .map((o) => (
                    <OccCard key={o.id} o={o} showWho />
                  ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
