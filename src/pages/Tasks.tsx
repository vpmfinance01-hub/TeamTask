import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase, BUCKET } from "../lib/supabase";
import { useApp } from "../lib/session";
import type { AssignMode, Place, Recurrence, Task, TaskTemplate } from "../lib/types";
import { WD_SHORT, errMsg, uploadFile, uuid, ymd } from "../lib/util";
import { Alert, Empty, Field, Spinner } from "../components/ui";

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Пн … Нд (в базата 0 = неделя)
const REC_LABEL: Record<Recurrence, string> = {
  once: "Еднократна",
  daily: "Всеки ден",
  weekly: "Седмично",
  monthly: "Месечно",
};

function recText(t: Task): string {
  if (t.recurrence === "weekly" && t.recurrence_days?.length)
    return "Седмично: " + DAY_ORDER.filter((d) => t.recurrence_days!.includes(d)).map((d) => WD_SHORT[d]).join(" ");
  return REC_LABEL[t.recurrence];
}

export function TaskList() {
  const { org, groups, members, perm } = useApp();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!org) return;
    supabase
      .from("tasks")
      .select("*")
      .eq("org_id", org.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setErr(errMsg(error));
        setTasks((data as Task[]) ?? []);
      });
  }, [org]);

  if (tasks === null) return <Spinner />;
  const list = tasks.filter((t) => t.active !== showArchived);
  const who = (t: Task) =>
    t.assignee_id
      ? "👤 " + (members.find((m) => m.id === t.assignee_id)?.display_name ?? "?")
      : "👥 " + (groups.find((g) => g.id === t.group_id)?.name ?? "?") + (t.assign_mode === "any" ? " (който първи)" : " (всеки)");

  return (
    <div className="stack">
      <div className="row between">
        <h1>Задачи</h1>
        <div className="row" style={{ gap: 8 }}>
          {perm.qr && (
            <Link className="btn" to="/places">
              Места и QR
            </Link>
          )}
          <Link className="btn primary" to="/tasks/new">
            + Нова
          </Link>
        </div>
      </div>
      <div className="tabs">
        <button className={`tab ${!showArchived ? "active" : ""}`} onClick={() => setShowArchived(false)}>
          Активни
        </button>
        <button className={`tab ${showArchived ? "active" : ""}`} onClick={() => setShowArchived(true)}>
          Архив
        </button>
      </div>
      {err && <Alert kind="bad">{err}</Alert>}
      {list.length === 0 && (
        <Empty icon="📝">{showArchived ? "Няма архивирани задачи." : "Още няма задачи. Създайте първата с „+ Нова“."}</Empty>
      )}
      {list.map((t) => (
        <Link key={t.id} to={`/tasks/${t.id}`} className={`task ${t.priority ? "high" : ""}`}>
          <div className="grow stack" style={{ gap: 4 }}>
            <div className="title">{t.title}</div>
            <div className="row wrap small muted" style={{ gap: 10 }}>
              <span>{recText(t)}</span>
              <span>{who(t)}</span>
              {t.due_time && <span>до {t.due_time.slice(0, 5)}</span>}
              {t.requires_photo && <span>📷</span>}
              {t.requires_note && <span>✍️</span>}
              {t.requires_approval && <span>✔ одобрение</span>}
              {t.steps?.length > 0 && <span>☑ {t.steps.length} стъпки</span>}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

interface Att {
  id: string;
  path: string;
  name: string | null;
}

export function TaskForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const { org, me, isOwner, groups, members, groupMembers, leaderGroupIds, perm } = useApp();
  const isNew = !id || id === "new";
  const [loaded, setLoaded] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [target, setTarget] = useState<"group" | "person">("group");
  const [groupId, setGroupId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [mode, setMode] = useState<AssignMode>("each");
  const [priority, setPriority] = useState(0);
  const [reqNote, setReqNote] = useState(false);
  const [reqPhoto, setReqPhoto] = useState(false);
  const [reqApproval, setReqApproval] = useState(true);
  const [rec, setRec] = useState<Recurrence>("daily");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState(ymd());
  const [end, setEnd] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [active, setActive] = useState(true);
  const [atts, setAtts] = useState<Att[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [stepsRequired, setStepsRequired] = useState(true);
  const [placeId, setPlaceId] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [info, setInfo] = useState("");

  // места (QR) и шаблони – само ако модулите са включени
  useEffect(() => {
    if (!org) return;
    if (perm.qr) supabase.from("places").select("*").eq("org_id", org.id).order("name").then(({ data }) => setPlaces((data as Place[]) ?? []));
    if (perm.checklist) supabase.from("task_templates").select("*").eq("org_id", org.id).order("name").then(({ data }) => setTemplates((data as TaskTemplate[]) ?? []));
  }, [org, perm.qr, perm.checklist]);

  function applyTemplate(tplId: string) {
    const p = templates.find((x) => x.id === tplId)?.payload;
    if (!p) return;
    setTitle(p.title ?? "");
    setDescription(p.description ?? "");
    setInstructions(p.instructions ?? "");
    setPriority(p.priority ?? 0);
    setReqNote(Boolean(p.requires_note));
    setReqPhoto(Boolean(p.requires_photo));
    setReqApproval(p.requires_approval ?? true);
    setRec((p.recurrence as Recurrence) ?? "daily");
    setDays(p.recurrence_days ?? [1, 2, 3, 4, 5]);
    setDueTime(p.due_time?.slice(0, 5) ?? "");
    setSteps(p.steps ?? []);
    setStepsRequired(p.steps_required ?? true);
    setInfo("Шаблонът е приложен – изберете група или човек и запазете.");
  }

  // какво може да избира текущият потребител
  const pickGroups = useMemo(
    () => (isOwner ? groups : groups.filter((g) => leaderGroupIds.includes(g.id))),
    [isOwner, groups, leaderGroupIds],
  );
  const pickPeople = useMemo(() => {
    const active = members.filter((m) => m.active);
    if (isOwner) return active;
    const ids = new Set(groupMembers.filter((gm) => leaderGroupIds.includes(gm.group_id)).map((gm) => gm.membership_id));
    return active.filter((m) => ids.has(m.id));
  }, [isOwner, members, groupMembers, leaderGroupIds]);

  const load = useCallback(async () => {
    if (isNew) {
      if (!groupId && pickGroups[0]) setGroupId(pickGroups[0].id);
      return;
    }
    const [t, a] = await Promise.all([
      supabase.from("tasks").select("*").eq("id", id).maybeSingle(),
      supabase.from("task_attachments").select("id, path, name").eq("task_id", id),
    ]);
    const task = t.data as Task | null;
    if (!task) return setErr("Задачата не е намерена.");
    setTitle(task.title);
    setDescription(task.description ?? "");
    setInstructions(task.instructions ?? "");
    setTarget(task.assignee_id ? "person" : "group");
    setGroupId(task.group_id ?? "");
    setAssigneeId(task.assignee_id ?? "");
    setMode(task.assign_mode);
    setPriority(task.priority);
    setReqNote(task.requires_note);
    setReqPhoto(task.requires_photo);
    setReqApproval(task.requires_approval);
    setRec(task.recurrence);
    setDays(task.recurrence_days ?? []);
    setStart(task.start_date);
    setEnd(task.end_date ?? "");
    setDueTime(task.due_time?.slice(0, 5) ?? "");
    setActive(task.active);
    setSteps(task.steps ?? []);
    setStepsRequired(task.steps_required ?? true);
    setPlaceId(task.place_id ?? "");
    setAtts((a.data as Att[]) ?? []);
    setLoaded(true);
  }, [id, isNew, groupId, pickGroups]);

  useEffect(() => {
    load();
  }, [load]);

  async function removeAtt(a: Att) {
    await supabase.storage.from(BUCKET).remove([a.path]);
    await supabase.from("task_attachments").delete().eq("id", a.id);
    setAtts((x) => x.filter((y) => y.id !== a.id));
  }

  /** Данните на формата като ред от таблицата „tasks“. */
  function buildRow() {
    return {
      org_id: org!.id,
      title: title.trim(),
      description: description.trim() || null,
      instructions: instructions.trim() || null,
      group_id: target === "group" ? groupId : null,
      assignee_id: target === "person" ? assigneeId : null,
      assign_mode: target === "group" ? mode : "each",
      priority,
      requires_note: reqNote,
      requires_photo: reqPhoto,
      requires_approval: reqApproval,
      recurrence: rec,
      recurrence_days: rec === "weekly" ? days : null,
      start_date: start,
      end_date: rec === "once" ? null : end || null,
      due_time: dueTime || null,
      active,
      steps: perm.checklist ? steps.map((s) => s.trim()).filter(Boolean) : [],
      steps_required: stepsRequired,
      place_id: perm.qr && placeId ? placeId : null,
    };
  }

  function validate(): string {
    if (target === "group" && !groupId) return "Изберете група.";
    if (target === "person" && !assigneeId) return "Изберете служител.";
    if (rec === "weekly" && days.length === 0) return "Изберете поне един ден от седмицата.";
    return "";
  }

  async function saveAsTemplate() {
    if (!org) return;
    setErr("");
    setInfo("");
    if (title.trim().length < 2) return setErr("Първо въведете заглавие на задачата.");
    const r = buildRow();
    const payload = {
      title: r.title, description: r.description, instructions: r.instructions, priority: r.priority,
      requires_note: r.requires_note, requires_photo: r.requires_photo, requires_approval: r.requires_approval,
      recurrence: r.recurrence, recurrence_days: r.recurrence_days, due_time: r.due_time, steps: r.steps, steps_required: r.steps_required,
    };
    const { data, error } = await supabase.from("task_templates").insert({ org_id: org.id, name: r.title, payload }).select("*").single();
    if (error) return setErr(errMsg(error));
    setTemplates((x) => [...x, data as TaskTemplate]);
    setInfo(`Шаблонът „${r.title}“ е запазен – ще го намерите в началото на формата „Нова задача“.`);
  }

  async function duplicate() {
    if (!org) return;
    setErr("");
    const v = validate();
    if (v) return setErr(v);
    const r = buildRow();
    const { data, error } = await supabase.from("tasks").insert({ ...r, title: `${r.title} (копие)` }).select("id").single();
    if (error) return setErr(errMsg(error));
    nav(`/tasks/${data.id}`, { replace: true });
    setLoaded(false);
    setInfo("Направено е копие – редактирайте го.");
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!org || !me) return;
    setErr("");
    const v = validate();
    if (v) return setErr(v);
    setBusy(true);
    const row = buildRow();
    try {
      let taskId = id!;
      if (isNew) {
        const { data, error } = await supabase.from("tasks").insert(row).select("id").single();
        if (error) throw error;
        taskId = data.id;
      } else {
        const { error } = await supabase.from("tasks").update(row).eq("id", id);
        if (error) throw error;
      }
      for (const f of newFiles) {
        const ext = (f.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
        const path = `${org.id}/instructions/${taskId}/${uuid()}.${ext}`;
        await uploadFile(path, f, f.type);
        const { error } = await supabase.from("task_attachments").insert({ org_id: org.id, task_id: taskId, path, name: f.name });
        if (error) throw error;
      }
      nav("/tasks", { replace: true });
    } catch (e2) {
      setErr(errMsg(e2));
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Да изтрия ли задачата заедно с цялата ѝ история? По-добре я архивирайте.")) return;
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) return setErr(errMsg(error));
    nav("/tasks", { replace: true });
  }

  if (!loaded) return err ? <Alert kind="bad">{err}</Alert> : <Spinner />;
  if (pickGroups.length === 0 && pickPeople.length === 0)
    return <Alert kind="warn">Първо създайте група или добавете служители (меню „Хора“).</Alert>;

  const toggleDay = (d: number) => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]));

  return (
    <form className="stack" onSubmit={save}>
      <button type="button" className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => nav(-1)}>
        ← Назад
      </button>
      <h1>{isNew ? "Нова задача" : "Редакция на задача"}</h1>
      {info && <Alert kind="ok">{info}</Alert>}

      {isNew && perm.checklist && templates.length > 0 && (
        <div className="card stack">
          <Field label="Започни от шаблон" hint="Попълва формата с готови стъпки и настройки; после избирате за кого е.">
            <select value="" onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">— без шаблон —</option>
              {templates.map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {tp.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <div className="card stack">
        <Field label="Заглавие">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={120} />
        </Field>
        <Field label="Кратко описание">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 64 }} />
        </Field>
        <Field label="Инструкции (стъпка по стъпка)" hint="Служителят ги вижда при отваряне на задачата.">
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={"1. Изнесете боклука\n2. Измийте пода\n3. Снимайте резултата"}
          />
        </Field>
        <div className="stack" style={{ gap: 8 }}>
          <div className="label">Снимки / файлове към инструкцията</div>
          {atts.map((a) => (
            <div key={a.id} className="row between">
              <span className="small">📎 {a.name ?? a.path.split("/").pop()}</span>
              <button type="button" className="btn danger small" onClick={() => removeAtt(a)}>
                Махни
              </button>
            </div>
          ))}
          {newFiles.map((f, i) => (
            <div key={i} className="row between">
              <span className="small">🆕 {f.name}</span>
              <button type="button" className="btn small" onClick={() => setNewFiles((x) => x.filter((_, j) => j !== i))}>
                Махни
              </button>
            </div>
          ))}
          <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => fileRef.current?.click()}>
            + Добави файл
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => {
              setNewFiles((x) => [...x, ...Array.from(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {perm.checklist && (
        <div className="card stack">
          <h2>Чеклист със стъпки</h2>
          <p className="muted small">Служителят отмята всяка стъпка в задачата и ви показва докъде е стигнал.</p>
          {steps.map((s, i) => (
            <div key={i} className="row" style={{ gap: 6 }}>
              <span className="muted small" style={{ width: 22, textAlign: "right" }}>
                {i + 1}.
              </span>
              <input
                type="text"
                value={s}
                onChange={(e) => setSteps((x) => x.map((y, j) => (j === i ? e.target.value : y)))}
                placeholder="напр. Измийте пода"
                aria-label={`Стъпка ${i + 1}`}
              />
              <button type="button" className="btn small" disabled={i === 0} onClick={() => setSteps((x) => x.map((_, j) => (j === i - 1 ? x[i] : j === i ? x[i - 1] : x[j])))} aria-label="Нагоре">
                ↑
              </button>
              <button type="button" className="btn small" disabled={i === steps.length - 1} onClick={() => setSteps((x) => x.map((_, j) => (j === i + 1 ? x[i] : j === i ? x[i + 1] : x[j])))} aria-label="Надолу">
                ↓
              </button>
              <button type="button" className="btn danger small" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))} aria-label="Махни стъпката">
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setSteps((x) => [...x, ""])}>
            + Добави стъпка
          </button>
          {steps.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={stepsRequired} onChange={(e) => setStepsRequired(e.target.checked)} />
              <span>Всички стъпки са задължителни (без тях задачата не може да се изпрати)</span>
            </label>
          )}
        </div>
      )}

      <div className="card stack">
        <h2>Кой я изпълнява</h2>
        <div className="tabs">
          <button type="button" className={`tab ${target === "group" ? "active" : ""}`} onClick={() => setTarget("group")}>
            Група
          </button>
          <button type="button" className={`tab ${target === "person" ? "active" : ""}`} onClick={() => setTarget("person")}>
            Конкретен човек
          </button>
        </div>
        {target === "group" ? (
          <>
            <Field label="Група">
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                {pickGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Как се разпределя">
              <select value={mode} onChange={(e) => setMode(e.target.value as AssignMode)}>
                <option value="each">Всеки от групата я изпълнява</option>
                <option value="any">Достатъчно е един (който първи я вземе)</option>
              </select>
            </Field>
          </>
        ) : (
          <Field label="Служител">
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">— изберете —</option>
              {pickPeople.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {perm.qr && (
          <Field label="Място (QR код)" hint={places.length === 0 ? "Още няма места – създайте ги от „Задачи → Места и QR“." : "При сканиране на QR кода на мястото служителят вижда тези задачи."}>
            <select value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
              <option value="">— без място —</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <div className="card stack">
        <h2>Кога</h2>
        <Field label="Повторение">
          <select value={rec} onChange={(e) => setRec(e.target.value as Recurrence)}>
            {(Object.keys(REC_LABEL) as Recurrence[]).map((k) => (
              <option key={k} value={k}>
                {REC_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        {rec === "weekly" && (
          <div className="dayrow">
            {DAY_ORDER.map((d) => (
              <button type="button" key={d} className={`tab ${days.includes(d) ? "active" : ""}`} onClick={() => toggleDay(d)}>
                {WD_SHORT[d]}
              </button>
            ))}
          </div>
        )}
        <div className="row wrap">
          <div className="field grow">
            <label>{rec === "once" ? "Дата" : "От дата"}</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
          </div>
          {rec !== "once" && (
            <div className="field grow">
              <label>До дата (по желание)</label>
              <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
            </div>
          )}
          <div className="field grow">
            <label>Срок – час</label>
            <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </div>
        </div>
        {rec === "monthly" && <span className="muted small">Повтаря се на същото число от месеца като началната дата.</span>}
      </div>

      <div className="card stack">
        <h2>Потвърждение</h2>
        <label className="check">
          <input type="checkbox" checked={reqPhoto} onChange={(e) => setReqPhoto(e.target.checked)} />
          <span>Задължителна снимка</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={reqNote} onChange={(e) => setReqNote(e.target.checked)} />
          <span>Задължителна текстова бележка</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={reqApproval} onChange={(e) => setReqApproval(e.target.checked)} />
          <span>Ръководителят потвърждава изпълнението</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={priority === 1} onChange={(e) => setPriority(e.target.checked ? 1 : 0)} />
          <span>Спешна (отбелязва се в червено)</span>
        </label>
        {!isNew && (
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Активна (махнете отметката, за да я архивирате)</span>
          </label>
        )}
      </div>

      {err && <Alert kind="bad">{err}</Alert>}
      <button className="btn primary block" disabled={busy}>
        {busy ? "Запис…" : "Запази"}
      </button>
      {perm.checklist && (
        <div className="row wrap" style={{ gap: 8 }}>
          <button type="button" className="btn grow" onClick={saveAsTemplate}>
            ★ Запази като шаблон
          </button>
          {!isNew && (
            <button type="button" className="btn grow" onClick={duplicate}>
              ⧉ Дублирай
            </button>
          )}
        </div>
      )}
      {!isNew && (
        <button type="button" className="btn danger block" onClick={remove}>
          Изтрий задачата
        </button>
      )}
    </form>
  );
}
