# TeamTasks – задачи за персонала

Уеб приложение (PWA – инсталира се на телефон и работи в браузър) за менажиране на персонал:
задачи с инструкции, отметка + текст + снимка, потвърждение от ръководител, групи, отделни акаунти,
абонаментни планове.

## Разглеждане (демо режим, без бекенд)

```bash
npm install
npm run dev
```

Отворете http://localhost:5173 – без `.env` приложението работи в демо режим (данни в браузъра).
Бърз вход по роли от екрана за вход; „Профил → Нулирай демо данните“ връща началното състояние.

## Известия към служителя

- Нова/променена задача и нов човек в група създават заданията за днес веднага (SQL тригери; в демото – същата логика).
- Приложението проверява на 15 сек. и показва известие (плюс системно, ако е разрешено) при нова или върната задача;
  ръководителят получава известие, когато има задача за одобрение.
- При първо отваряне служителят вижда приветствие с достъпа си; при създаване на акаунт ръководителят изпраща
  достъпа с един клик по SMS / Viber / WhatsApp / имейл.
- Известия при напълно затворено приложение (Web Push) се добавят с истинския бекенд.

## Бекенд

Към момента **няма включен бекенд** – приложението работи в демо режим (`npm run dev` без `.env`).
Пробата на Hostinger VPS (собствен PostgreSQL + вход + n8n) е премахната на 2026-10-26 и е запазена като архив в
[deploy/README.md](deploy/README.md) (миграциите `supabase/migrations/0001–0003` и n8n процесът са проверени и
остават). План: локално изграждане и тест, после Supabase.

## Алтернатива: Supabase + Stripe

1. Нов Supabase проект → изпълнете `supabase/migrations/0001_core.sql`.
2. Auth → изключете „Confirm email“ само ако искате регистрация без писмо (служителските акаунти се създават
   от функцията `create-member` и не изискват писмо).
3. Копирайте `.env.example` → `.env`, попълнете `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`.
4. Функции: `supabase functions deploy create-member reset-member-password stripe-checkout stripe-portal`
   и `supabase functions deploy stripe-webhook --no-verify-jwt`.
5. Тайни: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL` (адресът на приложението).
6. Stripe: създайте 3 месечни цени, запишете ги в `plans.stripe_price_id`, webhook към `stripe-webhook`
   със събития `checkout.session.completed`, `customer.subscription.*`.
7. `npm run build` и качване на `dist/` (Vercel/Hostinger).

## Архитектура

- `src/` – React + TypeScript + Vite, `vite-plugin-pwa` (манифест, service worker).
- `supabase/migrations/0001_core.sql` – таблици, RLS, RPC (`ensure_occurrences`, `submit_occurrence`,
  `review_occurrence`…), Storage политики, лимити по план.
- `supabase/functions/` – създаване на служителски акаунти, смяна на парола, Stripe.
- `src/lib/demo/client.ts` – имитация на Supabase за демо режима (повтаря логиката на SQL функциите).
