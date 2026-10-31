import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { useApp } from "./session";
import { ymd } from "./util";
import { t as tr } from "./i18n";

export interface Toast {
  key: string;
  title: string;
  body: string;
  to: string;
}

export const REFRESH_EVENT = "teamtasks:refresh";

/** Системно известие (когато е разрешено) – през service worker, за да работи и на телефон. */
async function systemNotify(t: Toast) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const opts = { body: t.body, icon: "/pwa-192.png", badge: "/pwa-192.png", tag: t.key, data: { url: t.to } };
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(t.title, opts);
    else new Notification(t.title, opts);
  } catch {
    /* известията са по желание */
  }
}

export type NotifState = "default" | "granted" | "denied" | "unsupported";

export function notificationState(): NotifState {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Трябва да се вика от клик на потребителя (иначе браузърът не пита). */
export async function enableNotifications(): Promise<NotifState> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return notificationState();
  }
}

interface Mini {
  id: string;
  status: string;
  assignee_id: string | null;
  group_id: string | null;
  tasks: { title: string } | null;
}

/**
 * Следи за нови задачи (служител) и за чакащи одобрение (ръководител).
 * Проверява на 15 сек., при връщане във фокус и при промяна от друг раздел.
 * При новост: известие + сигнал към екраните да се опреснят.
 */
export function useWatcher(): { toast: Toast | null; dismiss: () => void; pending: number } {
  const { org, me, isManager, myGroupIds } = useApp();
  const [toast, setToast] = useState<Toast | null>(null);
  const [pending, setPending] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const lastPending = useRef<number | null>(null);
  const timer = useRef<number>();

  const show = useCallback((t: Toast) => {
    setToast(t);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 9000);
    systemNotify(t);
  }, []);

  useEffect(() => {
    if (!org || !me) return;
    seen.current = null;
    lastPending.current = null;
    let alive = true;
    let lastDay = "";

    const poll = async () => {
      const today = ymd();
      if (today !== lastDay) {
        // нов ден – създаваме повтарящите се задачи
        lastDay = today;
        await supabase.rpc("ensure_occurrences", { p_org: org.id, p_from: today, p_to: today });
      }

      // 1) мои задачи за днес (нови или върнати)
      const mine = await supabase
        .from("occurrences")
        .select("id, status, assignee_id, group_id, tasks(title)")
        .eq("org_id", org.id)
        .eq("due_date", today)
        .in("status", ["pending", "rejected"])
        .or(`assignee_id.eq.${me.id},assignee_id.is.null`);
      if (!alive) return;
      const rows = ((mine.data as unknown as Mini[]) ?? []).filter(
        (o) => o.assignee_id === me.id || (o.assignee_id === null && o.group_id !== null && myGroupIds.includes(o.group_id)),
      );
      const keys = new Set(rows.map((o) => `${o.id}:${o.status}`));
      if (seen.current === null) {
        seen.current = keys; // първото зареждане – без известия
      } else {
        const fresh = rows.filter((o) => !seen.current!.has(`${o.id}:${o.status}`));
        if (fresh.length) {
          const f = fresh[0];
          const back = f.status === "rejected";
          show({
            key: `${f.id}:${f.status}`,
            title: back ? `↩ ${tr("Задача е върната")}` : fresh.length > 1 ? `🔔 ${tr("{n} нови задачи", { n: fresh.length })}` : `🔔 ${tr("Нова задача")}`,
            body: fresh.length > 1 ? fresh.map((x) => x.tasks?.title).join(", ") : f.tasks?.title ?? "",
            to: fresh.length > 1 ? "/" : `/o/${f.id}`,
          });
          window.dispatchEvent(new Event(REFRESH_EVENT));
        }
        seen.current = keys;
      }

      // 2) за ръководители: чакащи одобрение
      if (isManager) {
        const { count } = await supabase
          .from("occurrences")
          .select("id", { count: "exact", head: true })
          .eq("org_id", org.id)
          .eq("status", "submitted");
        if (!alive) return;
        const n = count ?? 0;
        setPending(n);
        if (lastPending.current !== null && n > lastPending.current) {
          show({ key: `review:${n}`, title: "🔔 Нова задача за одобрение", body: `Чакат одобрение: ${n}`, to: "/review" });
          window.dispatchEvent(new Event(REFRESH_EVENT));
        }
        lastPending.current = n;
      }
    };

    poll();
    const t = window.setInterval(poll, 15_000);
    const onVis = () => document.visibilityState === "visible" && poll();
    window.addEventListener("focus", poll);
    window.addEventListener("storage", poll); // демо: промяна от друг раздел
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      window.clearInterval(t);
      window.removeEventListener("focus", poll);
      window.removeEventListener("storage", poll);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [org, me, isManager, myGroupIds, show]);

  return { toast, dismiss: () => setToast(null), pending };
}
