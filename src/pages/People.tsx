import { useMemo, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import type { Group, Membership, Role } from "../lib/types";
import { ROLE_LABEL, errMsg, fnError, normalizePhone, randomPassword } from "../lib/util";
import { Alert, Empty, Field, Modal } from "../components/ui";
import NotifyPrefs from "../components/NotifyPrefs";

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#9333ea", "#0891b2", "#db2777", "#475569"];

export default function People() {
  const { groups } = useApp();
  const [tab, setTab] = useState<"people" | "groups">("people");
  return (
    <div className="stack">
      <h1>Хора и групи</h1>
      <div className="tabs">
        <button className={`tab ${tab === "people" ? "active" : ""}`} onClick={() => setTab("people")}>
          Хора
        </button>
        <button className={`tab ${tab === "groups" ? "active" : ""}`} onClick={() => setTab("groups")}>
          Групи ({groups.length})
        </button>
      </div>
      {tab === "people" ? <PeopleTab /> : <GroupsTab />}
    </div>
  );
}

/* ---------------------------------------------------------------- хора */
function PeopleTab() {
  const { members, groups, groupMembers, isOwner, org, plan, reload } = useApp();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Membership | null>(null);
  const activeCount = members.filter((m) => m.active).length;

  return (
    <>
      <div className="row between">
        <span className="muted small">
          {activeCount}
          {plan ? ` / ${plan.max_members}` : ""} активни
        </span>
        <button className="btn primary" onClick={() => setAdding(true)}>
          + Нов служител
        </button>
      </div>
      {members.map((m) => {
        const mine = groupMembers.filter((g) => g.membership_id === m.id);
        return (
          <button
            key={m.id}
            className="task"
            style={{ textAlign: "left", opacity: m.active ? 1 : 0.55 }}
            onClick={() => setEditing(m)}
          >
            <div className="grow stack" style={{ gap: 4 }}>
              <div className="title">{m.display_name}</div>
              <div className="row wrap small muted" style={{ gap: 8 }}>
                <span>{ROLE_LABEL[m.role]}</span>
                {m.username && <span>@{m.username}</span>}
                {!m.active && <span>неактивен</span>}
                {mine.map((g) => {
                  const grp = groups.find((x) => x.id === g.group_id);
                  return grp ? (
                    <span key={g.group_id} className="row" style={{ gap: 4 }}>
                      <i className="dot" style={{ background: grp.color }} />
                      {grp.name}
                      {g.is_leader ? " ★" : ""}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          </button>
        );
      })}
      {adding && <AddMember onClose={() => setAdding(false)} />}
      {editing && (
        <EditMember
          m={editing}
          onClose={async (changed) => {
            setEditing(null);
            if (changed) await reload();
          }}
        />
      )}
      {isOwner && org && (
        <p className="muted small">
          Код на фирмата за вход на служители без имейл: <b>{org.code}</b>
        </p>
      )}
    </>
  );
}

function AddMember({ onClose }: { onClose: () => void }) {
  const { org, isOwner, groups, leaderGroupIds, reload } = useApp();
  const pickable = isOwner ? groups : groups.filter((g) => leaderGroupIds.includes(g.id));
  const [name, setName] = useState("");
  const [useEmail, setUseEmail] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [wa, setWa] = useState(false);
  const [vb, setVb] = useState(false);
  const [password, setPassword] = useState(randomPassword());
  const [role, setRole] = useState<"employee" | "manager">("employee");
  const [sel, setSel] = useState<string[]>(pickable[0] ? [pickable[0].id] : []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!org) return;
    setErr("");
    if (!isOwner && sel.length === 0) return setErr("Изберете поне една група.");
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-member", {
      body: {
        org_id: org.id,
        display_name: name,
        username: useEmail ? undefined : username,
        email: useEmail ? email : undefined,
        password,
        role,
        group_ids: sel,
      },
    });
    if (error) {
      setBusy(false);
      return setErr(await fnError(error));
    }
    // контакти за известия за нови и върнати задачи
    const phoneNorm = phone.trim() ? normalizePhone(phone) : "";
    const memId = (data as { membership_id?: string } | null)?.membership_id;
    if (memId && (phoneNorm || (useEmail && email))) {
      await supabase.from("notification_prefs").insert({
        membership_id: memId,
        org_id: org.id,
        email: useEmail ? email.trim().toLowerCase() : null,
        phone: phoneNorm || null,
        email_on: useEmail,
        whatsapp_on: Boolean(phoneNorm) && wa,
        viber_on: Boolean(phoneNorm) && vb,
      });
    }
    setBusy(false);
    await reload();
    setCreated(
      `Вход в TeamTasks: ${window.location.origin}\n` +
        (useEmail ? `Имейл: ${email}\n` : `Потребителско име: ${username}\nКод на фирмата: ${org.code}\n`) +
        `Парола: ${password}`,
    );
  }

  if (created) {
    const text = `Здравей, ${name.split(" ")[0]}! Ето достъпа ти до ${org?.name ?? "TeamTasks"}.\n${created}\nСлед вход ще видиш задачите си.`;
    const enc = encodeURIComponent(text);
    const wa = normalizePhone(phone);
    const send = [
      phone && { label: "💬 SMS", href: `sms:${phone.replace(/\s/g, "")}?body=${enc}` },
      phone && { label: "Viber", href: `viber://forward?text=${enc}` },
      wa && { label: "WhatsApp", href: `https://wa.me/${wa}?text=${enc}` },
      useEmail && email && { label: "✉️ Имейл", href: `mailto:${email}?subject=${encodeURIComponent("Достъп до TeamTasks")}&body=${enc}` },
    ].filter(Boolean) as { label: string; href: string }[];
    return (
      <Modal title="Акаунтът е създаден" onClose={onClose}>
        <div className="stack">
          <Alert kind="ok">Изпратете достъпа на служителя. Паролата не се показва повторно.</Alert>
          <pre className="instructions" style={{ margin: 0 }}>{text}</pre>
          {send.length > 0 ? (
            <div className="row wrap">
              {send.map((s) => (
                <a key={s.label} className="btn primary grow" href={s.href} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              ))}
            </div>
          ) : (
            <span className="muted small">Добавете телефон или имейл при следващия служител, за да го изпратите с един клик.</span>
          )}
          <div className="row wrap">
            {typeof navigator.share === "function" && (
              <button className="btn grow" onClick={() => navigator.share({ title: "Достъп до TeamTasks", text }).catch(() => undefined)}>
                Сподели…
              </button>
            )}
            <button className="btn grow" onClick={() => navigator.clipboard?.writeText(text)}>
              Копирай
            </button>
          </div>
          <button className="btn" onClick={onClose}>
            Готово
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Нов служител" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Име">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <div className="tabs">
          <button type="button" className={`tab ${!useEmail ? "active" : ""}`} onClick={() => setUseEmail(false)}>
            Потребителско име
          </button>
          <button type="button" className={`tab ${useEmail ? "active" : ""}`} onClick={() => setUseEmail(true)}>
            Имейл
          </button>
        </div>
        {useEmail ? (
          <Field label="Имейл">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
        ) : (
          <Field label="Потребителско име" hint="Малки латински букви, цифри, точка, тире – напр. ivan.petrov">
            <input type="text" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} pattern="[a-z0-9._-]{2,30}" required />
          </Field>
        )}
        <Field label="Телефон (по желание)" hint="За изпращане на достъпа с един клик и за известия по WhatsApp/Viber.">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0888 123 456" />
        </Field>
        {phone.trim() && (
          <div className="stack" style={{ gap: 8 }}>
            <label className="check">
              <input type="checkbox" checked={wa} onChange={(e) => setWa(e.target.checked)} />
              <span>Известия за задачи по WhatsApp</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={vb} onChange={(e) => setVb(e.target.checked)} />
              <span>Известия за задачи по Viber</span>
            </label>
          </div>
        )}
        <Field label="Парола" hint="Предложена е автоматично; служителят може да я смени от профила си.">
          <div className="row">
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
            <button type="button" className="btn small" onClick={() => setPassword(randomPassword())}>
              ↻
            </button>
          </div>
        </Field>
        {isOwner && (
          <Field label="Роля">
            <select value={role} onChange={(e) => setRole(e.target.value as "employee" | "manager")}>
              <option value="employee">Служител</option>
              <option value="manager">Ръководител (одобрява задачи)</option>
            </select>
          </Field>
        )}
        <div className="stack" style={{ gap: 8 }}>
          <div className="label">Групи</div>
          {pickable.map((g) => (
            <label key={g.id} className="check">
              <input
                type="checkbox"
                checked={sel.includes(g.id)}
                onChange={(e) => setSel((s) => (e.target.checked ? [...s, g.id] : s.filter((x) => x !== g.id)))}
              />
              <span>{g.name}</span>
            </label>
          ))}
        </div>
        {err && <Alert kind="bad">{err}</Alert>}
        <button className="btn primary block" disabled={busy}>
          {busy ? "Създаване…" : "Създай акаунт"}
        </button>
      </form>
    </Modal>
  );
}

function EditMember({ m, onClose }: { m: Membership; onClose: (changed: boolean) => void }) {
  const { isOwner, groups, groupMembers, leaderGroupIds, org } = useApp();
  const [name, setName] = useState(m.display_name);
  const [active, setActive] = useState(m.active);
  const [role, setRole] = useState<Role>(m.role);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [mine, setMine] = useState(groupMembers.filter((g) => g.membership_id === m.id));

  const editableGroups: Group[] = isOwner ? groups : groups.filter((g) => leaderGroupIds.includes(g.id));
  const canEditProfile = isOwner && m.role !== "owner";

  async function saveProfile() {
    setErr("");
    setBusy(true);
    const { error } = await supabase.rpc("app_update_member", {
      p_member: m.id,
      p_display_name: name,
      p_active: active,
      p_role: role,
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setChanged(true);
    setMsg("Записано.");
  }

  async function toggleGroup(g: Group, on: boolean) {
    setErr("");
    const { error } = on
      ? await supabase.from("group_members").insert({ group_id: g.id, membership_id: m.id, org_id: g.org_id, is_leader: false })
      : await supabase.from("group_members").delete().eq("group_id", g.id).eq("membership_id", m.id);
    if (error) return setErr(errMsg(error));
    setChanged(true);
    setMine((x) => (on ? [...x, { group_id: g.id, membership_id: m.id, is_leader: false }] : x.filter((y) => y.group_id !== g.id)));
  }

  async function toggleLeader(g: Group, on: boolean) {
    const { error } = await supabase.from("group_members").update({ is_leader: on }).eq("group_id", g.id).eq("membership_id", m.id);
    if (error) return setErr(errMsg(error));
    setChanged(true);
    setMine((x) => x.map((y) => (y.group_id === g.id ? { ...y, is_leader: on } : y)));
  }

  async function resetPw() {
    setErr("");
    setMsg("");
    if (pw.length < 8) return setErr("Паролата трябва да е поне 8 символа.");
    setBusy(true);
    const { error } = await supabase.functions.invoke("reset-member-password", { body: { membership_id: m.id, password: pw } });
    setBusy(false);
    if (error) return setErr(await fnError(error));
    setMsg(`Новата парола е зададена: ${pw}` + (m.username && org ? ` (потребител ${m.username}, код ${org.code})` : ""));
    setPw("");
  }

  return (
    <Modal title={m.display_name} onClose={() => onClose(changed)}>
      <div className="stack">
        {canEditProfile && (
          <>
            <Field label="Име">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Роля">
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="employee">Служител</option>
                <option value="manager">Ръководител</option>
              </select>
            </Field>
            <label className="check">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span>Активен (неактивните не могат да влизат и не заемат място в плана)</span>
            </label>
            <button className="btn primary" onClick={saveProfile} disabled={busy}>
              Запази
            </button>
          </>
        )}

        {org && <NotifyPrefs membershipId={m.id} orgId={org.id} title="Известия за задачи" />}

        <div className="section-title" style={{ margin: "4px 0 0" }}>Групи</div>
        {editableGroups.length === 0 && <span className="muted small">Нямате групи, които да управлявате.</span>}
        {editableGroups.map((g) => {
          const row = mine.find((x) => x.group_id === g.id);
          return (
            <div key={g.id} className="row between">
              <label className="check">
                <input type="checkbox" checked={Boolean(row)} onChange={(e) => toggleGroup(g, e.target.checked)} />
                <span>{g.name}</span>
              </label>
              {isOwner && row && m.role !== "employee" && (
                <label className="check small">
                  <input type="checkbox" checked={row.is_leader} onChange={(e) => toggleLeader(g, e.target.checked)} />
                  <span>ръководител</span>
                </label>
              )}
            </div>
          );
        })}

        {m.role !== "owner" && (
          <>
            <div className="section-title" style={{ margin: "4px 0 0" }}>Нова парола</div>
            <div className="row">
              <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Поне 8 символа" />
              <button className="btn small" onClick={() => setPw(randomPassword())} type="button">
                ↻
              </button>
              <button className="btn" onClick={resetPw} disabled={busy}>
                Задай
              </button>
            </div>
          </>
        )}
        {msg && <Alert kind="ok">{msg}</Alert>}
        {err && <Alert kind="bad">{err}</Alert>}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- групи */
function GroupsTab() {
  const { groups, groupMembers, members, isOwner, leaderGroupIds, reload, plan } = useApp();
  const [edit, setEdit] = useState<Group | "new" | null>(null);
  const atLimit = plan ? groups.length >= plan.max_groups : false;

  return (
    <>
      <div className="row between">
        <span className="muted small">
          {groups.length}
          {plan ? ` / ${plan.max_groups}` : ""} групи
        </span>
        <button className="btn primary" onClick={() => setEdit("new")} disabled={atLimit}>
          + Нова група
        </button>
      </div>
      {atLimit && <Alert kind="warn">Достигнат е лимитът на групи за плана „{plan?.name}“.</Alert>}
      <p className="muted small">
        Създайте групи (отдели, смени, обекти) и обединете хората в тях. Човек може да е в няколко групи. Задачите се
        възлагат на група, а ръководителят (★) на групата ги одобрява.
      </p>
      {groups.length === 0 && <Empty icon="👥">Още няма групи. Натиснете „+ Нова група“.</Empty>}
      {groups.map((g) => {
        const rows = groupMembers.filter((x) => x.group_id === g.id);
        const people = rows
          .map((r) => ({ r, m: members.find((m) => m.id === r.membership_id) }))
          .filter((x) => x.m && x.m.active)
          .sort((a, b) => Number(b.r.is_leader) - Number(a.r.is_leader) || a.m!.display_name.localeCompare(b.m!.display_name));
        const can = isOwner || leaderGroupIds.includes(g.id);
        return (
          <button key={g.id} className="task" style={{ textAlign: "left" }} onClick={() => can && setEdit(g)} disabled={!can}>
            <i className="dot" style={{ background: g.color, marginTop: 6 }} />
            <div className="grow stack" style={{ gap: 6 }}>
              <div className="row between">
                <div className="title">{g.name}</div>
                <span className="muted small">{people.length} души</span>
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {people.slice(0, 8).map(({ r, m }) => (
                  <span key={r.membership_id} className="chip">
                    {r.is_leader ? "★ " : ""}
                    {m!.display_name}
                  </span>
                ))}
                {people.length > 8 && <span className="chip">+{people.length - 8}</span>}
                {people.length === 0 && <span className="muted small">Още няма хора – отворете групата и ги добавете.</span>}
              </div>
            </div>
          </button>
        );
      })}
      {edit && (
        <GroupModal
          g={edit === "new" ? null : edit}
          onClose={async (changed) => {
            setEdit(null);
            if (changed) await reload();
          }}
        />
      )}
    </>
  );
}

function GroupModal({ g, onClose }: { g: Group | null; onClose: (changed: boolean) => void }) {
  const { org, me, isOwner, members, groupMembers } = useApp();
  const isNew = !g;
  const current = useMemo(() => (g ? groupMembers.filter((x) => x.group_id === g.id) : []), [g, groupMembers]);
  const [name, setName] = useState(g?.name ?? "");
  const [color, setColor] = useState(g?.color ?? COLORS[0]);
  // избрани хора: id -> ръководител ли е
  const [sel, setSel] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = Object.fromEntries(current.map((c) => [c.membership_id, c.is_leader]));
    if (isNew && me) init[me.id] = true; // създателят става ръководител на новата група
    return init;
  });
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const active = members.filter((m) => m.active);
  const shown = active.filter((m) => m.display_name.toLowerCase().includes(q.trim().toLowerCase()));
  const count = Object.keys(sel).length;
  // ръководител, който не е собственик, не може да се махне сам от групата си (би загубил достъп)
  const locked = (id: string) => !isOwner && id === me?.id;

  const toggle = (id: string) =>
    setSel((s) => {
      const n = { ...s };
      if (id in n) delete n[id];
      else n[id] = false;
      return n;
    });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!org || !me) return;
    setErr("");
    setBusy(true);
    try {
      let gid = g?.id;
      if (g) {
        const { error } = await supabase.from("groups").update({ name: name.trim(), color }).eq("id", g.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("groups").insert({ org_id: org.id, name: name.trim(), color }).select("id").single();
        if (error) throw error;
        gid = data.id as string;
      }

      const before = new Map(current.map((c) => [c.membership_id, c.is_leader]));
      // при нова група създателят вече е добавен автоматично като ръководител
      if (isNew) before.set(me.id, true);

      const add = Object.keys(sel).filter((id) => !before.has(id));
      const remove = [...before.keys()].filter((id) => !(id in sel));
      const leaders = Object.keys(sel).filter((id) => before.has(id) && before.get(id) !== sel[id]);

      if (add.length) {
        const { error } = await supabase
          .from("group_members")
          .insert(add.map((id) => ({ group_id: gid, membership_id: id, org_id: org.id, is_leader: isOwner && sel[id] })));
        if (error) throw error;
      }
      if (remove.length) {
        const { error } = await supabase.from("group_members").delete().eq("group_id", gid).in("membership_id", remove);
        if (error) throw error;
      }
      if (isOwner) {
        for (const id of leaders) {
          const { error } = await supabase.from("group_members").update({ is_leader: sel[id] }).eq("group_id", gid).eq("membership_id", id);
          if (error) throw error;
        }
      }
      onClose(true);
    } catch (e2) {
      setErr(errMsg(e2));
      setBusy(false);
    }
  }

  async function remove() {
    if (!g || !confirm(`Да изтрия ли група „${g.name}“?`)) return;
    const { error } = await supabase.from("groups").delete().eq("id", g.id);
    if (error)
      return setErr(
        error.message.includes("violates foreign key") ? "Групата има задачи. Първо ги изтрийте или преместете." : errMsg(error),
      );
    onClose(true);
  }

  return (
    <Modal title={g ? "Група" : "Нова група"} onClose={() => onClose(false)}>
      <form className="stack" onSubmit={save}>
        <Field label="Име">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="напр. Склад, Смяна 1, Обект Север" />
        </Field>
        <div className="row wrap">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              aria-label={c}
              onClick={() => setColor(c)}
              style={{
                width: 34, height: 34, borderRadius: "50%", background: c, cursor: "pointer",
                border: color === c ? "3px solid var(--text)" : "3px solid transparent",
              }}
            />
          ))}
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="row between">
            <div className="label">Хора в групата ({count})</div>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn ghost small" onClick={() => setSel((s) => ({ ...s, ...Object.fromEntries(shown.map((m) => [m.id, s[m.id] ?? false])) }))}>
                Избери показаните
              </button>
              <button type="button" className="btn ghost small" onClick={() => setSel((s) => Object.fromEntries(Object.entries(s).filter(([id]) => locked(id))))}>
                Изчисти
              </button>
            </div>
          </div>
          {active.length > 6 && <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Търсене по име…" />}
          <div className="stack" style={{ gap: 4, maxHeight: 280, overflowY: "auto" }}>
            {shown.length === 0 && <span className="muted small">Няма намерени хора.</span>}
            {shown.map((m) => {
              const on = m.id in sel;
              const canLead = m.role !== "employee";
              return (
                <div key={m.id} className="row between" style={{ padding: "4px 2px" }}>
                  <label className="check" style={{ alignItems: "center" }}>
                    <input type="checkbox" checked={on} disabled={locked(m.id)} onChange={() => toggle(m.id)} />
                    <span>
                      {m.display_name} <span className="muted small">· {ROLE_LABEL[m.role]}</span>
                    </span>
                  </label>
                  {on && canLead && isOwner && (
                    <label className="check small" title="Ръководителят одобрява задачите на групата">
                      <input type="checkbox" checked={sel[m.id]} onChange={(e) => setSel((s) => ({ ...s, [m.id]: e.target.checked }))} />
                      <span>★ ръководител</span>
                    </label>
                  )}
                  {on && sel[m.id] && !isOwner && <span className="chip">★ ръководител</span>}
                </div>
              );
            })}
          </div>
          <span className="muted small">
            ★ Ръководителят одобрява задачите на групата и не ги получава като изпълнител. Нови хора добавяте от „Хора → + Нов служител“.
          </span>
        </div>

        {err && <Alert kind="bad">{err}</Alert>}
        <button className="btn primary block" disabled={busy}>
          {busy ? "Запис…" : "Запази"}
        </button>
        {g && (
          <button type="button" className="btn danger block" onClick={remove}>
            Изтрий групата
          </button>
        )}
      </form>
    </Modal>
  );
}
