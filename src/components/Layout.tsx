import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import OfflineBar from "./OfflineBar";
import AppBackdrop from "./AppBackdrop";
import { useApp } from "../lib/session";
import { useWatcher } from "../lib/watch";
import { isDemo } from "../lib/supabase";
import { hasAccess, trialDaysLeft } from "../lib/util";
import { t, useLang } from "../lib/i18n";
import { Alert, Modal } from "./ui";
import Icon, { type IconName } from "./Icon";
import Avatar from "./Avatar";

interface Item {
  to: string;
  icon: IconName;
  label: string;
  badge?: number;
}

export default function Layout() {
  const { me, org, isManager, isOwner, memberships, switchOrg, perm } = useApp();
  const { toast, dismiss, pending } = useWatcher();
  const { lang, setLang } = useLang();
  const { settings } = useApp();
  const go = useNavigate();
  const loc = useLocation();
  const [more, setMore] = useState(false);

  // езикът е в ръководен списък на работодателя; извън него се връщаме към разрешен език
  useEffect(() => {
    const allowed = perm.languages ? ["bg", ...settings.languages] : ["bg"];
    if (!allowed.includes(lang)) setLang("bg");
  }, [perm.languages, settings.languages, lang, setLang]);

  useEffect(() => setMore(false), [loc.pathname]);

  if (!me || !org) return null;

  const items: Item[] = [{ to: "/", icon: "today", label: t("Днес") }];
  if (isManager) items.push({ to: "/review", icon: "bell", label: t("Одобри"), badge: pending });
  if (perm.calendar) items.push({ to: "/calendar", icon: "calendar", label: t("Календар") });
  if (isManager) items.push({ to: "/tasks", icon: "tasks", label: t("Задачи") });
  if (isManager) items.push({ to: "/overview", icon: "chart", label: t("Преглед") });
  if (perm.reports) items.push({ to: "/reports", icon: "history", label: t("Отчети") });
  if (perm.schedule !== "none") items.push({ to: "/schedule", icon: "shifts", label: t("График") });
  if (perm.hours) items.push({ to: "/hours", icon: "timer", label: t("Часове") });
  if (!isManager && perm.history) items.push({ to: "/history", icon: "history", label: t("История") });
  if (isManager) items.push({ to: "/people", icon: "users", label: t("Хора") });
  if (isManager) items.push({ to: "/settings", icon: "cog", label: t("Настройки") });
  if (isOwner) items.push({ to: "/billing", icon: "card", label: t("План") });
  items.push({ to: "/profile", icon: "settings", label: t("Профил") });

  const link = (i: Item, inMore = false) => (
    <NavLink key={i.to} to={i.to} end={i.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
      <span className="nav-ico">
        <Icon name={i.icon} />
      </span>
      <span>{i.label}</span>
      {i.badge ? <span className={inMore ? "badge-inline" : "badge"}>{i.badge}</span> : null}
    </NavLink>
  );

  // на телефон: най-много 5 бутона – при повече, четири + „Още“
  const mainItems = items.length > 5 ? items.slice(0, 4) : items;
  const moreItems = items.length > 5 ? items.slice(4) : [];
  const moreActive = moreItems.some((i) => loc.pathname === i.to || (i.to !== "/" && loc.pathname.startsWith(i.to)));
  const moreBadge = moreItems.reduce((a, i) => a + (i.badge ?? 0), 0);

  const access = hasAccess(org);
  return (
    <div className="app">
      <AppBackdrop />
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-ico">✔</span>
          <span className="brand-txt">TeamTasks</span>
        </div>
        {items.map((i) => link(i))}
        <div className="spacer" />
        <div className="me">
          <Avatar name={me.display_name} />
          <div className="who">
            <b>{me.display_name}</b>
            <span>{org.name}</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div>
            <div className="org">{org.name}</div>
            <div className="sub">{me.display_name}</div>
          </div>
          <div className="topbar-right">
            {memberships.length > 1 && (
              <select style={{ width: "auto" }} value={org.id} onChange={(e) => switchOrg(e.target.value)} aria-label={t("Фирма")}>
                {memberships.map((m) => (
                  <option key={m.org_id} value={m.org_id}>
                    {m.organizations.name}
                  </option>
                ))}
              </select>
            )}
            <NavLink to="/profile" aria-label={t("Профил")} style={{ display: "flex" }}>
              <Avatar name={me.display_name} />
            </NavLink>
          </div>
        </div>
        {isDemo && (
          <div style={{ marginBottom: 12 }}>
            <Alert kind="warn">{t("Демо режим – данните са само в този браузър. Превключвайте ролите от „Профил → Изход“.")}</Alert>
          </div>
        )}
        {!access && (
          <div style={{ marginBottom: 12 }}>
            <Alert kind="bad">
              {t("Абонаментът е неактивен – данните се виждат, но не могат да се променят.")}{" "}
              {isOwner ? <NavLink to="/billing">Активирайте план →</NavLink> : t("Свържете се със собственика.")}
            </Alert>
          </div>
        )}
        {access && org.sub_status === "trialing" && isOwner && (
          <div style={{ marginBottom: 12 }}>
            <Alert kind="info">
              Пробен период: още {trialDaysLeft(org)} дни. <NavLink to="/billing">Изберете план →</NavLink>
            </Alert>
          </div>
        )}
        {access && org.sub_status === "past_due" && isOwner && (
          <div style={{ marginBottom: 12 }}>
            <Alert kind="warn">
              Плащането не е минало. Обновете картата, за да не се блокира достъпът. <NavLink to="/billing">Абонамент →</NavLink>
            </Alert>
          </div>
        )}
        <OfflineBar />
        <Outlet />
      </main>

      <nav className="bottomnav">
        {mainItems.map((i) => link(i))}
        {moreItems.length > 0 && (
          <button type="button" className={`more-btn ${moreActive ? "active" : ""}`} onClick={() => setMore(true)} aria-label={t("Още")}>
            <span className="nav-ico">
              <Icon name="more" />
            </span>
            <span>{t("Още")}</span>
            {moreBadge ? <span className="badge">{moreBadge}</span> : null}
          </button>
        )}
      </nav>

      {more && (
        <Modal title={t("Още")} onClose={() => setMore(false)}>
          <div className="more-list">{moreItems.map((i) => link(i, true))}</div>
        </Modal>
      )}

      {toast && (
        <div
          className="toast"
          role="status"
          onClick={() => {
            go(toast.to);
            dismiss();
          }}
        >
          <div className="grow">
            <b>{toast.title}</b>
            <div className="small">{toast.body}</div>
          </div>
          <button
            className="btn ghost small"
            aria-label={t("Затвори")}
            onClick={(e) => {
              e.stopPropagation();
              dismiss();
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
