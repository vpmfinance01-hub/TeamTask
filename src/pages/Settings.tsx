import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { LANGS, type Lang } from "../lib/i18n";
import { DEFAULT_VISIBILITY, MODULES, ROADMAP, type ModuleKey, type SchedVis, type Visibility } from "../lib/features";
import { errMsg } from "../lib/util";
import { Alert, Switch } from "../components/ui";
import { OrgNotifySettings } from "../components/NotifyPrefs";

type Tab = "modules" | "visibility" | "notify";

/** Настройки: модулите на фирмата (работодател) и какво виждат служителите (ръководител, по групи). */
export default function Settings() {
  const { isOwner } = useApp();
  const [tab, setTab] = useState<Tab>(isOwner ? "modules" : "visibility");
  return (
    <div className="stack">
      <h1>Настройки</h1>
      <div className="tabs">
        {isOwner && (
          <button className={`tab ${tab === "modules" ? "active" : ""}`} onClick={() => setTab("modules")}>
            Модули на фирмата
          </button>
        )}
        <button className={`tab ${tab === "visibility" ? "active" : ""}`} onClick={() => setTab("visibility")}>
          Какво виждат служителите
        </button>
        {isOwner && (
          <button className={`tab ${tab === "notify" ? "active" : ""}`} onClick={() => setTab("notify")}>
            Известия
          </button>
        )}
      </div>
      {tab === "modules" && isOwner && <ModulesTab />}
      {tab === "visibility" && <VisibilityTab />}
      {tab === "notify" && isOwner && <NotifyTab />}
    </div>
  );
}

/* ---------------------------------------------------------------- модули (работодател) */
function ModulesTab() {
  const { org, settings, reload } = useApp();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  if (!org) return null;

  async function save(next: { features: Record<ModuleKey, boolean>; languages: Lang[] }) {
    setErr("");
    setSaved(false);
    const exists = await supabase.from("org_settings").select("org_id").eq("org_id", org!.id).maybeSingle();
    const row = { org_id: org!.id, features: next.features, languages: next.languages, updated_at: new Date().toISOString() };
    const { error } = exists.data
      ? await supabase.from("org_settings").update(row).eq("org_id", org!.id)
      : await supabase.from("org_settings").insert(row);
    if (error) return setErr(errMsg(error));
    await reload();
    setSaved(true);
  }
  const toggle = (k: ModuleKey, v: boolean) => save({ features: { ...settings.features, [k]: v }, languages: settings.languages });
  const toggleLang = (code: Lang) => {
    if (code === "bg") return; // българският винаги е наличен
    const has = settings.languages.includes(code);
    save({ features: settings.features, languages: has ? settings.languages.filter((l) => l !== code) : [...settings.languages, code] });
  };

  return (
    <>
      <p className="muted">
        Като работодател решавате кои възможности да са включени във фирмата. Изключените не се виждат в менюто на никого.
        Какво точно виждат служителите от включените, задава ръководителят по групи („Какво виждат служителите“).
      </p>
      <div className="card stack" style={{ gap: 0 }}>
        {MODULES.map((m) => (
          <div key={m.key}>
            <Switch checked={settings.features[m.key]} onChange={(v) => toggle(m.key, v)} label={m.title} hint={m.desc} />
            {m.key === "languages" && settings.features.languages && (
              <div className="stack" style={{ padding: "0 0 14px", gap: 8 }}>
                <span className="label">Езици, които служителите могат да избират</span>
                <div className="langs">
                  {LANGS.map((l) => (
                    <button
                      key={l.code}
                      className={`lang-pill ${settings.languages.includes(l.code) || l.code === "bg" ? "on" : ""}`}
                      onClick={() => toggleLang(l.code)}
                      disabled={l.code === "bg"}
                    >
                      <span>{l.flag}</span>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {saved && <Alert kind="ok">Записано.</Alert>}
      {err && <Alert kind="bad">{err}</Alert>}

      <div className="section-title">Скоро</div>
      <div className="card stack soon" style={{ gap: 0 }}>
        {ROADMAP.map((r) => (
          <Switch key={r.title} checked={false} onChange={() => undefined} disabled label={<>{r.title} <span className="chip">скоро</span></>} hint={r.desc} />
        ))}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- видимост за служителите (ръководител) */
const SCHED_OPTS: { v: SchedVis; label: string }[] = [
  { v: "none", label: "Не виждат" },
  { v: "own", label: "Само своя" },
  { v: "group", label: "На цялата група" },
];

function VisibilityTab() {
  const { org, isOwner, groups, leaderGroupIds, groupSettings, settings, reload } = useApp();
  const mine = useMemo(() => (isOwner ? groups : groups.filter((g) => leaderGroupIds.includes(g.id))), [isOwner, groups, leaderGroupIds]);
  const [gid, setGid] = useState(mine[0]?.id ?? "");
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!mine.some((g) => g.id === gid)) setGid(mine[0]?.id ?? "");
  }, [mine, gid]);

  const cur: Visibility = { ...DEFAULT_VISIBILITY, ...(groupSettings.find((s) => s.group_id === gid)?.visibility ?? {}) };

  async function write(groupId: string, v: Visibility) {
    const exists = await supabase.from("group_settings").select("group_id").eq("group_id", groupId).maybeSingle();
    const row = { group_id: groupId, org_id: org!.id, visibility: v, updated_at: new Date().toISOString() };
    const { error } = exists.data
      ? await supabase.from("group_settings").update(row).eq("group_id", groupId)
      : await supabase.from("group_settings").insert(row);
    return error;
  }
  async function save(patch: Partial<Visibility>) {
    if (!org || !gid) return;
    setErr("");
    setSaved("");
    const error = await write(gid, { ...cur, ...patch });
    if (error) return setErr(errMsg(error));
    await reload();
    setSaved("Записано.");
  }
  async function applyAll() {
    if (!org) return;
    setErr("");
    for (const g of mine) {
      const error = await write(g.id, cur);
      if (error) return setErr(errMsg(error));
    }
    await reload();
    setSaved(`Приложено към всички ваши групи (${mine.length}).`);
  }

  if (mine.length === 0) return <Alert kind="warn">Нямате групи, които да управлявате. Създайте група от „Хора → Групи“.</Alert>;

  const f = settings.features;
  const off = (on: boolean) => (on ? undefined : "Модулът е изключен от работодателя");
  const preview = [
    "Днес и задачите си",
    f.calendar && cur.see_calendar ? "Календар" : null,
    f.shifts && cur.see_schedule !== "none" ? (cur.see_schedule === "group" ? "График на групата" : "Своя график") : null,
    f.timeclock && cur.see_hours ? "Отработени часове" : null,
    f.timeclock && cur.self_clock ? "Бутон начало/край на смяна" : null,
    cur.see_history ? "История" : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <p className="muted">
        Изберете група и задайте какво виждат и могат да правят нейните служители. Служител, който е в няколко групи, получава
        най-широките права от тях.
      </p>
      <div className="field">
        <label>Група</label>
        <select value={gid} onChange={(e) => (setGid(e.target.value), setSaved(""))}>
          {mine.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className="card stack" style={{ gap: 0 }}>
        <Switch checked={cur.see_calendar} onChange={(v) => save({ see_calendar: v })} disabled={!f.calendar} label="Календар" hint={off(f.calendar) ?? "Месечен календар с техните задачи и търсене."} />
        <Switch checked={cur.see_history} onChange={(v) => save({ see_history: v })} label="История" hint="Минали задачи, одобрения и връщания." />
        <Switch checked={cur.see_hours} onChange={(v) => save({ see_hours: v })} disabled={!f.timeclock} label="Отработени часове" hint={off(f.timeclock) ?? "Виждат часовете си по дни и баланса спрямо графика."} />
        <Switch checked={cur.self_clock} onChange={(v) => save({ self_clock: v })} disabled={!f.timeclock} label="Сами отбелязват начало и край" hint={off(f.timeclock) ?? "Бутон „Начало на смяна“. Ако е изключено, часовете въвеждате вие."} />
        <div className="stack" style={{ padding: "14px 0 4px", gap: 8, opacity: f.shifts ? 1 : 0.5 }}>
          <b>График</b>
          <span className="muted small">{off(f.shifts) ?? "Кой график виждат служителите. Виждат само публикуваните седмици."}</span>
          <div className="seg" role="group" aria-label="График">
            {SCHED_OPTS.map((o) => (
              <button key={o.v} className={cur.see_schedule === o.v ? "on" : ""} disabled={!f.shifts} onClick={() => save({ see_schedule: o.v })}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card stack">
        <span className="label">Служител от тази група вижда</span>
        <div className="perm-list">
          {preview.map((p) => (
            <span key={p} className="chip approved">
              {p}
            </span>
          ))}
        </div>
      </div>

      <div className="row wrap">
        {mine.length > 1 && (
          <button className="btn" onClick={applyAll}>
            Приложи към всички мои групи
          </button>
        )}
      </div>
      {saved && <Alert kind="ok">{saved}</Alert>}
      {err && <Alert kind="bad">{err}</Alert>}
    </>
  );
}

function NotifyTab() {
  const { org } = useApp();
  if (!org) return null;
  return <OrgNotifySettings orgId={org.id} />;
}
