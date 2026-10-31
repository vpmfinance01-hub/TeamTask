import { useState } from "react";
import { useApp } from "../lib/session";
import { roleLabel } from "../lib/util";
import { t } from "../lib/i18n";
import { enableNotifications, notificationState } from "../lib/watch";

/** Съобщение при първото отваряне: кой си, как се влиза и как да получаваш известия. */
export default function Welcome({ todayCount }: { todayCount: number }) {
  const { me, org, session, groups, myGroupIds } = useApp();
  const key = me ? `teamtasks.welcome.${me.id}` : "";
  const [open, setOpen] = useState(() => {
    try {
      return Boolean(key) && !localStorage.getItem(key);
    } catch {
      return false;
    }
  });
  const [perm, setPerm] = useState(notificationState());
  if (!open || !me || !org) return null;

  const close = () => {
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };
  const mine = groups.filter((g) => myGroupIds.includes(g.id)).map((g) => g.name);

  return (
    <div className="card stack" style={{ borderColor: "var(--primary)" }}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <h2>👋 {t("Добре дошли, {name}!", { name: me.display_name.split(" ")[0] })}</h2>
        <button className="btn ghost small" onClick={close} aria-label={t("Затвори")}>
          ✕
        </button>
      </div>
      <p>
        {t("Имате достъп до {org} като {role}.", { org: org.name, role: roleLabel(me.role).toLowerCase() })}
        {mine.length > 0 && ` ${t("Групи: {list}.", { list: mine.join(", ") })}`}{" "}
        {todayCount === 0 ? t("За днес още няма задачи.") : todayCount === 1 ? t("Днес имате 1 задача.") : t("Днес имате {n} задачи.", { n: todayCount })}
      </p>
      <div className="instructions small">
        {me.username
          ? t("Влизате с потребителско име {u} и код на фирмата {c}.", { u: me.username, c: org.code })
          : t("Влизате с имейл {e}.", { e: session?.user.email ?? "" })}{" "}
        {t("Паролата можете да смените от „Профил“.")}
      </div>
      <div className="row wrap">
        {perm === "default" && (
          <button className="btn primary" onClick={async () => setPerm(await enableNotifications())}>
            🔔 {t("Включи известията за нови задачи")}
          </button>
        )}
        {perm === "granted" && <span className="chip approved">{t("Известията са включени")}</span>}
        {perm === "denied" && <span className="muted small">{t("Известията са блокирани от браузъра.")}</span>}
        <button className="btn" onClick={close}>
          {t("Разбрах")}
        </button>
      </div>
    </div>
  );
}
