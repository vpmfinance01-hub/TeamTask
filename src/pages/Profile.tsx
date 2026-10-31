import { useEffect, useState, type FormEvent } from "react";
import { supabase, isDemo } from "../lib/supabase";
import { resetDemo } from "../lib/demo/client";
import { enableNotifications, notificationState } from "../lib/watch";
import { getFx, getTheme, setFx, setTheme, type Theme } from "../lib/theme";
import { confetti } from "../lib/fx";
import { useApp } from "../lib/session";
import { roleLabel, errMsg } from "../lib/util";
import { LANGS, t, useLang } from "../lib/i18n";
import { Alert, Field } from "../components/ui";
import NotifyPrefs from "../components/NotifyPrefs";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

export default function Profile() {
  const { me, org, isOwner, session, signOut, reload, perm, settings } = useApp();
  const { lang, setLang } = useLang();
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [orgName, setOrgName] = useState(org?.name ?? "");
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [notif, setNotif] = useState(notificationState());
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [fx, setFxState] = useState(getFx());

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  if (!me || !org) return null;
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const allowed = LANGS.filter((l) => l.code === "bg" || settings.languages.includes(l.code));

  async function changePw(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    if (pw.length < 8) return setErr(t("Паролата трябва да е поне 8 символа."));
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return setErr(errMsg(error));
    setPw("");
    setMsg(t("Паролата е сменена."));
  }

  async function saveOrg(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    const { error } = await supabase.from("organizations").update({ name: orgName.trim() }).eq("id", org!.id);
    if (error) return setErr(errMsg(error));
    await reload();
    setMsg("Името на фирмата е запазено.");
  }

  return (
    <div className="stack">
      <h1>{t("Профил")}</h1>
      <div className="card stack">
        <div>
          <b>{me.display_name}</b>
          <div className="muted small">
            {roleLabel(me.role)} · {org.name}
          </div>
          <div className="muted small">{me.username ? `@${me.username} (${t("код")} ${org.code})` : session?.user.email}</div>
        </div>
      </div>

      {perm.languages && allowed.length > 1 && (
        <div className="card stack">
          <h2>{t("Език")}</h2>
          <div className="langs">
            {allowed.map((l) => (
              <button key={l.code} className={`lang-pill ${lang === l.code ? "on" : ""}`} onClick={() => setLang(l.code)}>
                <span>{l.flag}</span>
                {l.label}
              </button>
            ))}
          </div>
          <span className="muted small">{t("Езикът променя текстовете на приложението. Имената на задачите остават както са написани.")}</span>
        </div>
      )}

      <div className="card stack">
        <h2>{t("Изглед")}</h2>
        <div className="tabs">
          <button className={`tab ${theme === "sphere" ? "active" : ""}`} onClick={() => (setTheme("sphere"), setThemeState("sphere"))}>
            {t("Сфера (тъмен)")}
          </button>
          <button className={`tab ${theme === "studio" ? "active" : ""}`} onClick={() => (setTheme("studio"), setThemeState("studio"))}>
            {t("Дизайнерски")}
          </button>
          <button className={`tab ${theme === "classic" ? "active" : ""}`} onClick={() => (setTheme("classic"), setThemeState("classic"))}>
            {t("Класически")}
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={fx} onChange={(e) => (setFx(e.target.checked), setFxState(e.target.checked))} />
          <span>{t("Зрителни ефекти (плавни появявания, меки светлини, пръстен на напредъка, конфети). Изключете ги на бавен телефон.")}</span>
        </label>
        {fx && (
          <button className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => confetti()}>
            🎉 {t("Пробвай ефекта")}
          </button>
        )}
      </div>

      <div className="card stack">
        <h2>{t("Известия")}</h2>
        {notif === "granted" && <p className="muted">{t("Включени – получавате известие при нова или върната задача.")}</p>}
        {notif === "denied" && <p className="muted">{t("Блокирани от браузъра. Разрешете ги от настройките на сайта.")}</p>}
        {notif === "unsupported" && <p className="muted">{t("Този браузър не поддържа известия. Новите задачи се показват в приложението.")}</p>}
        {notif === "default" && (
          <>
            <p className="muted">{t("Получавайте известие веднага щом ви бъде възложена задача.")}</p>
            <button className="btn primary" onClick={async () => setNotif(await enableNotifications())}>
              🔔 {t("Включи известията")}
            </button>
          </>
        )}
      </div>

      {!standalone && (
        <div className="card stack">
          <h2>{t("Инсталирай на телефона")}</h2>
          {install ? (
            <button
              className="btn primary"
              onClick={async () => {
                await install.prompt();
                setInstall(null);
              }}
            >
              {t("Добави на началния екран")}
            </button>
          ) : ios ? (
            <p className="muted">{t("В Safari натиснете „Сподели“ и после „Добави към начален екран“.")}</p>
          ) : (
            <p className="muted">{t("В менюто на браузъра изберете „Инсталиране на приложението“ / „Добави към начален екран“.")}</p>
          )}
        </div>
      )}

      <NotifyPrefs membershipId={me.id} orgId={org.id} loginEmail={me.username ? null : session?.user.email} />

      {isOwner && (
        <form className="card stack" onSubmit={saveOrg}>
          <h2>Фирма</h2>
          <Field label="Име на фирмата">
            <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} required minLength={2} />
          </Field>
          <div className="muted small">
            Код за вход на служителите: <b>{org.code}</b>
          </div>
          <button className="btn">Запази</button>
        </form>
      )}

      <form className="card stack" onSubmit={changePw}>
        <h2>{t("Смяна на парола")}</h2>
        <Field label={t("Нова парола")}>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <button className="btn">{t("Смени")}</button>
      </form>

      {msg && <Alert kind="ok">{msg}</Alert>}
      {err && <Alert kind="bad">{err}</Alert>}
      <button className="btn danger" onClick={signOut}>
        {t("Изход")}
      </button>
      {isDemo && (
        <button
          className="btn"
          onClick={() => {
            if (confirm(t("Да върна ли демо данните в началното им състояние?"))) {
              resetDemo();
              window.location.href = "/login";
            }
          }}
        >
          {t("Нулирай демо данните")}
        </button>
      )}
    </div>
  );
}
