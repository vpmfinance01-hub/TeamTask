import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { t } from "../lib/i18n";
import type { TaskComment } from "../lib/types";
import { errMsg, niceDateTime } from "../lib/util";
import { Alert } from "./ui";

/** Кратка кореспонденция по задача между служителя и ръководителя. */
export default function Comments({ occurrenceId }: { occurrenceId: string }) {
  const { org, me, members } = useApp();
  const [list, setList] = useState<TaskComment[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("task_comments").select("*").eq("occurrence_id", occurrenceId).order("created_at");
    setList((data as TaskComment[]) ?? []);
  }, [occurrenceId]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [list.length]);

  async function send() {
    if (!org || !me || !text.trim()) return;
    setBusy(true);
    setErr("");
    const { error } = await supabase.from("task_comments").insert({ org_id: org.id, occurrence_id: occurrenceId, author_id: me.id, body: text.trim() });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setText("");
    await load();
  }

  const name = (id: string) => members.find((m) => m.id === id)?.display_name ?? "…";

  return (
    <div className="card stack">
      <h2>
        {t("Коментари")} {list.length > 0 && <span className="muted small">({list.length})</span>}
      </h2>
      {list.length === 0 ? (
        <p className="muted small">{t("Още няма коментари. Попитайте или уведомете за нещо по задачата.")}</p>
      ) : (
        <div className="chat">
          {list.map((c) => (
            <div key={c.id} className={`bubble ${c.author_id === me?.id ? "mine" : ""}`}>
              <div className="who">
                {c.author_id === me?.id ? t("Вие") : name(c.author_id)} · {niceDateTime(c.created_at)}
              </div>
              {c.body}
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), send())}
          placeholder={t("Напишете коментар…")}
          maxLength={500}
          aria-label={t("Коментар")}
        />
        <button className="btn primary" onClick={send} disabled={busy || !text.trim()}>
          {t("Изпрати")}
        </button>
      </div>
      {err && <Alert kind="bad">{err}</Alert>}
    </div>
  );
}
