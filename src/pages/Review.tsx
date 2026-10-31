import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { OCC_SELECT, type Occurrence } from "../lib/types";
import { errMsg } from "../lib/util";
import OccCard from "../components/OccCard";
import { Alert, Empty, Spinner } from "../components/ui";

/** Опашка с изпълнени задачи, чакащи потвърждение. */
export default function Review() {
  const { org } = useApp();
  const [list, setList] = useState<Occurrence[] | null>(null);
  const [err, setErr] = useState("");

  const load = () => {
    if (!org) return;
    supabase
      .from("occurrences")
      .select(OCC_SELECT)
      .eq("org_id", org.id)
      .eq("status", "submitted")
      .order("completed_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) setErr(errMsg(error));
        setList((data as unknown as Occurrence[]) ?? []);
      });
  };
  useEffect(load, [org]); // eslint-disable-line react-hooks/exhaustive-deps

  if (list === null) return <Spinner />;
  return (
    <div className="stack">
      <h1>За одобрение</h1>
      {err && <Alert kind="bad">{err}</Alert>}
      {list.length === 0 ? (
        <Empty icon="🎉">Няма задачи, които чакат одобрение.</Empty>
      ) : (
        list.map((o) => <OccCard key={o.id} o={o} showWho showDate />)
      )}
    </div>
  );
}
