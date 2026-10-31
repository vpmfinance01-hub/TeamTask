import { useCallback, useEffect, useState } from "react";
import { useApp } from "../lib/session";
import { t } from "../lib/i18n";
import { flushQueue, QUEUE_EVENT, queuedList } from "../lib/offline";
import { Alert } from "./ui";

/** Лента: „Няма връзка“ / „Чакат изпращане“ – само ако работодателят е включил модула. Изпраща сама при връзка. */
export default function OfflineBar() {
  const { perm } = useApp();
  const [online, setOnline] = useState(navigator.onLine);
  const [count, setCount] = useState(0);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    try {
      setCount((await queuedList()).length);
    } catch {
      setCount(0);
    }
  }, []);

  const flush = useCallback(async () => {
    const r = await flushQueue();
    if (r.sent) setMsg(t("Изпратени са {n} чакащи задачи.", { n: r.sent }));
    if (r.rejected.length) setMsg(t("Сървърът отказа: {title}", { title: r.rejected[0].title }));
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!perm.offline) return;
    const up = () => {
      setOnline(true);
      flush();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener(QUEUE_EVENT, refresh);
    refresh();
    flush();
    const timer = window.setInterval(() => navigator.onLine && flush(), 20_000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.removeEventListener(QUEUE_EVENT, refresh);
      window.clearInterval(timer);
    };
  }, [perm.offline, flush, refresh]);

  if (!perm.offline) return null;
  if (online && count === 0 && !msg) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      {!online ? (
        <Alert kind="warn">
          <b>{t("Няма връзка.")}</b> {t("Изпълнените задачи се пазят в телефона и ще се изпратят сами, щом има интернет.")}
          {count > 0 && ` ${t("Чакат изпращане: {n}.", { n: count })}`}
        </Alert>
      ) : count > 0 ? (
        <Alert kind="info">
          {t("Чакат изпращане: {n}.", { n: count })}{" "}
          <button className="btn small" onClick={flush}>
            {t("Изпрати сега")}
          </button>
        </Alert>
      ) : (
        <Alert kind="ok">{msg}</Alert>
      )}
    </div>
  );
}
