import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { errMsg, normalizePhone } from "../lib/util";
import { t } from "../lib/i18n";
import { Alert, Field } from "./ui";

interface Prefs {
  email: string;
  phone: string;
  email_on: boolean;
  whatsapp_on: boolean;
  viber_on: boolean;
}
interface OrgSettings {
  email_on: boolean;
  whatsapp_on: boolean;
  viber_on: boolean;
}
const EMPTY: Prefs = { email: "", phone: "", email_on: true, whatsapp_on: false, viber_on: false };

/** Къде да получава известия за нови и върнати задачи (имейл / WhatsApp / Viber). */
export default function NotifyPrefs({
  membershipId,
  orgId,
  loginEmail,
  title,
}: {
  membershipId: string;
  orgId: string;
  loginEmail?: string | null;
  title?: string;
}) {
  const [p, setP] = useState<Prefs>(EMPTY);
  const [org, setOrg] = useState<OrgSettings>({ email_on: true, whatsapp_on: false, viber_on: false });
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const [a, b] = await Promise.all([
        supabase.from("notification_prefs").select("email, phone, email_on, whatsapp_on, viber_on").eq("membership_id", membershipId).maybeSingle(),
        supabase.from("org_notification_settings").select("email_on, whatsapp_on, viber_on").eq("org_id", orgId).maybeSingle(),
      ]);
      if (!alive) return;
      if (a.data) setP({ ...EMPTY, ...(a.data as Partial<Prefs>), email: a.data.email ?? "", phone: a.data.phone ?? "" });
      if (b.data) setOrg(b.data as OrgSettings);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [membershipId, orgId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    const phone = p.phone.trim() ? normalizePhone(p.phone) : "";
    if (p.phone.trim() && !phone) return setErr(t("Невалиден телефон. Пример: 0888 123 456 или +359 888 123 456."));
    if ((p.whatsapp_on || p.viber_on) && !phone) return setErr(t("За WhatsApp и Viber е нужен телефон."));
    const row = {
      membership_id: membershipId,
      org_id: orgId,
      email: p.email.trim().toLowerCase() || null,
      phone: phone || null,
      email_on: p.email_on,
      whatsapp_on: p.whatsapp_on,
      viber_on: p.viber_on,
      updated_at: new Date().toISOString(),
    };
    const exists = await supabase.from("notification_prefs").select("membership_id").eq("membership_id", membershipId).maybeSingle();
    const { error } = exists.data
      ? await supabase.from("notification_prefs").update(row).eq("membership_id", membershipId)
      : await supabase.from("notification_prefs").insert(row);
    if (error) return setErr(error.message.includes("check") ? t("Невалиден имейл или телефон.") : errMsg(error));
    setP((x) => ({ ...x, phone }));
    setMsg(t("Записано."));
  }

  if (!loaded) return null;
  const off = (on: boolean) => (on ? "" : ` ${t("(изключено от фирмата)")}`);

  return (
    <form className="card stack" onSubmit={save}>
      <h2>{title ?? t("Известия за задачи")}</h2>
      <p className="muted small">{t("Получавате съобщение, когато ви бъде възложена нова задача или ръководителят ви върне задача за поправка.")}</p>
      <Field label={t("Имейл за известия")} hint={loginEmail ? t("По подразбиране: {e}", { e: loginEmail }) : t("Оставете празно, ако нямате имейл.")}>
        <input type="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} placeholder="ime@primer.bg" />
      </Field>
      <Field label={t("Телефон (за WhatsApp и Viber)")}>
        <input type="tel" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} placeholder="0888 123 456" />
      </Field>
      <label className="check">
        <input type="checkbox" checked={p.email_on} disabled={!org.email_on} onChange={(e) => setP({ ...p, email_on: e.target.checked })} />
        <span>
          {t("Известия по имейл")}
          {off(org.email_on)}
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={p.whatsapp_on} disabled={!org.whatsapp_on} onChange={(e) => setP({ ...p, whatsapp_on: e.target.checked })} />
        <span>
          {t("Известия по WhatsApp")}
          {off(org.whatsapp_on)}
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={p.viber_on} disabled={!org.viber_on} onChange={(e) => setP({ ...p, viber_on: e.target.checked })} />
        <span>
          {t("Известия по Viber")}
          {off(org.viber_on)}
        </span>
      </label>
      {msg && <Alert kind="ok">{msg}</Alert>}
      {err && <Alert kind="bad">{err}</Alert>}
      <button className="btn">{t("Запази")}</button>
    </form>
  );
}

/** Собственикът включва кои канали ползва фирмата. */
export function OrgNotifySettings({ orgId }: { orgId: string }) {
  const [s, setS] = useState<OrgSettings>({ email_on: true, whatsapp_on: false, viber_on: false });
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase
      .from("org_notification_settings")
      .select("email_on, whatsapp_on, viber_on")
      .eq("org_id", orgId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setS(data as OrgSettings);
        setLoaded(true);
      });
  }, [orgId]);

  async function save(next: OrgSettings) {
    setS(next);
    setErr("");
    setMsg("");
    const exists = await supabase.from("org_notification_settings").select("org_id").eq("org_id", orgId).maybeSingle();
    const row = { org_id: orgId, ...next, updated_at: new Date().toISOString() };
    const { error } = exists.data
      ? await supabase.from("org_notification_settings").update(row).eq("org_id", orgId)
      : await supabase.from("org_notification_settings").insert(row);
    if (error) return setErr(errMsg(error));
    setMsg("Записано.");
  }

  if (!loaded) return null;
  return (
    <div className="card stack">
      <h2>Известия на фирмата</h2>
      <p className="muted small">
        Какви канали ползва фирмата. Всеки служител избира свой контакт; получатели са членовете на групата (отдела), към която е задачата.
      </p>
      <label className="check">
        <input type="checkbox" checked={s.email_on} onChange={(e) => save({ ...s, email_on: e.target.checked })} />
        <span>Имейл</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={s.whatsapp_on} onChange={(e) => save({ ...s, whatsapp_on: e.target.checked })} />
        <span>WhatsApp (изисква настроена услуга за изпращане)</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={s.viber_on} onChange={(e) => save({ ...s, viber_on: e.target.checked })} />
        <span>Viber (изисква настроена услуга за изпращане)</span>
      </label>
      {msg && <Alert kind="ok">{msg}</Alert>}
      {err && <Alert kind="bad">{err}</Alert>}
    </div>
  );
}
