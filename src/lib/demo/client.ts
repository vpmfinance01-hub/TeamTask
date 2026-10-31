/* eslint-disable @typescript-eslint/no-explicit-any */
// Демо режим: малка имитация на Supabase (auth, таблици, RPC, storage, функции) в localStorage.
// Включва се автоматично, когато няма VITE_SUPABASE_URL. Логиката повтаря SQL функциите от миграцията.

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const KEY = "teamtasks.demo.v3"; // v3: стъпки, шаблони, места/QR, коментари
const FILES_KEY = "teamtasks.demo.files.v3";
const SESSION_KEY = "teamtasks.demo.session";
export const DEMO_PASSWORD = "demo1234";

// ------------------------------------------------------------ дати и помощни
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

class DemoError extends Error {}
const fail = (m: string): never => {
  throw new DemoError(m);
};

// ------------------------------------------------------------ хранилище
let files: Record<string, string> = {};
try {
  files = JSON.parse(localStorage.getItem(FILES_KEY) ?? "{}");
} catch {
  files = {};
}
function saveFiles() {
  try {
    localStorage.setItem(FILES_KEY, JSON.stringify(files));
  } catch {
    /* квота – снимките остават само в тази сесия */
  }
}

let db: Tables = {} as Tables; // зарежда се в края на файла (след като константите са инициализирани)
// таблици, добавени след първата версия на демото (за вече запазени данни в браузъра)
const EXTRA_TABLES = [
  "notification_prefs", "org_notification_settings", "notification_outbox",
  "org_settings", "group_settings", "shift_types", "shifts", "time_entries",
  "places", "task_templates", "task_comments",
];

function load(): Tables {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const t: Tables = JSON.parse(raw);
      for (const k of EXTRA_TABLES) t[k] ??= [];
      return t;
    }
  } catch {
    /* ignore */
  }
  return seed();
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* ignore */
  }
}

export function resetDemo() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(FILES_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  files = {};
  db = seed();
  notify("SIGNED_OUT", null);
}

// ------------------------------------------------------------ сесия
const listeners = new Set<(e: string, s: any) => void>();
// сесията е по раздели (sessionStorage): в два раздела може да сте едновременно ръководител и служител
function currentUid(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function sessionFor(userId: string | null): any {
  if (!userId) return null;
  const u = db.users.find((x) => x.id === userId);
  if (!u) return null;
  return {
    access_token: "demo",
    refresh_token: "demo",
    expires_in: 3600,
    token_type: "bearer",
    user: { id: u.id, email: u.email, user_metadata: u.metadata ?? {}, app_metadata: {}, aud: "authenticated", created_at: u.created_at },
  };
}
function setSession(userId: string | null) {
  try {
    if (userId) sessionStorage.setItem(SESSION_KEY, userId);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  notify(userId ? "SIGNED_IN" : "SIGNED_OUT", sessionFor(userId));
}
function notify(e: string, s: any) {
  listeners.forEach((l) => setTimeout(() => l(e, s), 0));
}

// ------------------------------------------------------------ права (копие на SQL помощните функции)
const member = (id: string | null) => db.memberships.find((m) => m.id === id);
const myMember = (org: string) => db.memberships.find((m) => m.org_id === org && m.user_id === currentUid() && m.active);
const roleIn = (org: string): string | null => myMember(org)?.role ?? null;
const isManager = (org: string) => ["owner", "manager"].includes(roleIn(org) ?? "");
const inGroup = (gid: string | null) => {
  const me = currentUid();
  return Boolean(gid) && db.group_members.some((gm) => gm.group_id === gid && member(gm.membership_id)?.user_id === me && member(gm.membership_id)?.active);
};
const leadsGroup = (gid: string | null) => {
  const me = currentUid();
  return Boolean(gid) && db.group_members.some((gm) => gm.group_id === gid && gm.is_leader && member(gm.membership_id)?.user_id === me && member(gm.membership_id)?.active);
};
const managesGroup = (org: string, gid: string | null) => roleIn(org) === "owner" || leadsGroup(gid);
const managesMember = (org: string, mid: string | null) =>
  roleIn(org) === "owner" ||
  db.group_members.some((t) => t.membership_id === mid && db.group_members.some((l) => l.group_id === t.group_id && l.is_leader && member(l.membership_id)?.user_id === currentUid()));

function hasAccess(org: Row): boolean {
  if (org.sub_status === "active") return true;
  if (org.sub_status === "trialing") return new Date(org.trial_ends_at) > new Date();
  if (org.sub_status === "past_due") return new Date(org.current_period_end ?? Date.now()).getTime() + 7 * 864e5 > Date.now();
  return false;
}
const orgHasAccess = (id: string) => {
  const o = db.organizations.find((x) => x.id === id);
  return Boolean(o && hasAccess(o));
};

/** Какво би върнала RLS политиката на редовете (за tasks и occurrences). */
function visible(table: string, r: Row): boolean {
  if (table === "shifts" || table === "time_entries") {
    const who = myMember(r.org_id);
    if (!who) return false;
    if (who.role !== "employee") return true;
    // служителят вижда само публикувани смени и само своите записи за часове
    return table === "shifts" ? Boolean(r.published) : r.membership_id === who.id;
  }
  if (table !== "tasks" && table !== "occurrences") return true;
  const me = myMember(r.org_id);
  if (!me) return false;
  if (me.role === "owner") return true;
  const mine = table === "tasks" ? r.assignee_id === me.id || (r.group_id && inGroup(r.group_id)) : r.assignee_id === me.id || (r.assignee_id === null && r.group_id && inGroup(r.group_id));
  if (mine) return true;
  if (me.role === "manager") {
    if (table === "tasks" && r.created_by === currentUid()) return true;
    return Boolean(leadsGroup(r.group_id) || (r.assignee_id && managesMember(r.org_id, r.assignee_id)));
  }
  return false;
}

// ------------------------------------------------------------ релации за вградени заявки
const REL: Record<string, Record<string, { table: string; fk: string }>> = {
  occurrences: {
    tasks: { table: "tasks", fk: "task_id" },
    groups: { table: "groups", fk: "group_id" },
    assignee: { table: "memberships", fk: "assignee_id" },
    completer: { table: "memberships", fk: "completed_by" },
  },
  memberships: { organizations: { table: "organizations", fk: "org_id" } },
};

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function project(table: string, row: Row, cols: string): Row {
  const res: Row = {};
  for (const raw of splitTop(cols)) {
    const it = raw.trim();
    if (!it) continue;
    const m = it.match(/^(?:(\w+):)?(\w+)(?:!\w+)?\(([\s\S]*)\)$/);
    if (m) {
      const name = m[1] ?? m[2];
      const rel = REL[table]?.[name];
      const target = rel ? db[rel.table].find((x) => x.id === row[rel.fk]) : undefined;
      res[name] = target ? project(rel!.table, target, m[3]) : null;
    } else if (it === "*") Object.assign(res, row);
    else res[it] = row[it] ?? null;
  }
  return clone(res);
}

// ------------------------------------------------------------ по подразбиране + тригери
const DEFAULTS: Record<string, () => Row> = {
  organizations: () => ({
    plan_key: "team", sub_status: "trialing", trial_ends_at: new Date(Date.now() + 14 * 864e5).toISOString(),
    current_period_end: null, stripe_customer_id: null, stripe_subscription_id: null,
  }),
  memberships: () => ({ role: "employee", active: true, username: null }),
  groups: () => ({ color: "#2563eb" }),
  group_members: () => ({ is_leader: false }),
  tasks: () => ({
    description: null, instructions: null, group_id: null, assignee_id: null, assign_mode: "each", priority: 0,
    requires_note: false, requires_photo: false, requires_approval: true, recurrence: "once", recurrence_days: null,
    start_date: ymd(), end_date: null, due_time: null, active: true,
    steps: [], steps_required: true, place_id: null,
  }),
  task_attachments: () => ({ name: null }),
  places: () => ({ group_id: null }),
  task_templates: () => ({ payload: {} }),
  task_comments: () => ({}),
  org_settings: () => ({ features: {}, languages: ["bg"] }),
  group_settings: () => ({ visibility: {} }),
  shift_types: () => ({ color: "#1f4d3f", break_min: 30 }),
  shifts: () => ({ kind: "work", shift_type_id: null, start_time: null, end_time: null, break_min: 0, note: null, published: false, group_id: null }),
  time_entries: () => ({ shift_id: null, ended_at: null, break_min: 0, method: "self", note: null, approved: false }),
  occurrences: () => ({
    status: "pending", group_id: null, assignee_id: null, completed_by: null, completed_at: null, note: null,
    reviewed_by: null, reviewed_at: null, review_comment: null, steps_done: [],
  }),
};

const planOf = (orgId: string) => db.plans.find((p) => p.key === db.organizations.find((o) => o.id === orgId)?.plan_key)!;

function beforeInsert(table: string, row: Row) {
  if (table === "memberships" && row.active) {
    const cnt = db.memberships.filter((m) => m.org_id === row.org_id && m.active).length;
    if (cnt >= planOf(row.org_id).max_members) fail("member_limit");
  }
  if (table === "groups") {
    if (db.groups.filter((g) => g.org_id === row.org_id).length >= planOf(row.org_id).max_groups) fail("group_limit");
  }
  if (table === "group_members") {
    const g = db.groups.find((x) => x.id === row.group_id);
    const m = member(row.membership_id);
    if (!g || !m || g.org_id !== m.org_id) fail("org_mismatch");
    row.org_id = g!.org_id;
    if (db.group_members.some((x) => x.group_id === row.group_id && x.membership_id === row.membership_id))
      fail('duplicate key value violates unique constraint "group_members_pkey"');
  }
  if (table === "tasks") {
    row.created_by = row.created_by ?? currentUid();
    if (!row.group_id && !row.assignee_id) fail("new row for relation \"tasks\" violates check constraint");
    if (!orgHasAccess(row.org_id)) fail("new row violates row-level security policy for table \"tasks\"");
  }
  if (table === "organizations" && db.organizations.some((o) => o.code === row.code))
    fail('duplicate key value violates unique constraint "organizations_code_key"');
  if (table === "memberships" && row.username && db.memberships.some((m) => m.org_id === row.org_id && m.username === row.username))
    fail('duplicate key value violates unique constraint "memberships_org_id_username_key"');
}

function afterInsert(table: string, row: Row) {
  if (table === "groups") {
    const me = myMember(row.org_id);
    if (me) db.group_members.push({ group_id: row.id, membership_id: me.id, org_id: row.org_id, is_leader: true });
  }
  // служителят получава задачата веднага (като SQL тригерите в миграцията)
  if (table === "tasks" || table === "group_members") ensureOccurrences(row.org_id, ymd(), ymd(), true);
}

// ------------------------------------------------------------ заявки (имитация на PostgREST)
class Query implements PromiseLike<any> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private preds: ((r: Row) => boolean)[] = [];
  private cols = "*";
  private head = false;
  private order_?: { col: string; asc: boolean };
  private lim?: number;
  private payload: any;
  private single_: "one" | "maybe" | null = null;
  private returning = false;

  constructor(private table: string) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    if (this.op !== "select") this.returning = true;
    this.cols = cols;
    this.head = Boolean(opts?.head);
    return this;
  }
  insert(p: any) { this.op = "insert"; this.payload = p; return this; }
  update(p: any) { this.op = "update"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: any) { this.preds.push((r) => (r[c] ?? null) === v); return this; }
  neq(c: string, v: any) { this.preds.push((r) => (r[c] ?? null) !== v); return this; }
  lt(c: string, v: any) { this.preds.push((r) => r[c] < v); return this; }
  lte(c: string, v: any) { this.preds.push((r) => r[c] <= v); return this; }
  gt(c: string, v: any) { this.preds.push((r) => r[c] > v); return this; }
  gte(c: string, v: any) { this.preds.push((r) => r[c] >= v); return this; }
  in(c: string, v: any[]) { this.preds.push((r) => v.includes(r[c])); return this; }
  is(c: string, v: any) { this.preds.push((r) => (r[c] ?? null) === v); return this; }
  or(expr: string) {
    const parts = expr.split(",").map((p) => {
      const [col, op, ...rest] = p.split(".");
      const val = rest.join(".");
      return (r: Row) => (op === "is" ? (r[col] ?? null) === (val === "null" ? null : val) : op === "neq" ? r[col] !== val : r[col] === val);
    });
    this.preds.push((r) => parts.some((f) => f(r)));
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) { this.order_ = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.single_ = "one"; return this; }
  maybeSingle() { this.single_ = "maybe"; return this; }

  then<A = any, B = never>(ok?: ((v: any) => A | PromiseLike<A>) | null, no?: ((e: any) => B | PromiseLike<B>) | null) {
    let result: any;
    try {
      result = this.exec();
    } catch (e: any) {
      result = { data: null, error: { message: e?.message ?? String(e) }, count: null };
    }
    return Promise.resolve(result).then(ok, no);
  }

  private shape(rows: Row[], count: number | null) {
    const out = rows.map((r) => project(this.table, r, this.cols));
    if (this.single_) {
      if (out.length > 1 || (this.single_ === "one" && out.length === 0))
        return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" }, count };
      return { data: out[0] ?? null, error: null, count };
    }
    return { data: out, error: null, count };
  }

  private exec(): any {
    const t = this.table;
    const all = db[t] ?? fail(`unknown table ${t}`);
    if (this.op === "select") {
      let rows = all.filter((r) => visible(t, r) && this.preds.every((p) => p(r)));
      if (this.order_) {
        const { col, asc } = this.order_;
        rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
      }
      const count = rows.length;
      if (this.lim) rows = rows.slice(0, this.lim);
      if (this.head) return { data: null, error: null, count };
      return this.shape(rows, count);
    }

    if (this.op === "insert") {
      const list: Row[] = Array.isArray(this.payload) ? this.payload : [this.payload];
      const created: Row[] = [];
      for (const p of list) {
        const row: Row = { ...(t === "group_members" || t === "plans" ? {} : { id: uid(), created_at: nowIso() }), ...(DEFAULTS[t]?.() ?? {}), ...p };
        beforeInsert(t, row);
        db[t].push(row);
        afterInsert(t, row);
        created.push(row);
      }
      save();
      return this.returning ? this.shape(created, null) : { data: null, error: null, count: null };
    }

    const targets = all.filter((r) => visible(t, r) && this.preds.every((p) => p(r)));
    if (this.op === "update") {
      for (const r of targets) Object.assign(r, this.payload);
      if (t === "tasks") new Set(targets.map((r) => r.org_id)).forEach((o) => ensureOccurrences(o, ymd(), ymd(), true));
      save();
      return this.returning ? this.shape(targets, null) : { data: null, error: null, count: null };
    }

    // delete
    for (const r of targets) {
      if (t === "groups" && db.tasks.some((x) => x.group_id === r.id))
        fail('update or delete on table "groups" violates foreign key constraint "tasks_group_id_fkey"');
      if (t === "tasks") {
        db.occurrences.filter((o) => o.task_id === r.id).forEach((o) => (db.occurrence_photos = db.occurrence_photos.filter((p) => p.occurrence_id !== o.id)));
        db.occurrences = db.occurrences.filter((o) => o.task_id !== r.id);
        db.task_attachments = db.task_attachments.filter((a) => a.task_id !== r.id);
      }
      if (t === "groups") {
        db.group_members = db.group_members.filter((g) => g.group_id !== r.id);
        db.occurrences.forEach((o) => o.group_id === r.id && (o.group_id = null));
      }
    }
    db[t] = db[t].filter((r) => !targets.includes(r));
    save();
    return { data: null, error: null, count: null };
  }
}

// ------------------------------------------------------------ RPC (порт на SQL функциите)
function matchesDay(t: Row, d: string): boolean {
  if (t.recurrence === "once") return d === t.start_date;
  if (t.recurrence === "daily") return true;
  if (t.recurrence === "weekly") return (t.recurrence_days ?? [parse(t.start_date).getDay()]).includes(parse(d).getDay());
  if (t.recurrence === "monthly") {
    const dd = parse(d);
    const last = new Date(dd.getFullYear(), dd.getMonth() + 1, 0).getDate();
    return dd.getDate() === Math.min(parse(t.start_date).getDate(), last);
  }
  return false;
}

function ensureOccurrences(org: string, from: string, to: string, trusted = false) {
  if (!trusted) {
    if (!myMember(org)) fail("not_member");
    if (to < from || (parse(to).getTime() - parse(from).getTime()) / 864e5 > 62) fail("invalid_range");
    if (!orgHasAccess(org)) return;
  }
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const t of db.tasks.filter((x) => x.org_id === org && x.active)) {
      if (d < t.start_date || (t.end_date && d > t.end_date) || !matchesDay(t, d)) continue;
      let targets: (string | null)[];
      if (t.assignee_id) targets = member(t.assignee_id)?.active ? [t.assignee_id] : [];
      else if (t.assign_mode === "each")
        targets = db.group_members.filter((g) => g.group_id === t.group_id && !g.is_leader && member(g.membership_id)?.active).map((g) => g.membership_id);
      else targets = [null];
      for (const a of targets) {
        if (db.occurrences.some((o) => o.task_id === t.id && o.due_date === d && (o.assignee_id ?? null) === a)) continue;
        db.occurrences.push({ id: uid(), created_at: nowIso(), org_id: org, task_id: t.id, due_date: d, ...DEFAULTS.occurrences(), group_id: t.group_id, assignee_id: a });
      }
    }
  }
  save();
}

function submitOccurrence(id: string, note: string, photos: string[]) {
  const o = db.occurrences.find((x) => x.id === id) ?? fail("not_found");
  const me = myMember(o.org_id) ?? fail("not_member");
  if (!orgHasAccess(o.org_id)) fail("subscription_inactive");
  const t = db.tasks.find((x) => x.id === o.task_id)!;
  if (o.assignee_id !== me.id && !(o.assignee_id === null && o.group_id && inGroup(o.group_id))) fail("not_allowed");
  if (!["pending", "rejected"].includes(o.status)) fail("already_submitted");
  for (const p of photos) if (!p.startsWith(`${o.org_id}/proof/`)) fail("not_allowed");
  const n = db.occurrence_photos.filter((p) => p.occurrence_id === o.id).length + photos.length;
  if (t.requires_photo && n === 0) fail("photo_required");
  if (t.requires_note && !(note ?? "").trim()) fail("note_required");
  if (t.steps?.length && t.steps_required && t.steps.some((_: string, i: number) => !o.steps_done?.[i])) fail("steps_required");
  const status = t.requires_approval ? "submitted" : "approved";
  for (const path of photos) db.occurrence_photos.push({ id: uid(), occurrence_id: o.id, org_id: o.org_id, path, created_at: nowIso() });
  Object.assign(o, {
    status, assignee_id: me.id, completed_by: me.id, completed_at: nowIso(), note: (note ?? "").trim() || null,
    reviewed_by: null, reviewed_at: null, review_comment: null,
  });
  save();
  return status;
}

/** Изпълнителят отмята стъпките на чеклиста (докато задачата не е изпратена). */
function setOccurrenceSteps(id: string, done: boolean[]) {
  const o = db.occurrences.find((x) => x.id === id) ?? fail("not_found");
  const me = myMember(o.org_id) ?? fail("not_member");
  if (o.assignee_id !== me.id && !(o.assignee_id === null && o.group_id && inGroup(o.group_id))) fail("not_allowed");
  if (!["pending", "rejected"].includes(o.status)) fail("already_submitted");
  const t = db.tasks.find((x) => x.id === o.task_id)!;
  o.steps_done = (t.steps ?? []).map((_: string, i: number) => Boolean(done?.[i]));
  save();
}

function reviewOccurrence(id: string, approve: boolean, comment: string | null) {
  const o = db.occurrences.find((x) => x.id === id) ?? fail("not_found");
  const me = myMember(o.org_id);
  if (!me || !isManager(o.org_id)) fail("not_allowed");
  if (!(managesGroup(o.org_id, o.group_id) || (o.completed_by && managesMember(o.org_id, o.completed_by)))) fail("not_allowed");
  if (!orgHasAccess(o.org_id)) fail("subscription_inactive");
  if (o.status !== "submitted") fail("not_submitted");
  if (o.completed_by === me!.id && me!.role !== "owner") fail("cannot_review_own");
  if (!approve && !(comment ?? "").trim()) fail("comment_required");
  Object.assign(o, { status: approve ? "approved" : "rejected", reviewed_by: me!.id, reviewed_at: nowIso(), review_comment: (comment ?? "").trim() || null });
  save();
}

function createOrganization(name: string, code: string, displayName: string) {
  const u = currentUid() ?? fail("not_authenticated");
  const c = code.trim().toLowerCase();
  if (!/^[a-z0-9]{3,20}$/.test(c)) fail("Невалиден код на фирмата.");
  const org: Row = { id: uid(), created_at: nowIso(), name: name.trim(), code: c, owner_id: u, ...DEFAULTS.organizations() };
  beforeInsert("organizations", org);
  db.organizations.push(org);
  db.memberships.push({ id: uid(), created_at: nowIso(), org_id: org.id, user_id: u, role: "owner", display_name: displayName.trim(), username: null, active: true });
  const g: Row = { id: uid(), created_at: nowIso(), org_id: org.id, name: "Общи", ...DEFAULTS.groups() };
  db.groups.push(g);
  afterInsert("groups", g);
  save();
  return org.id;
}

function updateMember(id: string, name: string, active: boolean, role: string) {
  const m = member(id) ?? fail("not_found");
  if (roleIn(m!.org_id) !== "owner") fail("not_allowed");
  if (m!.role === "owner" && (role !== "owner" || !active)) fail("cannot_change_owner");
  if (role === "owner" && m!.role !== "owner") fail("cannot_change_owner");
  if (active && !m!.active && db.memberships.filter((x) => x.org_id === m!.org_id && x.active).length >= planOf(m!.org_id).max_members) fail("member_limit");
  Object.assign(m!, { display_name: name.trim(), active, role });
  save();
}

function rpc(name: string, a: any): any {
  switch (name) {
    case "ensure_occurrences": return ensureOccurrences(a.p_org, a.p_from, a.p_to);
    case "submit_occurrence": return submitOccurrence(a.p_id, a.p_note, a.p_photos ?? []);
    case "set_occurrence_steps": return setOccurrenceSteps(a.p_id, a.p_done ?? []);
    case "review_occurrence": return reviewOccurrence(a.p_id, a.p_approve, a.p_comment ?? null);
    case "create_organization": return createOrganization(a.p_name, a.p_code, a.p_display_name);
    case "app_update_member": return updateMember(a.p_member, a.p_display_name, a.p_active, a.p_role);
    case "app_role": return roleIn(a.p_org);
    case "app_leads_group": return leadsGroup(a.p_group);
    case "app_manages_member": return managesMember(a.p_org, a.p_member);
    case "app_has_access": return orgHasAccess(a.p_org);
    default: return fail(`unknown rpc ${name}`);
  }
}

// ------------------------------------------------------------ „Edge функции“
const STAFF = "staff.teamtasks.app";
function fnErr(code: string) {
  return { data: null, error: Object.assign(new Error(code), { context: { json: async () => ({ error: code }) } }) };
}

function invokeFn(name: string, body: any): any {
  try {
    if (name === "create-member") {
      const org = db.organizations.find((o) => o.id === body.org_id) ?? fail("org_not_found");
      const role = roleIn(body.org_id);
      if (role !== "owner" && role !== "manager") return fnErr("not_allowed");
      const groups: string[] = body.group_ids ?? [];
      if (role === "manager") {
        if (body.role && body.role !== "employee") return fnErr("not_allowed");
        if (!groups.length) return fnErr("group_required");
        if (!groups.every((g) => leadsGroup(g))) return fnErr("not_allowed");
      }
      if ((body.password ?? "").length < 8) return fnErr("weak_password");
      if (!orgHasAccess(body.org_id)) return fnErr("subscription_inactive");
      const username = (body.username ?? "").trim().toLowerCase();
      const email = (body.email ?? "").trim().toLowerCase();
      if (!email && !/^[a-z0-9._-]{2,30}$/.test(username)) return fnErr("bad_username");
      const authEmail = email || `${username}@${org!.code}.${STAFF}`;
      if (db.users.some((u) => u.email === authEmail)) return fnErr("user_exists");
      if (db.memberships.filter((m) => m.org_id === body.org_id && m.active).length >= planOf(body.org_id).max_members) return fnErr("member_limit");
      const userId = uid();
      db.users.push({ id: userId, email: authEmail, password: body.password, metadata: { display_name: body.display_name }, created_at: nowIso() });
      const m = { id: uid(), created_at: nowIso(), org_id: body.org_id, user_id: userId, role: body.role ?? "employee", display_name: body.display_name.trim(), username: email ? null : username, active: true };
      db.memberships.push(m);
      groups.forEach((g) => db.group_members.push({ group_id: g, membership_id: m.id, org_id: body.org_id, is_leader: m.role === "manager" }));
      ensureOccurrences(body.org_id, ymd(), ymd(), true);
      save();
      return { data: { membership_id: m.id }, error: null };
    }
    if (name === "reset-member-password") {
      const m = member(body.membership_id) ?? fail("not_found");
      if ((body.password ?? "").length < 8) return fnErr("weak_password");
      const role = roleIn(m!.org_id);
      if ((role !== "owner" && role !== "manager") || !managesMember(m!.org_id, m!.id)) return fnErr("not_allowed");
      if (role === "manager" && m!.role !== "employee") return fnErr("not_allowed");
      const u = db.users.find((x) => x.id === m!.user_id)!;
      u.password = body.password;
      save();
      return { data: { ok: true }, error: null };
    }
    if (name === "stripe-checkout") {
      if (roleIn(body.org_id) !== "owner") return fnErr("not_allowed");
      const o = db.organizations.find((x) => x.id === body.org_id)!;
      Object.assign(o, { plan_key: body.plan_key, sub_status: "active", stripe_customer_id: "demo_customer", current_period_end: new Date(Date.now() + 30 * 864e5).toISOString() });
      save();
      return { data: { url: `${window.location.origin}/billing?paid=1` }, error: null };
    }
    if (name === "stripe-portal") {
      alert("Демо: тук се отваря порталът на Stripe за карта, фактури и отказване.");
      return { data: { url: `${window.location.origin}/billing` }, error: null };
    }
    return fnErr("unknown_function");
  } catch (e: any) {
    return fnErr(e?.message ?? "server_error");
  }
}

// ------------------------------------------------------------ снимки (като data URL, смалени)
async function toDataUrl(blob: Blob): Promise<string> {
  if (blob.type.startsWith("image/") && blob.type !== "image/svg+xml") {
    try {
      const bmp = await createImageBitmap(blob);
      const k = Math.min(1, 720 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.6);
    } catch {
      /* падаме към директно четене */
    }
  }
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

// ------------------------------------------------------------ публичният клиент
export function createDemoClient(): any {
  return {
    auth: {
      async getSession() { return { data: { session: sessionFor(currentUid()) }, error: null }; },
      async getUser() { const s = sessionFor(currentUid()); return { data: { user: s?.user ?? null }, error: null }; },
      onAuthStateChange(cb: (e: string, s: any) => void) {
        listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        const u = db.users.find((x) => x.email === email.trim().toLowerCase());
        if (!u || u.password !== password) return { data: { session: null }, error: { message: "Invalid login credentials" } };
        setSession(u.id);
        return { data: { session: sessionFor(u.id), user: sessionFor(u.id).user }, error: null };
      },
      async signUp({ email, password, options }: any) {
        const mail = email.trim().toLowerCase();
        if (db.users.some((x) => x.email === mail)) return { data: { session: null }, error: { message: "User already registered" } };
        const user = { id: uid(), email: mail, password, metadata: options?.data ?? {}, created_at: nowIso() };
        db.users.push(user);
        save();
        setSession(user.id); // в демото няма потвърждаване на имейл
        return { data: { session: sessionFor(user.id), user: sessionFor(user.id).user }, error: null };
      },
      async signOut() { setSession(null); return { error: null }; },
      async updateUser({ password }: { password?: string }) {
        const u = db.users.find((x) => x.id === currentUid());
        if (!u) return { data: null, error: { message: "not_authenticated" } };
        if (password) u.password = password;
        save();
        return { data: { user: sessionFor(u.id).user }, error: null };
      },
      async resetPasswordForEmail() { return { data: {}, error: null }; },
      async signInWithOAuth() { alert("Google вход не е наличен в демо режим."); return { data: {}, error: null }; },
    },
    from: (table: string) => new Query(table),
    rpc: (name: string, args: any) => {
      try {
        const data = rpc(name, args ?? {});
        return Promise.resolve({ data: data ?? null, error: null });
      } catch (e: any) {
        return Promise.resolve({ data: null, error: { message: e?.message ?? String(e) } });
      }
    },
    functions: { invoke: async (name: string, opts: { body: any }) => invokeFn(name, opts?.body ?? {}) },
    storage: {
      from: (_bucket: string) => ({
        async upload(path: string, blob: Blob) {
          files[path] = await toDataUrl(blob);
          saveFiles();
          return { data: { path }, error: null };
        },
        async createSignedUrls(paths: string[]) {
          return { data: paths.map((p) => ({ path: p, signedUrl: files[p] ?? "", error: null })), error: null };
        },
        async remove(paths: string[]) {
          paths.forEach((p) => delete files[p]);
          saveFiles();
          return { data: [], error: null };
        },
      }),
    },
  };
}

// ------------------------------------------------------------ примерни данни
export const DEMO_ACCOUNTS = [
  { role: "Собственик", name: "Иван Георгиев", email: "owner@demo.example", hint: "вижда всичко, плащане" },
  { role: "Ръководител", name: "Петя Колева", email: "petya@demo.staff.teamtasks.app", hint: "група „Почистване“" },
  { role: "Служител", name: "Мария Иванова", email: "maria@demo.staff.teamtasks.app", hint: "изпълнява задачи" },
];

function picture(label: string, c1: string, c2: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>` +
    `<rect width="640" height="480" fill="url(#g)"/><text x="320" y="230" font-family="sans-serif" font-size="34" fill="#fff" text-anchor="middle">📷</text>` +
    `<text x="320" y="290" font-family="sans-serif" font-size="30" fill="#fff" text-anchor="middle">${label}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function seed(): Tables {
  const t: Tables = {
    users: [], plans: [], organizations: [], memberships: [], groups: [], group_members: [],
    tasks: [], task_attachments: [], occurrences: [], occurrence_photos: [],
    notification_prefs: [], org_notification_settings: [], notification_outbox: [],
    org_settings: [], group_settings: [], shift_types: [], shifts: [], time_entries: [],
    places: [], task_templates: [], task_comments: [],
  };
  db = t;
  files = {};

  t.plans.push(
    { key: "start", name: "Старт", price_eur: 9, max_members: 5, max_groups: 2, sort: 1 },
    { key: "team", name: "Екип", price_eur: 29, max_members: 25, max_groups: 10, sort: 2 },
    { key: "business", name: "Бизнес", price_eur: 79, max_members: 100, max_groups: 50, sort: 3 },
  );

  const org = {
    id: uid(), created_at: nowIso(), name: "Демо Клининг ЕООД", code: "demo", owner_id: "",
    ...DEFAULTS.organizations(), trial_ends_at: new Date(Date.now() + 9 * 864e5).toISOString(),
  };
  t.organizations.push(org);

  const person = (key: string, display: string, role: string, email?: string) => {
    const userId = uid();
    const mail = email ?? `${key}@${org.code}.${STAFF}`;
    t.users.push({ id: userId, email: mail, password: DEMO_PASSWORD, metadata: { display_name: display }, created_at: nowIso() });
    const m = { id: uid(), created_at: nowIso(), org_id: org.id, user_id: userId, role, display_name: display, username: email ? null : key, active: true };
    t.memberships.push(m);
    return m;
  };
  const owner = person("owner", "Иван Георгиев", "owner", "owner@demo.example");
  org.owner_id = owner.user_id;
  const petya = person("petya", "Петя Колева", "manager");
  const dimitar = person("dimitar", "Димитър Стоянов", "manager");
  const maria = person("maria", "Мария Иванова", "employee");
  const georgi = person("georgi", "Георги Петров", "employee");
  const stefan = person("stefan", "Стефан Николов", "employee");
  const nadya = person("nadya", "Надя Димитрова", "employee");

  const gClean = { id: uid(), created_at: nowIso(), org_id: org.id, name: "Почистване", color: "#2563eb" };
  const gStore = { id: uid(), created_at: nowIso(), org_id: org.id, name: "Склад", color: "#16a34a" };
  t.groups.push(gClean, gStore);
  const gm = (g: Row, m: Row, lead = false) => t.group_members.push({ group_id: g.id, membership_id: m.id, org_id: org.id, is_leader: lead });
  gm(gClean, owner, true); gm(gStore, owner, true);
  gm(gClean, petya, true); gm(gStore, dimitar, true);
  gm(gClean, maria); gm(gClean, georgi); gm(gStore, stefan); gm(gStore, nadya);

  const today = ymd();
  const dow = parse(today).getDay();
  const task = (p: Row) => {
    const row = { id: uid(), created_at: nowIso(), org_id: org.id, created_by: petya.user_id, ...DEFAULTS.tasks(), start_date: addDays(today, -14), ...p };
    t.tasks.push(row);
    return row;
  };
  // места с QR код
  const mkPlace = (name: string, code: string, group: Row | null) => {
    const p = { id: uid(), created_at: nowIso(), org_id: org.id, name, code, group_id: group?.id ?? null };
    t.places.push(p);
    return p;
  };
  const pOffice = mkPlace("Офис етаж 2", "ofis2-" + uid().slice(0, 6), gClean);
  const pWc = mkPlace("Санитарни помещения", "wc-" + uid().slice(0, 6), gClean);
  const pDock = mkPlace("Склад – рампа", "rampa-" + uid().slice(0, 6), gStore);

  const office = task({
    title: "Почистване на офис етаж 2", group_id: gClean.id, recurrence: "daily", due_time: "10:00", requires_photo: true,
    description: "Работни места, коридор и кухненски бокс.", place_id: pOffice.id,
    instructions: "1. Изпразнете кошчетата и сменете торбите.\n2. Забършете бюрата с дезинфектант.\n3. Приберете и подредете кухненския бокс.\n4. Измийте пода – от далечния край към вратата.\n5. Снимайте коридора и кухнята.",
    steps: ["Изпразнете кошчетата и сменете торбите", "Забършете бюрата с дезинфектант", "Подредете кухненския бокс", "Измийте пода", "Снимайте коридора и кухнята"],
  });
  const wc = task({
    title: "Дезинфекция на санитарни помещения", group_id: gClean.id, recurrence: "daily", due_time: "14:00",
    requires_photo: true, requires_note: true, priority: 1, place_id: pWc.id,
    instructions: "Използвайте препарата от червената бутилка. Носете ръкавици. Отбележете в бележката, ако консумативите свършват.",
    steps: ["Сложете ръкавици", "Дезинфекцирайте мивки и кранове", "Дезинфекцирайте тоалетните", "Допълнете хартия и сапун"],
  });
  t.task_templates.push(
    {
      id: uid(), created_at: nowIso(), org_id: org.id, name: "Почистване на помещение",
      payload: { title: "Почистване на помещение", description: "Стандартно ежедневно почистване.", requires_photo: true, requires_approval: true, recurrence: "daily", due_time: "12:00",
        steps: ["Изпразнете кошчетата", "Забършете повърхностите", "Измийте пода", "Снимайте резултата"], steps_required: true },
    },
    {
      id: uid(), created_at: nowIso(), org_id: org.id, name: "Приемане на доставка",
      payload: { title: "Приемане на доставка", description: "Проверка на стоката при разтоварване.", requires_photo: true, requires_note: true, recurrence: "once",
        steps: ["Сверете количествата с фактурата", "Огледайте опаковките за повреди", "Снимайте протокола", "Подредете стоката по места"], steps_required: true },
    },
  );
  task({ title: "Изхвърляне на боклука", group_id: gClean.id, assign_mode: "any", recurrence: "daily", requires_approval: false, due_time: "17:30", description: "Достатъчно е един от групата." });
  task({
    title: "Преглед на доставка", group_id: gStore.id, recurrence: "weekly", recurrence_days: [dow, (dow + 2) % 7, (dow + 4) % 7],
    due_time: "11:00", requires_photo: true, place_id: pDock.id,
    instructions: "Сверете количествата с фактурата. Снимайте протокола и палетите. При липси – опишете в бележка.",
    steps: ["Сверете количествата с фактурата", "Снимайте протокола и палетите", "Опишете липсите (ако има)"], steps_required: false,
  });
  task({ title: "Инвентаризация – рафт A", group_id: gStore.id, recurrence: "monthly", start_date: addDays(today, -60 + 0), requires_note: true, requires_approval: false });
  task({ title: "Проверка на пожарогасители", assignee_id: stefan.id, group_id: null, recurrence: "daily", requires_photo: true, due_time: "09:00", instructions: "Проверете пломбите и датата на валидност." });

  t.task_attachments.push({
    id: uid(), created_at: nowIso(), org_id: org.id, task_id: office.id, name: "схема.png",
    path: `${org.id}/instructions/${office.id}/schema.png`,
  });
  files[`${org.id}/instructions/${office.id}/schema.png`] = picture("Схема на етажа", "#334155", "#2563eb");

  ensureOccurrences(org.id, addDays(today, -1), today, true);
  const occ = (task_: Row, who: Row, day: string) => t.occurrences.find((o) => o.task_id === task_.id && o.assignee_id === who.id && o.due_date === day);
  const photo = (o: Row, label: string, c1: string, c2: string) => {
    const path = `${org.id}/proof/${o.id}/demo.jpg`;
    files[path] = picture(label, c1, c2);
    t.occurrence_photos.push({ id: uid(), occurrence_id: o.id, org_id: org.id, path, created_at: nowIso() });
  };
  const done = (o: Row | undefined, status: string, by: Row, extra: Row = {}) =>
    o && Object.assign(o, { status, completed_by: by.id, completed_at: nowIso(), ...extra });

  // вчера
  const y = addDays(today, -1);
  for (const o of t.occurrences.filter((x) => x.due_date === y && x.assignee_id)) {
    const who = member(o.assignee_id)!;
    if (who.id === georgi.id && o.task_id === wc.id) continue; // просрочена
    if (o.assignee_id) done(o, "approved", who, { reviewed_by: petya.id, reviewed_at: nowIso(), note: "Всичко е наред." });
  }
  // днес
  const t1 = occ(office, maria, today);
  if (t1) {
    done(t1, "submitted", maria, { note: "Готово. Коридорът е измит, кухнята – почистена.", steps_done: [true, true, true, true, true] });
    photo(t1, "Офис етаж 2", "#0ea5e9", "#1e3a8a");
    t.task_comments.push(
      { id: uid(), created_at: nowIso(), org_id: org.id, occurrence_id: t1.id, author_id: maria.id, body: "В кухнята свършва препаратът за съдове – да поръчаме ли?" },
      { id: uid(), created_at: nowIso(), org_id: org.id, occurrence_id: t1.id, author_id: petya.id, body: "Да, поръчвам го днес. Благодаря!" },
    );
  }
  const t2 = occ(wc, maria, today);
  if (t2) { done(t2, "approved", maria, { note: "Остава малко препарат.", reviewed_by: petya.id, reviewed_at: nowIso() }); photo(t2, "Санитарни", "#14b8a6", "#134e4a"); }
  const t3 = occ(office, georgi, today);
  if (t3) { done(t3, "rejected", georgi, { note: "Готово.", reviewed_by: petya.id, reviewed_at: nowIso(), review_comment: "На снимката не се вижда кухнята. Моля, снимайте и нея." }); photo(t3, "Само коридор", "#f59e0b", "#7c2d12"); }

  seedWork(t, org.id, { petya, dimitar, maria, georgi, stefan, nadya }, gClean, gStore);

  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
  saveFiles();
  return t;
}

/** Настройки на фирмата, видимост за служителите, типове смени, график и часове. */
function seedWork(t: Tables, orgId: string, p: Record<string, Row>, gClean: Row, gStore: Row) {
  t.org_settings.push({
    org_id: orgId, created_at: nowIso(),
    features: { calendar: true, shifts: true, timeclock: true, languages: true, checklist: true, qr: true, offline: true, comments: true, reports: true },
    languages: ["bg", "en", "ru", "uk"],
  });
  t.group_settings.push(
    { group_id: gClean.id, org_id: orgId, visibility: { see_calendar: true, see_schedule: "group", see_hours: true, self_clock: true, see_history: true } },
    { group_id: gStore.id, org_id: orgId, visibility: { see_calendar: true, see_schedule: "own", see_hours: true, self_clock: false, see_history: true } },
  );

  const types = [
    { name: "Сутрин", start_time: "07:00", end_time: "15:00", color: "#2e7d5a", break_min: 30 },
    { name: "Следобед", start_time: "15:00", end_time: "23:00", color: "#c9784a", break_min: 30 },
    { name: "Нощна", start_time: "23:00", end_time: "07:00", color: "#4b5d7a", break_min: 45 },
    { name: "Цял ден", start_time: "09:00", end_time: "18:00", color: "#a8700f", break_min: 60 },
  ].map((x) => ({ id: uid(), org_id: orgId, created_at: nowIso(), ...x }));
  t.shift_types.push(...types);
  const [morning, afternoon, , full] = types;

  const today = ymd();
  const dow = (parse(today).getDay() + 6) % 7; // Пн = 0
  const monday = addDays(today, -dow);
  const day = (i: number) => addDays(monday, i);

  const put = (who: Row, group: Row, i: number, ty: Row | null, extra: Row = {}) =>
    t.shifts.push({
      id: uid(), created_at: nowIso(), org_id: orgId, membership_id: who.id, group_id: group.id, date: day(i),
      kind: ty ? "work" : "off", shift_type_id: ty?.id ?? null, start_time: ty?.start_time ?? null, end_time: ty?.end_time ?? null,
      break_min: ty?.break_min ?? 0, note: null, published: true, ...extra,
    });

  // тази седмица (публикувана): Почистване – Мария/Георги, Склад – Стефан/Надя
  for (let i = 0; i < 7; i++) {
    put(p.maria, gClean, i, i === 5 || i === 6 ? null : i % 2 === 0 ? morning : afternoon);
    put(p.georgi, gClean, i, i === 2 || i === 6 ? null : i % 2 === 0 ? afternoon : morning);
    put(p.stefan, gStore, i, i === 5 || i === 6 ? null : full);
    put(p.nadya, gStore, i, i === 0 || i === 6 ? null : i % 2 === 1 ? morning : full);
  }
  // следващата седмица – чернова, още не е публикувана
  for (let i = 0; i < 5; i++) {
    put(p.stefan, gStore, 7 + i, i % 2 ? morning : full, { published: false });
    put(p.nadya, gStore, 7 + i, i % 2 ? full : morning, { published: false });
  }

  // часове: изминалите дни тази седмица (с лек разнобой), днес – Георги е „на смяна“, Мария още не е започнала
  const at = (date: string, hm: string, plusMin = 0) => {
    const [y, m, d] = date.split("-").map(Number);
    const [h, mi] = hm.split(":").map(Number);
    return new Date(y, m - 1, d, h, mi + plusMin).toISOString();
  };
  const jitter = [4, -3, 9, 0, 14, -5, 2];
  for (const s of t.shifts.filter((x) => x.published && x.kind === "work" && x.date < today && x.date >= monday)) {
    if (s.membership_id === p.stefan.id) continue; // в „Склад“ часовете ги въвежда ръководителят – няма самоотчитане
    const j = jitter[(s.date.charCodeAt(9) + s.membership_id.charCodeAt(0)) % jitter.length];
    t.time_entries.push({
      id: uid(), created_at: nowIso(), org_id: orgId, membership_id: s.membership_id, shift_id: s.id, work_date: s.date,
      started_at: at(s.date, s.start_time, j), ended_at: at(s.date, s.end_time, s.end_time < s.start_time ? 24 * 60 - j : -j + 6),
      break_min: s.break_min, method: "self", note: null, approved: s.date < addDays(today, -1),
    });
  }
  const gShift = t.shifts.find((x) => x.date === today && x.membership_id === p.georgi.id && x.kind === "work");
  if (gShift)
    t.time_entries.push({
      id: uid(), created_at: nowIso(), org_id: orgId, membership_id: p.georgi.id, shift_id: gShift.id, work_date: today,
      started_at: new Date(Date.now() - 95 * 60000).toISOString(), ended_at: null, break_min: 0, method: "self", note: null, approved: false,
    });
}

db = load();

// промени от друг раздел (напр. ръководител създава задача) се виждат веднага
window.addEventListener("storage", (e) => {
  try {
    if (e.key === KEY && e.newValue) db = JSON.parse(e.newValue);
    if (e.key === FILES_KEY && e.newValue) files = JSON.parse(e.newValue);
  } catch {
    /* ignore */
  }
});
