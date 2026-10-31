// Собственикът избира план -> Stripe Checkout (абонамент). Остатъкът от пробния период се запазва.
import Stripe from "npm:stripe@17";
import { adminClient, currentUserId, handler, HttpError, json, siteUrl, userClient } from "../_shared/util.ts";

Deno.serve(handler(async (req) => {
  const user = userClient(req);
  const uid = await currentUserId(user);
  const { org_id, plan_key } = await req.json() as { org_id: string; plan_key: string };

  const { data: role } = await user.rpc("app_role", { p_org: org_id });
  if (role !== "owner") throw new HttpError(403, "not_allowed");

  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret) throw new HttpError(503, "billing_not_configured");
  const stripe = new Stripe(secret);

  const admin = adminClient();
  const { data: plan } = await admin.from("plans").select("key, stripe_price_id").eq("key", plan_key).single();
  if (!plan?.stripe_price_id) throw new HttpError(503, "plan_not_configured");
  const { data: org } = await admin.from("organizations")
    .select("id, name, stripe_customer_id, sub_status, trial_ends_at").eq("id", org_id).single();
  if (!org) throw new HttpError(404, "org_not_found");

  let customer = org.stripe_customer_id as string | null;
  if (!customer) {
    const { data: u } = await admin.auth.admin.getUserById(uid);
    const c = await stripe.customers.create({
      name: org.name,
      email: u.user?.email ?? undefined,
      metadata: { org_id },
    });
    customer = c.id;
    await admin.from("organizations").update({ stripe_customer_id: customer }).eq("id", org_id);
  }

  // Stripe изисква trial_end поне 48 ч напред; иначе таксуваме веднага.
  const trialEnd = Math.floor(new Date(org.trial_ends_at).getTime() / 1000);
  const keepTrial = org.sub_status === "trialing" && trialEnd > Math.floor(Date.now() / 1000) + 49 * 3600;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: org_id,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    subscription_data: {
      metadata: { org_id },
      ...(keepTrial ? { trial_end: trialEnd } : {}),
    },
    allow_promotion_codes: true,
    success_url: `${siteUrl()}/billing?paid=1`,
    cancel_url: `${siteUrl()}/billing`,
  });
  return json({ url: session.url });
}));
