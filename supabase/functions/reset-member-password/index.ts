// Собственик или ръководител на групата задава нова парола на служител.
import { adminClient, currentUserId, handler, HttpError, json, userClient } from "../_shared/util.ts";

Deno.serve(handler(async (req) => {
  const user = userClient(req);
  const callerId = await currentUserId(user);
  const { membership_id, password } = await req.json() as { membership_id: string; password: string };
  if (!membership_id || (password ?? "").length < 8) throw new HttpError(400, "weak_password");

  const admin = adminClient();
  const { data: target } = await admin.from("memberships")
    .select("org_id, user_id, role").eq("id", membership_id).single();
  if (!target) throw new HttpError(404, "not_found");
  if (target.role === "owner" && target.user_id !== callerId) throw new HttpError(403, "not_allowed");

  const { data: role } = await user.rpc("app_role", { p_org: target.org_id });
  const { data: manages } = await user.rpc("app_manages_member", { p_org: target.org_id, p_member: membership_id });
  if ((role !== "owner" && role !== "manager") || !manages) throw new HttpError(403, "not_allowed");
  // ръководител не може да сменя парола на друг ръководител
  if (role === "manager" && target.role !== "employee") throw new HttpError(403, "not_allowed");

  const { error } = await admin.auth.admin.updateUserById(target.user_id, { password });
  if (error) throw new HttpError(400, "update_failed");
  return json({ ok: true });
}));
