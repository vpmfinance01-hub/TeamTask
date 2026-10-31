-- Известия към служителите (имейл / WhatsApp / Viber) при нова и върната задача.
-- Базата само подрежда съобщенията (опашка); изпращането го прави n8n (виж deploy/n8n).
-- Рамка: фирма (organizations) включва каналите, всеки човек задава контактите си,
-- получатели са членовете на групата (отдела), към която е задачата.

-- ---------------------------------------------------------------- настройки
create table public.app_settings (
  key text primary key,
  value text not null
);
-- адресът на приложението за линковете в съобщенията (сменя се при нов адрес)
insert into public.app_settings (key, value)
values ('site_url', 'https://tasks.187-126-13-139.sslip.io')
on conflict (key) do nothing;
alter table public.app_settings enable row level security; -- без политики: достъп само през service role
revoke all on public.app_settings from anon, authenticated;

create table public.org_notification_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  email_on boolean not null default true,
  whatsapp_on boolean not null default false,
  viber_on boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.notification_prefs (
  membership_id uuid primary key references public.memberships (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone text check (phone is null or phone ~ '^[0-9]{9,15}$'), -- международен формат без +, напр. 359888123456
  email_on boolean not null default true,
  whatsapp_on boolean not null default false,
  viber_on boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.notification_outbox (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  recipient_id uuid not null references public.memberships (id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp', 'viber')),
  event text not null check (event in ('new_task', 'returned_task')),
  occurrence_id uuid references public.occurrences (id) on delete set null,
  task_title text not null,
  detail text,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  notify_after timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notification_outbox_work_idx on public.notification_outbox (notify_after)
  where status in ('pending', 'sending');
alter table public.notification_outbox enable row level security; -- без политики
revoke all on public.notification_outbox from anon, authenticated;

-- ---------------------------------------------------------------- права
-- Контактите си редактира самият човек; чужди – собственикът и ръководителят на групата му.
create function public.app_can_edit_prefs(p_org uuid, p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.id = p_member and m.org_id = p_org and m.active
      and (m.user_id = auth.uid()
           or (public.app_is_manager(p_org) and public.app_manages_member(p_org, p_member))))
$$;

alter table public.org_notification_settings enable row level security;
alter table public.notification_prefs enable row level security;

create policy ons_read on public.org_notification_settings for select to authenticated
  using (public.app_is_member(org_id));
create policy ons_write on public.org_notification_settings for insert to authenticated
  with check (public.app_role(org_id) = 'owner');
create policy ons_update on public.org_notification_settings for update to authenticated
  using (public.app_role(org_id) = 'owner') with check (public.app_role(org_id) = 'owner');

create policy prefs_read on public.notification_prefs for select to authenticated
  using (public.app_can_edit_prefs(org_id, membership_id));
create policy prefs_insert on public.notification_prefs for insert to authenticated
  with check (public.app_can_edit_prefs(org_id, membership_id));
create policy prefs_update on public.notification_prefs for update to authenticated
  using (public.app_can_edit_prefs(org_id, membership_id))
  with check (public.app_can_edit_prefs(org_id, membership_id));
create policy prefs_delete on public.notification_prefs for delete to authenticated
  using (public.app_can_edit_prefs(org_id, membership_id));

revoke all on public.org_notification_settings, public.notification_prefs from anon;
revoke delete on public.org_notification_settings from authenticated;

-- ---------------------------------------------------------------- опашка
-- Подрежда по едно съобщение на канал, който е включен и за фирмата, и за човека.
create function public.app_enqueue_notification(
  p_member uuid, p_event text, p_occ uuid, p_title text, p_detail text, p_due date, p_after timestamptz)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_auth_email text; v_email text;
  p public.notification_prefs; s public.org_notification_settings;
begin
  select m.org_id, u.email into v_org, v_auth_email
    from public.memberships m join auth.users u on u.id = m.user_id
   where m.id = p_member and m.active;
  if v_org is null then return; end if;

  select * into p from public.notification_prefs where membership_id = p_member;
  select * into s from public.org_notification_settings where org_id = v_org;
  -- служебните адреси на служителите без имейл не са истински
  v_email := coalesce(p.email, case when v_auth_email like '%.staff.teamtasks.app' then null else v_auth_email end);

  if v_email is not null and coalesce(p.email_on, true) and coalesce(s.email_on, true) then
    insert into public.notification_outbox (org_id, recipient_id, channel, event, occurrence_id, task_title, detail, due_date, notify_after)
    values (v_org, p_member, 'email', p_event, p_occ, p_title, p_detail, p_due, p_after);
  end if;
  if p.phone is not null and coalesce(p.whatsapp_on, false) and coalesce(s.whatsapp_on, false) then
    insert into public.notification_outbox (org_id, recipient_id, channel, event, occurrence_id, task_title, detail, due_date, notify_after)
    values (v_org, p_member, 'whatsapp', p_event, p_occ, p_title, p_detail, p_due, p_after);
  end if;
  if p.phone is not null and coalesce(p.viber_on, false) and coalesce(s.viber_on, false) then
    insert into public.notification_outbox (org_id, recipient_id, channel, event, occurrence_id, task_title, detail, due_date, notify_after)
    values (v_org, p_member, 'viber', p_event, p_occ, p_title, p_detail, p_due, p_after);
  end if;
end $$;

-- Нова задача (ново задание от днес нататък) и върната задача. Грешка в известията никога не спира работата.
create function public.trg_occurrence_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_title text;
  v_today date := (now() at time zone 'Europe/Sofia')::date;
  v_after timestamptz;
  r record;
begin
  begin
    if tg_op = 'INSERT' then
      if new.status <> 'pending' or new.due_date < v_today then return new; end if;
      if not public.app_has_access(new.org_id) then return new; end if;
      select t.title into v_title from public.tasks t where t.id = new.task_id;
      -- кратко изчакване за групиране; задачи за по-късен ден – от 06:00 на този ден
      v_after := greatest(now() + interval '45 seconds',
                          (new.due_date::timestamp at time zone 'Europe/Sofia') + interval '6 hours');
      if new.assignee_id is not null then
        perform public.app_enqueue_notification(new.assignee_id, 'new_task', new.id, v_title, null, new.due_date, v_after);
      elsif new.group_id is not null then
        for r in select gm.membership_id from public.group_members gm
                  where gm.group_id = new.group_id and not gm.is_leader loop
          perform public.app_enqueue_notification(r.membership_id, 'new_task', new.id, v_title, null, new.due_date, v_after);
        end loop;
      end if;
    elsif tg_op = 'UPDATE' then
      if new.status = 'rejected' and old.status is distinct from 'rejected' then
        select t.title into v_title from public.tasks t where t.id = new.task_id;
        perform public.app_enqueue_notification(coalesce(new.completed_by, new.assignee_id), 'returned_task',
                                                new.id, v_title, new.review_comment, new.due_date,
                                                now() + interval '5 seconds');
      end if;
    end if;
  exception when others then
    raise warning 'notify trigger: %', sqlerrm;
  end;
  return new;
end $$;

create trigger occurrences_notify after insert or update of status on public.occurrences
  for each row execute function public.trg_occurrence_notify();

-- ---------------------------------------------------------------- за n8n (само service role)
-- Взима готовите съобщения, обединени по човек и канал, и ги маркира като „изпращат се“.
create function public.claim_notifications(p_limit int default 40)
returns table (msg_ids bigint[], msg_channel text, msg_event text, msg_to text,
               msg_subject text, msg_body text, msg_link text)
language plpgsql security definer set search_path = '' as $$
declare
  v_site text;
  v_today date := (now() at time zone 'Europe/Sofia')::date;
begin
  select s.value into v_site from public.app_settings s where s.key = 'site_url';
  v_site := coalesce(v_site, '');

  update public.notification_outbox q set status = 'skipped', last_error = 'остаряло (над 24 ч)'
   where q.status in ('pending', 'sending') and q.created_at < now() - interval '24 hours';
  update public.notification_outbox q set status = 'pending', claimed_at = null
   where q.status = 'sending' and q.claimed_at < now() - interval '10 minutes' and q.attempts < 3;
  update public.notification_outbox q set status = 'failed', claimed_at = null,
         last_error = coalesce(q.last_error, 'липсва потвърждение от n8n')
   where q.status = 'sending' and q.claimed_at < now() - interval '10 minutes' and q.attempts >= 3;

  return query
  with picked as (
    select o.id from public.notification_outbox o
     where o.status = 'pending' and o.notify_after <= now() and o.attempts < 3
     order by o.id limit p_limit for update skip locked
  ), marked as (
    update public.notification_outbox o
       set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
      from picked where o.id = picked.id
    returning o.id, o.org_id, o.recipient_id, o.channel, o.event, o.occurrence_id, o.task_title, o.detail, o.due_date
  ), grp as (
    select mk.recipient_id, mk.channel as ch, mk.event as ev, (array_agg(mk.org_id))[1] as org_id,
           array_agg(mk.id order by mk.id) as ids,
           array_agg(mk.task_title order by mk.id) as titles,
           array_agg(mk.detail order by mk.id) as details,
           array_agg(mk.occurrence_id order by mk.id) as occs,
           array_agg(mk.due_date order by mk.id) as dues
      from marked mk group by mk.recipient_id, mk.channel, mk.event
  ), x as (
    select g.*, split_part(m.display_name, ' ', 1) as fn, og.name as org_name,
           array_length(g.ids, 1) as n,
           (select string_agg('• ' || t, E'\n') from unnest(g.titles[1:8]) t)
             || case when array_length(g.titles, 1) > 8
                     then E'\n…и още ' || (array_length(g.titles, 1) - 8) else '' end as bullets,
           coalesce(p.email, case when u.email like '%.staff.teamtasks.app' then null else u.email end) as to_email,
           p.phone as to_phone
      from grp g
      join public.memberships m on m.id = g.recipient_id
      join auth.users u on u.id = m.user_id
      join public.organizations og on og.id = g.org_id
      left join public.notification_prefs p on p.membership_id = g.recipient_id
  )
  select x.ids, x.ch, x.ev,
         case x.ch when 'email' then x.to_email else x.to_phone end,
         case x.ev
           when 'new_task' then case when x.n = 1 then 'Нова задача: ' || x.titles[1] else 'Нови задачи: ' || x.n end
           else case when x.n = 1 then 'Върната задача: ' || x.titles[1] else 'Върнати задачи: ' || x.n end
         end,
         'Здравей, ' || x.fn || '! ' ||
         case x.ev
           when 'new_task' then
             case when x.n = 1
               then 'Имаш нова задача в „' || x.org_name || '“:' || E'\n• ' || x.titles[1]
                    || case when x.dues[1] > v_today then ' (за ' || to_char(x.dues[1], 'DD.MM.YYYY') || ')' else '' end
               else 'Имаш ' || x.n || ' нови задачи в „' || x.org_name || '“:' || E'\n' || x.bullets
             end
           else
             case when x.n = 1
               then 'Ръководителят върна задачата „' || x.titles[1] || '“'
                    || coalesce(' с коментар: „' || x.details[1] || '“', '')
                    || '. Поправи я и я изпрати отново.'
               else 'Ръководителят върна ' || x.n || ' задачи:' || E'\n' || x.bullets
             end
         end
         || E'\n\nОтвори: ' || v_site
         || case when x.n = 1 and x.occs[1] is not null then '/o/' || x.occs[1] else '/' end,
         v_site || case when x.n = 1 and x.occs[1] is not null then '/o/' || x.occs[1] else '/' end
    from x;
end $$;

-- n8n отчита резултата: успех, или грешка (до 3 опита, с пауза 2 минути)
create function public.finish_notifications(p_ids bigint[], p_ok boolean, p_error text default null)
returns void
language sql security definer set search_path = '' as $$
  update public.notification_outbox q set
    status = case when p_ok then 'sent' when q.attempts >= 3 then 'failed' else 'pending' end,
    sent_at = case when p_ok then now() end,
    last_error = case when p_ok then null else left(coalesce(p_error, 'грешка'), 300) end,
    notify_after = case when p_ok then q.notify_after else now() + interval '2 minutes' end,
    claimed_at = null
  where q.id = any (p_ids) and q.status = 'sending'
$$;

-- Сутрешно създаване на днешните повтарящи се задачи за всички фирми (вика го n8n в 05:30)
create function public.generate_today_all() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Europe/Sofia')::date; r record; n int := 0;
begin
  for r in select o.id from public.organizations o loop
    perform public.app_generate_occurrences(r.id, v_today, v_today);
    n := n + 1;
  end loop;
  return n;
end $$;

-- вътрешните функции не са достъпни за приложението; само службата на n8n (service_role)
revoke all on function public.app_enqueue_notification(uuid, text, uuid, text, text, date, timestamptz) from public, anon, authenticated;
revoke all on function public.trg_occurrence_notify() from public, anon, authenticated;
revoke all on function public.claim_notifications(int) from public, anon, authenticated;
revoke all on function public.finish_notifications(bigint[], boolean, text) from public, anon, authenticated;
revoke all on function public.generate_today_all() from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;
grant execute on function public.finish_notifications(bigint[], boolean, text) to service_role;
grant execute on function public.generate_today_all() to service_role;
revoke all on function public.app_can_edit_prefs(uuid, uuid) from public, anon;
grant execute on function public.app_can_edit_prefs(uuid, uuid) to authenticated;
