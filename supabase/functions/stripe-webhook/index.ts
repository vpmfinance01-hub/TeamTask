// Stripe -> база: състояние на абонамента. Деплой с --no-verify-jwt (Stripe не праща JWT).
import Stripe from "npm:stripe@17";
import { adminClient } from "../_shared/util.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "");
const cryptoProvider = Stripe.createSubtleCryptoProvider();

function mapStatus(s: Stripe.Subscription.Status): "active" | "past_due" | "canceled" | null {
  switch (s) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null; // incomplete / paused: не променяме
  }
}

async function syncSubscription(sub: Stripe.Subscription) {
  const admin = adminClient();
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data: org } = await admin.from("organizations")
    .select("id").eq("stripe_customer_id", customer).maybeSingle();
  const orgId = org?.id ?? sub.metadata?.org_id;
  if (!orgId) return;

  const status = mapStatus(sub.status);
  if (!status) return;

  const priceId = sub.items.data[0]?.price.id;
  const { data: plan } = await admin.from("plans").select("key").eq("stripe_price_id", priceId).maybeSingle();
  // current_period_end е в items при новите API версии
  const periodEnd = (sub.items.data[0] as unknown as { current_period_end?: number })?.current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end;

  await admin.from("organizations").update({
    sub_status: status,
    stripe_customer_id: customer,
    stripe_subscription_id: sub.id,
    ...(plan ? { plan_key: plan.key } : {}),
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  }).eq("id", orgId);
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!signature || !secret) return new Response("not configured", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, secret, undefined, cryptoProvider);
  } catch {
    return new Response("bad signature", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode === "subscription" && s.subscription && s.client_reference_id) {
        await adminClient().from("organizations")
          .update({ stripe_customer_id: s.customer as string })
          .eq("id", s.client_reference_id);
        const subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
        await syncSubscription(await stripe.subscriptions.retrieve(subId));
      }
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncSubscription(event.data.object as Stripe.Subscription);
    }
  } catch (e) {
    console.error(e);
    return new Response("handler error", { status: 500 }); // Stripe ще опита отново
  }
  return new Response("ok");
});
