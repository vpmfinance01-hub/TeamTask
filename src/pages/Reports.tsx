import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { OCC_SELECT, type Occurrence } from "../lib/types";
import { addDays, errMsg, niceDate, statusLabel, ymd } from "../lib/util";
import { Alert, Empty, Field, Spinner } from "../components/ui";

interface Agg {
  name: string;
  total: number;
  done: number;
  approved: number;
  rejected: number;
  late: number;
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const who = (o: Occurrence) => (o.completer ?? o.assignee)?.display_name ?? "— (по група)";
const wasLate = (o: Occurrence) => Boolean(o.completed_at) && ymd(new Date(o.completed_at!)) > o.due_date;

/** Отчети по период, група и човек + износ в CSV и печат. */
export default function Reports() {
  const { org, groups } = useApp();
  const [from, setFrom] = useState(addDays(ymd(), -29));
  const [to, setTo] = useState(ymd());
  const [groupId, setGroupId] = useState("");
  const [person, setPerson] = useState("");
  const [rows, setRows] = useState<Occurrence[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!org) return;
    setRows(null);
    const f = from < addDays(to, -92) ? addDays(to, -92) : from; // най-много ~3 месеца
    supabase
      .from("occurrences")
      .select(OCC_SELECT)
      .eq("org_id", org.id)
      .gte("due_date", f)
      .lte("due_date", to)
      .order("due_date", { ascending: false })
      .then(({ data, error }) => {
        if (error) setErr(errMsg(error));
        setRows((data as unknown as Occurrence[]) ?? []);
      });
  }, [org, from, to]);

  const filtered = useMemo(
    () => (rows ?? []).filter((o) => (!groupId || o.group_id === groupId) && (!person || who(o) === person)),
    [rows, groupId, person],
  );
  const people = useMemo(() => Array.from(new Set((rows ?? []).map(who))).sort(), [rows]);

  const agg = (key: (o: Occurrence) => string): Agg[] => {
    const m = new Map<string, Agg>();
    for (const o of filtered) {
      const k = key(o);
      const a = m.get(k) ?? { name: k, total: 0, done: 0, approved: 0, rejected: 0, late: 0 };
      a.total++;
      if (o.status === "submitted" || o.status === "approved") a.done++;
      if (o.status === "approved") a.approved++;
      if (o.status === "rejected") a.rejected++;
      if (wasLate(o)) a.late++;
      m.set(k, a);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };
  const byPerson = agg(who);
  const byTask = agg((o) => o.tasks.title);

  const total = filtered.length;
  const done = filtered.filter((o) => o.status === "submitted" || o.status === "approved").length;
  const rejected = filtered.filter((o) => o.status === "rejected").length;
  const late = filtered.filter(wasLate).length;
  const waits = filtered
    .filter((o) => o.status === "approved" && o.completed_at && o.reviewed_at)
    .map((o) => Math.max(0, new Date(o.reviewed_at!).getTime() - new Date(o.completed_at!).getTime()) / 36e5);
  const avgWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;

  function csv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head = ["Дата", "Задача", "Група", "Изпълнител", "Статус", "Закъсняла", "Изпълнена", "Одобрена"];
    const lines = filtered.map((o) =>
      [o.due_date, o.tasks.title, o.groups?.name ?? "", who(o), statusLabel(o.status), wasLate(o) ? "да" : "", o.completed_at ?? "", o.reviewed_at ?? ""].map(esc).join(";"),
    );
    const blob = new Blob(["﻿" + [head.map(esc).join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `otchet-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const table = (title: string, list: Agg[]) => (
    <div className="card stack">
      <h2>{title}</h2>
      <div className="tswrap">
        <table className="ts">
          <thead>
            <tr><th>{title.includes("човек") ? "Човек" : "Задача"}</th><th className="num">Общо</th><th className="num">Изпълнени</th><th className="num">Върнати</th><th className="num">Закъснели</th><th>Изпълнение</th></tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.name}>
                <td>{a.name}</td>
                <td className="num">{a.total}</td>
                <td className="num">{a.done}</td>
                <td className="num">{a.rejected}</td>
                <td className={`num ${a.late ? "neg" : ""}`}>{a.late}</td>
                <td><div className="bar ok"><i style={{ width: `${pct(a.done, a.total)}%` }} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="stack">
      <div className="row between no-print">
        <h1>Отчети</h1>
        <div className="row">
          <button className="btn small" onClick={csv} disabled={!filtered.length}>⬇ CSV (Excel)</button>
          <button className="btn small" onClick={() => window.print()}>🖨 Печат / PDF</button>
        </div>
      </div>
      <div className="card no-print">
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label="От"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="До"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Група">
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Всички</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <Field label="Човек">
            <select value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Всички</option>
              {people.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <p className="muted small">{niceDate(from)} – {niceDate(to)} (до 3 месеца назад)</p>
      {err && <Alert kind="bad">{err}</Alert>}
      {rows === null ? (
        <Spinner />
      ) : total === 0 ? (
        <Empty icon="📊">Няма задачи за избрания период.</Empty>
      ) : (
        <>
          <div className="stats">
            <div className="stat"><div className="k">Задачи</div><div className="v">{total}</div></div>
            <div className="stat"><div className="k">Изпълнени</div><div className="v pos">{pct(done, total)}%</div></div>
            <div className="stat"><div className="k">Върнати</div><div className={`v ${rejected ? "neg" : ""}`}>{pct(rejected, total)}%</div></div>
            <div className="stat"><div className="k">Закъснели</div><div className={`v ${late ? "neg" : ""}`}>{late}</div></div>
            <div className="stat"><div className="k">Средно до одобрение</div><div className="v">{avgWait ? `${avgWait.toFixed(1)} ч` : "—"}</div></div>
          </div>
          {table("По човек", byPerson)}
          {table("По задача", byTask)}
        </>
      )}
    </div>
  );
}
