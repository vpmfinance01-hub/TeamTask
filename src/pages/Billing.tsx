import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { fnError, hasAccess, trialDaysLeft } from "../lib/util";
import { Alert } from "../components/ui";

const STATUS_TEXT = {
  trialing: "Пробен период",
  active: "Активен абонамент",
  past_due: "Неплатено – обновете картата",
  canceled: "Отказан",
} as const;

export default function Billing() {
  const { org, plans, plan, members, groups, reload } = useApp();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  if (!org) return null;

  async function go(fn: "stripe-checkout" | "stripe-portal", body: Record<string, string>, key: string) {
    setErr("");
    setBusy(key);
    const { data, error } = await supabase.functions.invoke(fn, { body: { org_id: org!.id, ...body } });
    if (error) {
      setBusy("");
      return setErr(await fnError(error));
    }
    window.location.href = data.url;
  }

  const activeMembers = members.filter((m) => m.active).length;
  const paid = org.sub_status === "active" || org.sub_status === "past_due";

  return (
    <div className="stack">
      <h1>Абонамент</h1>
      {params.get("paid") && (
        <Alert kind="ok">
          Благодарим! Плащането се обработва – статусът ще се обнови до минута.{" "}
          <button className="btn small" onClick={reload}>
            Обнови
          </button>
        </Alert>
      )}
      {err && <Alert kind="bad">{err}</Alert>}

      <div className="card stack">
        <div className="row between">
          <div>
            <div className="muted small">Текущ план</div>
            <h2>{plan?.name ?? org.plan_key}</h2>
          </div>
          <span className={`chip ${hasAccess(org) ? "approved" : "late"}`}>{STATUS_TEXT[org.sub_status]}</span>
        </div>
        {org.sub_status === "trialing" && (
          <div className="muted">
            Остават {trialDaysLeft(org)} дни от пробния период (до {new Date(org.trial_ends_at).toLocaleDateString("bg-BG")}).
          </div>
        )}
        {paid && org.current_period_end && (
          <div className="muted">Следващо подновяване: {new Date(org.current_period_end).toLocaleDateString("bg-BG")}</div>
        )}
        <div className="muted small">
          Служители: {activeMembers}
          {plan ? ` / ${plan.max_members}` : ""} · Групи: {groups.length}
          {plan ? ` / ${plan.max_groups}` : ""}
        </div>
        {org.stripe_customer_id && (
          <button className="btn" disabled={Boolean(busy)} onClick={() => go("stripe-portal", {}, "portal")}>
            {busy === "portal" ? "Отваряне…" : "Карта, фактури и отказване"}
          </button>
        )}
      </div>

      <div className="plans">
        {plans.map((p) => {
          const current = paid && p.key === org.plan_key;
          return (
            <div key={p.key} className={`card stack plan ${current ? "current" : ""}`}>
              <h2>{p.name}</h2>
              <div>
                <span className="price">€{p.price_eur}</span>
                <span className="muted"> / месец</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>до {p.max_members} служители</li>
                <li>до {p.max_groups} групи</li>
                <li>Задачи със снимка и бележка</li>
                <li>Потвърждение от ръководител</li>
                <li>Приложение за телефон и браузър</li>
              </ul>
              <button
                className={`btn ${current ? "" : "primary"}`}
                disabled={current || Boolean(busy)}
                onClick={() => go("stripe-checkout", { plan_key: p.key }, p.key)}
              >
                {current ? "Текущ план" : busy === p.key ? "Отваряне…" : paid ? "Смени плана" : "Избери"}
              </button>
            </div>
          );
        })}
      </div>
      <p className="muted small">Плащането е през Stripe. Цените са без ДДС. Можете да откажете по всяко време.</p>
    </div>
  );
}
