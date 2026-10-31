// Портал на Stripe: смяна на карта, плана, отказване, фактури.
import Stripe from "npm:stripe@17";
import { adminClient, currentUserId, handler, HttpError, json, siteUrl, userClient } from "../_shared/util.ts";

Deno.serve(handler(async (req) => {
  const user = userClient(req);
  await currentUserId(user);
  const { org_id } = await req.json() as { org_id: string };

  const { data: role } = await user.rpc("app_role", { p_org: org_id });
  if (role !== "owner") throw new HttpError(403, "not_allowed");

  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret) throw new HttpError(503, "billing_not_configured");

  const { data: org } = await adminClient().from("organizations")
    .select("stripe_customer_id").eq("id", org_id).single();
  if (!org?.stripe_customer_id) throw new HttpError(400, "no_customer");

  const session = await new Stripe(secret).billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${siteUrl()}/billing`,
  });
  return json({ url: session.url });
}));
