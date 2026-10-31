import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase, STAFF_DOMAIN, isDemo } from "../lib/supabase";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../lib/demo/client";
import { errMsg, slugify } from "../lib/util";
import { Alert, Field } from "../components/ui";
import { useApp } from "../lib/session";
import { LANGS, t, useLang } from "../lib/i18n";
import ParticleHero from "../components/ParticleHero";

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const { lang, setLang } = useLang();
  return (
    <div className="auth auth-scene">
      <ParticleHero />
      <aside className="hero" aria-hidden="true">
        <i className="shape s1" />
        <i className="shape s2" />
        <i className="shape s3" />
        <div className="hero-brand">
          <span className="mark">✔</span>TeamTasks
        </div>
        <h2 className="hero-title">
          {t("Задачите на екипа –")} <em>{t("ясни")}</em>, {t("подредени, изпълнени.")}
        </h2>
        <p className="hero-sub">{t("Инструкции, снимка и потвърждение от ръководител – за всеки човек и всяка група, в телефона и в браузъра.")}</p>
        <ul>
          <li><i>✓</i>{t("Задачи с повторение и срок")}</li>
          <li><i>✓</i>{t("Отметка, бележка и снимка")}</li>
          <li><i>✓</i>{t("Одобрение от ръководителя")}</li>
          <li><i>✓</i>{t("Групи, отдели и календар")}</li>
        </ul>
      </aside>
      <div className="card stack">
        <div className="langs" role="group" aria-label="Language">
          {LANGS.map((l) => (
            <button key={l.code} type="button" className={`lang-pill ${lang === l.code ? "on" : ""}`} onClick={() => setLang(l.code)} title={l.label}>
              <span>{l.flag}</span>
            </button>
          ))}
        </div>
        <div className="center">
          <div className="logo">✔</div>
          <h1>{title}</h1>
          {subtitle && (
            <p className="muted" style={{ marginTop: 6 }}>
              <span className="typed" style={{ "--n": subtitle.length } as React.CSSProperties}>
                {subtitle}
              </span>
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** „ivan.petrov“ + код на фирмата -> служебен имейл; пълен имейл се ползва както е. */
function toAuthEmail(identifier: string, code: string): string {
  const id = identifier.trim().toLowerCase();
  if (id.includes("@")) return id;
  return `${id}@${code.trim().toLowerCase()}.${STAFF_DOMAIN}`;
}

export function Login() {
  const nav = useNavigate();
  const [id, setId] = useState("");
  const [code, setCode] = useState(() => {
    try {
      return localStorage.getItem("teamtasks.code") ?? "";
    } catch {
      return "";
    }
  });
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isUsername = id.length > 0 && !id.includes("@");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (isUsername && !code.trim()) return setErr(t("Въведете кода на фирмата."));
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: toAuthEmail(id, code), password: pw });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    try {
      if (isUsername) localStorage.setItem("teamtasks.code", code.trim().toLowerCase());
    } catch {
      /* ignore */
    }
    nav("/", { replace: true });
  }

  async function google() {
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  }

  return (
    <Shell title="TeamTasks" subtitle={t("Влезте в профила си")}>
      <form className="stack" onSubmit={submit}>
        <Field label={t("Имейл или потребителско име")}>
          <input type="text" autoComplete="username" autoCapitalize="none" value={id} onChange={(e) => setId(e.target.value)} required />
        </Field>
        {isUsername && (
          <Field label={t("Код на фирмата")} hint={t("Попитайте ръководителя си – напр. „mojafirma“.")}>
            <input type="text" autoCapitalize="none" value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
        )}
        <Field label={t("Парола")}>
          <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </Field>
        {err && <Alert kind="bad">{err}</Alert>}
        <button className="btn primary block" disabled={busy}>
          {busy ? t("Вход…") : t("Вход")}
        </button>
      </form>
      {import.meta.env.VITE_GOOGLE_LOGIN === "true" && (
        <button className="btn block" onClick={google}>
          {t("Вход с Google")}
        </button>
      )}
      <div className="center small">
        <Link to="/forgot">{t("Забравена парола")}</Link>
      </div>
      {isDemo && (
        <div className="stack" style={{ gap: 8 }}>
          <Alert kind="info">
            <b>Демо режим</b> – данните са само в този браузър. Влезте с един клик:
          </Alert>
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.email}
              className="btn block"
              style={{ justifyContent: "space-between" }}
              onClick={async () => {
                await supabase.auth.signInWithPassword({ email: a.email, password: DEMO_PASSWORD });
                nav("/", { replace: true });
              }}
            >
              <span>{a.role}: {a.name}</span>
              <span className="muted small">{a.hint}</span>
            </button>
          ))}
          <span className="muted small center">
            Или ръчно: maria / код demo / парола {DEMO_PASSWORD}
          </span>
        </div>
      )}
      <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }} />
      <div className="center">
        <span className="muted">Имате фирма? </span>
        <Link to="/register">Регистрирайте се безплатно</Link>
      </div>
    </Shell>
  );
}

export function Register() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (pw.length < 8) return setErr("Паролата трябва да е поне 8 символа.");
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password: pw,
      options: { data: { display_name: name.trim(), company: company.trim() }, emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    // при включено потвърждаване на имейла няма сесия до клик на линка
    if (!data.session) setSent(true);
  }

  if (sent)
    return (
      <Shell title="Проверете имейла си">
        <Alert kind="ok">Изпратихме линк за потвърждение на {email}. След като го отворите, влезте в профила си.</Alert>
        <Link className="btn block" to="/login">
          Към вход
        </Link>
      </Shell>
    );

  return (
    <Shell title="Нова фирма" subtitle="14 дни безплатен пробен период, без карта">
      <form className="stack" onSubmit={submit}>
        <Field label="Вашето име">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Име на фирмата">
          <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} required />
        </Field>
        <Field label="Имейл">
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Парола" hint="Поне 8 символа">
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </Field>
        {err && <Alert kind="bad">{err}</Alert>}
        <button className="btn primary block" disabled={busy}>
          {busy ? "Създаване…" : "Създай акаунт"}
        </button>
      </form>
      <div className="center">
        <span className="muted">Вече имате акаунт? </span>
        <Link to="/login">Вход</Link>
      </div>
    </Shell>
  );
}

/** След регистрация: потребител без фирма създава своята. */
export function Onboarding() {
  const { session, reload, signOut } = useApp();
  const meta = (session?.user.user_metadata ?? {}) as { display_name?: string; company?: string };
  const [company, setCompany] = useState(meta.company ?? "");
  const [code, setCode] = useState(slugify(meta.company ?? ""));
  const [name, setName] = useState(meta.display_name ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const { error } = await supabase.rpc("create_organization", {
      p_name: company,
      p_code: code,
      p_display_name: name,
    });
    if (error) {
      setBusy(false);
      return setErr(errMsg(error));
    }
    await reload();
    setBusy(false);
  }

  return (
    <Shell title="Създайте вашата фирма" subtitle="Само още една стъпка">
      <form className="stack" onSubmit={submit}>
        <Field label="Вашето име">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Име на фирмата">
          <input
            type="text"
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              setCode(slugify(e.target.value));
            }}
            required
          />
        </Field>
        <Field label="Код на фирмата" hint="3–20 малки латински букви/цифри. Служителите без имейл влизат с него.">
          <input type="text" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} pattern="[a-z0-9]{3,20}" required />
        </Field>
        {err && <Alert kind="bad">{err}</Alert>}
        <button className="btn primary block" disabled={busy}>
          {busy ? "Създаване…" : "Създай фирмата"}
        </button>
      </form>
      <button className="btn ghost" onClick={signOut}>
        Изход
      </button>
    </Shell>
  );
}

export function Forgot() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset`,
    });
    if (error) return setErr(errMsg(error));
    setDone(true);
  }

  return (
    <Shell title="Забравена парола" subtitle="Служителите без имейл – поискайте нова парола от ръководителя.">
      {done ? (
        <Alert kind="ok">Ако има такъв акаунт, изпратихме линк за нова парола.</Alert>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field label="Имейл">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          {err && <Alert kind="bad">{err}</Alert>}
          <button className="btn primary block">Изпрати линк</button>
        </form>
      )}
      <Link className="center" to="/login">
        ← Към вход
      </Link>
    </Shell>
  );
}

export function ResetPassword() {
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setErr("Паролата трябва да е поне 8 символа.");
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return setErr(errMsg(error));
    nav("/", { replace: true });
  }

  return (
    <Shell title="Нова парола">
      <form className="stack" onSubmit={submit}>
        <Field label="Нова парола">
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </Field>
        {err && <Alert kind="bad">{err}</Alert>}
        <button className="btn primary block">Запази</button>
      </form>
    </Shell>
  );
}
