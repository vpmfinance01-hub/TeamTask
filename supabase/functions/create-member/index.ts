// Ръководител/собственик създава акаунт на служител (с потребителско име или имейл + парола).
import { adminClient, currentUserId, handler, HttpError, json, staffEmail, userClient } from "../_shared/util.ts";

type Body = {
  org_id: string;
  display_name: string;
  username?: string;
  email?: string;
  password: string;
  role?: "manager" | "employee";
  group_ids?: string[];
};

Deno.serve(handler(async (req) => {
  const user = userClient(req);
  await currentUserId(user);
  const b = (await req.json()) as Body;

  const name = (b.display_name ?? "").trim();
  const username = (b.username ?? "").trim().toLowerCase();
  const email = (b.email ?? "").trim().toLowerCase();
  const role = b.role ?? "employee";
  const groups = b.group_ids ?? [];
  if (!b.org_id || !name) throw new HttpError(400, "missing_fields");
  if (!email && !/^[a-z0-9._-]{2,30}$/.test(username)) throw new HttpError(400, "bad_username");
  if ((b.password ?? "").length < 8) throw new HttpError(400, "weak_password");
  if (role !== "manager" && role !== "employee") throw new HttpError(400, "bad_role");

  // права: проверяват се с правата на викащия (същите функции като в RLS)
  const { data: myRole } = await user.rpc("app_role", { p_org: b.org_id });
  if (myRole !== "owner" && myRole !== "manager") throw new HttpError(403, "not_allowed");
  if (myRole === "manager") {
    if (role !== "employee") throw new HttpError(403, "not_allowed");
    if (groups.length === 0) throw new HttpError(400, "group_required");
    for (const g of groups) {
      const { data: leads } = await user.rpc("app_leads_group", { p_group: g });
      if (!leads) throw new HttpError(403, "not_allowed");
    }
  }
  const { data: access } = await user.rpc("app_has_access", { p_org: b.org_id });
  if (!access) throw new HttpError(402, "subscription_inactive");

  const admin = adminClient();
  const { data: org } = await admin.from("organizations").select("code").eq("id", b.org_id).single();
  if (!org) throw new HttpError(404, "org_not_found");

  // групите трябва да са от същата фирма
  if (groups.length) {
    const { data: found } = await admin.from("groups").select("id").eq("org_id", b.org_id).in("id", groups);
    if ((found?.length ?? 0) !== groups.length) throw new HttpError(400, "bad_group");
  }

  const authEmail = email || staffEmail(username, org.code);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: authEmail,
    password: b.password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (createErr || !created.user) {
    const msg = createErr?.message ?? "";
    throw new HttpError(409, /already|registered|exists/i.test(msg) ? "user_exists" : "create_failed");
  }

  const { data: member, error: memErr } = await admin.from("memberships").insert({
    org_id: b.org_id,
    user_id: created.user.id,
    role,
    display_name: name,
    username: email ? null : username,
  }).select("id").single();
  if (memErr || !member) {
    await admin.auth.admin.deleteUser(created.user.id); // връщаме назад (напр. лимит на плана)
    const m = memErr?.message ?? "";
    throw new HttpError(m.includes("member_limit") ? 402 : 409, m.includes("member_limit") ? "member_limit" : "username_taken");
  }

  if (groups.length) {
    await admin.from("group_members").insert(
      // ръководителят е ръководител на избраните групи (иначе не би могъл да одобрява задачите им)
      groups.map((g) => ({ group_id: g, membership_id: member.id, org_id: b.org_id, is_leader: role === "manager" })),
    );
  }
  return json({ membership_id: member.id, login: email || `${username} (код: ${org.code})` });
}));
