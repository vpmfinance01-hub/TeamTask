import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { OCC_SELECT, type Occurrence } from "../lib/types";
import { addDays, errMsg, niceDate, ymd } from "../lib/util";
import OccCard from "../components/OccCard";
import { Alert, Empty, Spinner } from "../components/ui";
import { t } from "../lib/i18n";

/** Моята история за последните 30 дни. */
export default function History() {
  const { org, me } = useApp();
  const [list, setList] = useState<Occurrence[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!org || !me) return;
    supabase
      .from("occurrences")
      .select(OCC_SELECT)
      .eq("org_id", org.id)
      .eq("assignee_id", me.id)
      .lte("due_date", ymd())
      .gte("due_date", addDays(ymd(), -30))
      .order("due_date", { ascending: false })
      .then(({ data, error }) => {
        if (error) setErr(errMsg(error));
        setList((data as unknown as Occurrence[]) ?? []);
      });
  }, [org, me]);

  if (list === null) return <Spinner />;
  const byDate = new Map<string, Occurrence[]>();
  for (const o of list) byDate.set(o.due_date, [...(byDate.get(o.due_date) ?? []), o]);

  return (
    <div className="stack">
      <h1>{t("История")}</h1>
      {err && <Alert kind="bad">{err}</Alert>}
      {list.length === 0 && <Empty icon="🗂️">{t("Все още няма история.")}</Empty>}
      {[...byDate.entries()].map(([d, items]) => (
        <div key={d} className="stack">
          <div className="section-title" style={{ margin: "8px 0 0" }}>
            {niceDate(d)}
          </div>
          {items.map((o) => (
            <OccCard key={o.id} o={o} />
          ))}
        </div>
      ))}
    </div>
  );
}
