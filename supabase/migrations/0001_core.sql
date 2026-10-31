-- TeamTasks: управление на персонал със задачи, потвърждения и абонаменти.
-- Много фирми (organizations) в една база; всяка таблица е защитена с RLS.
-- Всички записи по occurrences/occurrence_photos/memberships минават през RPC функции.

-- ---------------------------------------------------------------- типове
create type public.member_role as enum ('owner', 'manager', 'employee');
create type public.recurrence_kind as enum ('once', 'daily', 'weekly', 'monthly');
create type public.assign_mode as enum ('each', 'any');
create type public.occ_status as enum ('pending', 'submitted', 'approved', 'rejected');

-- ---------------------------------------------------------------- планове
create table public.plans (
  key text primary key,
  name text not null,
  price_eur numeric(8, 2) not null,
  max_members int not null,
  max_groups int not null,
  stripe_price_id text,
  sort int not null default 0
);

insert into public.plans (key, name, price_eur, max_members, max_groups, sort) values
  ('start',    'Старт',   9,   5,   2, 1),
  ('team',     'Екип',    29,  25,  10, 2),
  ('business', 'Бизнес',  79,  100, 50, 3);

-- ---------------------------------------------------------------- фирми
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  code text not null unique check (code ~ '^[a-z0-9]{3,20}$'),
  owner_id uuid not null references auth.users (id),
  plan_key text not null default 'team' references public.plans (key),
  sub_status text not null default 'trialing'
    check (sub_status in ('trialing', 'active', 'past_due', 'canceled')),
  trial_ends_at timestamptz not null default now() + interval '14 days',
  current_period_end timestamptz,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'employee',
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  username text check (username ~ '^[a-z0-9._-]{2,30}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, user_id),
  unique (org_id, username)
);
create index memberships_user_idx on public.memberships (user_id) where active;

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);
create index groups_org_idx on public.groups (org_id);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  is_leader boolean not null default false,
  primary key (group_id, membership_id)
);
create index group_members_member_idx on public.group_members (membership_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (length(trim(title)) between 2 and 120),
  description text,
  instructions text,
  group_id uuid references public.groups (id) on delete restrict,
  assignee_id uuid references public.memberships (id) on delete restrict,
  assign_mode public.assign_mode not null default 'each',
  priority smallint not null default 0 check (priority in (0, 1)),
  requires_note boolean not null default false,
  requires_photo boolean not null default false,
  requires_approval boolean not null default true,
  recurrence public.recurrence_kind not null default 'once',
  recurrence_days smallint[],
  start_date date not null default current_date,
  end_date date,
  due_time time,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  check (group_id is not null or assignee_id is not null),
  check (end_date is null or end_date >= start_date)
);
create index tasks_org_idx on public.tasks (org_id) where active;

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  path text not null,
  name text,
  created_at timestamptz not null default now()
);
create index task_attachments_task_idx on public.task_attachments (task_id);

create table public.occurrences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  due_date date not null,
  assignee_id uuid references public.memberships (id),
  status public.occ_status not null default 'pending',
  completed_by uuid references public.memberships (id),
  completed_at timestamptz,
  note text,
  reviewed_by uuid references public.memberships (id),
  reviewed_at timestamptz,
  review_comment text,
  created_at timestamptz not null default now()
);
create unique index occurrences_unique_idx on public.occurrences
  (task_id, due_date, coalesce(assignee_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index occurrences_org_date_idx on public.occurrences (org_id, due_date);
create index occurrences_assignee_idx on public.occurrences (assignee_id, due_date);
create index occurrences_review_idx on public.occurrences (org_id) where status = 'submitted';

create table public.occurrence_photos (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.occurrences (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);
create index occurrence_photos_occ_idx on public.occurrence_photos (occurrence_id);

-- ---------------------------------------------------------------- помощни функции
-- security definer, за да не се получава рекурсия в RLS политиките.
create function public.app_try_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create function public.app_my_member(p_org uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.memberships m
  where m.org_id = p_org and m.user_id = auth.uid() and m.active
$$;

create function public.app_is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.org_id = p_org and m.user_id = auth.uid() and m.active)
$$;

create function public.app_role(p_org uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m
  where m.org_id = p_org and m.user_id = auth.uid() and m.active
$$;

create function public.app_is_manager(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.app_role(p_org) in ('owner', 'manager'), false)
$$;

create function public.app_in_group(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members gm
    join public.memberships m on m.id = gm.membership_id
    where gm.group_id = p_group and m.user_id = auth.uid() and m.active)
$$;

create function public.app_leads_group(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members gm
    join public.memberships m on m.id = gm.membership_id
    where gm.group_id = p_group and gm.is_leader and m.user_id = auth.uid() and m.active)
$$;

-- собственик, или ръководител на групата
create function public.app_manages_group(p_org uuid, p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.app_role(p_org) = 'owner'
      or (p_group is not null and public.app_leads_group(p_group))
$$;

-- собственик, или ръководител на група, в която е служителят
create function public.app_manages_member(p_org uuid, p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.app_role(p_org) = 'owner'
      or exists (
        select 1 from public.group_members t
        join public.group_members l on l.group_id = t.group_id and l.is_leader
        join public.memberships lm on lm.id = l.membership_id
        where t.membership_id = p_member and lm.user_id = auth.uid() and lm.active)
$$;

create function public.app_can_manage_task(p_org uuid, p_group uuid, p_assignee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.app_is_manager(p_org) and (
    public.app_role(p_org) = 'owner'
    or (p_group is not null and public.app_leads_group(p_group))
    or (p_assignee is not null and public.app_manages_member(p_org, p_assignee)))
$$;

-- достъп според абонамента: пробен период или активен план (7 дни толеранс при неплащане)
create function public.app_has_access(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_org and (
      (o.sub_status = 'trialing' and o.trial_ends_at > now())
      or o.sub_status = 'active'
      or (o.sub_status = 'past_due'
          and coalesce(o.current_period_end, now()) + interval '7 days' > now())))
$$;

-- ---------------------------------------------------------------- тригери
create function public.trg_check_member_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int; cnt int;
begin
  if new.active and (tg_op = 'INSERT' or not old.active) then
    select p.max_members into lim from public.organizations o
      join public.plans p on p.key = o.plan_key where o.id = new.org_id;
    select count(*) into cnt from public.memberships
      where org_id = new.org_id and active and id <> new.id;
    if cnt >= lim then
      raise exception 'member_limit' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger memberships_limit before insert or update of active on public.memberships
  for each row execute function public.trg_check_member_limit();

create function public.trg_check_group_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim int; cnt int;
begin
  select p.max_groups into lim from public.organizations o
    join public.plans p on p.key = o.plan_key where o.id = new.org_id;
  select count(*) into cnt from public.groups where org_id = new.org_id;
  if cnt >= lim then
    raise exception 'group_limit' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger groups_limit before insert on public.groups
  for each row execute function public.trg_check_group_limit();

-- създателят на групата става неин ръководител
create function public.trg_group_creator_leader() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  me := public.app_my_member(new.org_id);
  if me is not null then
    insert into public.group_members (group_id, membership_id, org_id, is_leader)
    values (new.id, me, new.org_id, true) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger groups_creator_leader after insert on public.groups
  for each row execute function public.trg_group_creator_leader();

-- group_members: org_id се взима от групата и членството трябва да е от същата фирма
create function public.trg_group_member_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare g_org uuid; m_org uuid;
begin
  select org_id into g_org from public.groups where id = new.group_id;
  select org_id into m_org from public.memberships where id = new.membership_id;
  if g_org is null or g_org is distinct from m_org then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;
  new.org_id := g_org;
  return new;
end $$;
create trigger group_members_check before insert or update on public.group_members
  for each row execute function public.trg_group_member_check();

-- ---------------------------------------------------------------- RPC
create function public.create_organization(p_name text, p_code text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_org uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  insert into public.organizations (name, code, owner_id)
  values (trim(p_name), lower(trim(p_code)), v_uid) returning id into v_org;
  insert into public.memberships (org_id, user_id, role, display_name)
  values (v_org, v_uid, 'owner', trim(p_display_name));
  insert into public.groups (org_id, name) values (v_org, 'Общи');
  return v_org;
end $$;

create function public.app_update_member(
  p_member uuid, p_display_name text, p_active boolean, p_role public.member_role)
returns void
language plpgsql security definer set search_path = '' as $$
declare m public.memberships;
begin
  select * into m from public.memberships where id = p_member;
  if not found then raise exception 'not_found'; end if;
  if public.app_role(m.org_id) is distinct from 'owner' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if m.role = 'owner' and (p_role <> 'owner' or not p_active) then
    raise exception 'cannot_change_owner' using errcode = 'P0001';
  end if;
  if p_role = 'owner' and m.role <> 'owner' then
    raise exception 'cannot_change_owner' using errcode = 'P0001';
  end if;
  update public.memberships
    set display_name = trim(p_display_name), active = p_active, role = p_role
    where id = p_member;
end $$;

-- Ядро: създава (идемпотентно) заданията за период. Без проверка на викащия –
-- вика се само от тригерите и от ensure_occurrences (EXECUTE се отнема в края).
create function public.app_generate_occurrences(p_org uuid, p_from date, p_to date)
returns void
language plpgsql security definer set search_path = '' as $$
declare d date;
begin
  if not public.app_has_access(p_org) then return; end if;

  for d in select g::date from generate_series(p_from, p_to, interval '1 day') g loop
    insert into public.occurrences (org_id, task_id, group_id, due_date, assignee_id)
    select t.org_id, t.id, t.group_id, d, tgt.member_id
    from public.tasks t
    cross join lateral (
      select t.assignee_id as member_id
        where t.assignee_id is not null
          and exists (select 1 from public.memberships a where a.id = t.assignee_id and a.active)
      union all
      select m.id
        from public.group_members gm
        join public.memberships m on m.id = gm.membership_id
        where t.assignee_id is null and t.assign_mode = 'each'
          and gm.group_id = t.group_id and m.active and not gm.is_leader
      union all
      select null::uuid
        where t.assignee_id is null and t.assign_mode = 'any'
    ) tgt
    where t.org_id = p_org and t.active
      and d >= t.start_date and (t.end_date is null or d <= t.end_date)
      and (
        (t.recurrence = 'once' and d = t.start_date)
        or t.recurrence = 'daily'
        or (t.recurrence = 'weekly'
            and extract(dow from d)::int = any (
              coalesce(t.recurrence_days, array[extract(dow from t.start_date)::smallint])))
        or (t.recurrence = 'monthly'
            and extract(day from d)::int = least(
              extract(day from t.start_date)::int,
              extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int))
      )
    on conflict do nothing;
  end loop;
end $$;

-- За приложението: същото, но с проверка за членство и размер на периода.
create function public.ensure_occurrences(p_org uuid, p_from date, p_to date)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.app_is_member(p_org) then
    raise exception 'not_member' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'invalid_range';
  end if;
  perform public.app_generate_occurrences(p_org, p_from, p_to);
end $$;

-- Служителят получава задачата веднага: щом ръководителят създаде/промени задача
-- или добави човек в група, заданията за днес се създават в същия момент.
create function public.trg_task_generate_today() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Europe/Sofia')::date;
begin
  if new.active then
    perform public.app_generate_occurrences(new.org_id, v_today, v_today);
  end if;
  return new;
end $$;
create trigger tasks_generate_today after insert or update on public.tasks
  for each row execute function public.trg_task_generate_today();

create function public.trg_member_generate_today() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Europe/Sofia')::date;
begin
  perform public.app_generate_occurrences(new.org_id, v_today, v_today);
  return new;
end $$;
create trigger group_members_generate_today after insert on public.group_members
  for each row execute function public.trg_member_generate_today();

create function public.submit_occurrence(p_id uuid, p_note text, p_photos text[] default '{}')
returns public.occ_status
language plpgsql security definer set search_path = '' as $$
declare
  o public.occurrences; t public.tasks; me uuid; n_photos int;
  new_status public.occ_status; p text;
begin
  select * into o from public.occurrences where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  me := public.app_my_member(o.org_id);
  if me is null then raise exception 'not_member' using errcode = '42501'; end if;
  if not public.app_has_access(o.org_id) then
    raise exception 'subscription_inactive' using errcode = 'P0001';
  end if;
  select * into t from public.tasks where id = o.task_id;

  if o.assignee_id is distinct from me then
    if not (o.assignee_id is null and o.group_id is not null and public.app_in_group(o.group_id)) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
  end if;
  if o.status not in ('pending', 'rejected') then
    raise exception 'already_submitted' using errcode = 'P0001';
  end if;

  foreach p in array coalesce(p_photos, '{}') loop
    if p not like o.org_id::text || '/proof/%' then
      raise exception 'bad_photo_path' using errcode = '42501';
    end if;
  end loop;

  select count(*) into n_photos from public.occurrence_photos where occurrence_id = o.id;
  n_photos := n_photos + coalesce(array_length(p_photos, 1), 0);
  if t.requires_photo and n_photos = 0 then
    raise exception 'photo_required' using errcode = 'P0001';
  end if;
  if t.requires_note and length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'note_required' using errcode = 'P0001';
  end if;

  new_status := case when t.requires_approval then 'submitted' else 'approved' end;

  insert into public.occurrence_photos (occurrence_id, org_id, path)
  select o.id, o.org_id, x from unnest(coalesce(p_photos, '{}')) x;

  update public.occurrences set
    status = new_status, assignee_id = me, completed_by = me, completed_at = now(),
    note = nullif(trim(coalesce(p_note, '')), ''),
    reviewed_by = null, reviewed_at = null, review_comment = null
  where id = o.id;
  return new_status;
end $$;

create function public.review_occurrence(p_id uuid, p_approve boolean, p_comment text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare o public.occurrences; me uuid;
begin
  select * into o from public.occurrences where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  me := public.app_my_member(o.org_id);
  if me is null or not public.app_is_manager(o.org_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not (public.app_manages_group(o.org_id, o.group_id)
          or (o.completed_by is not null and public.app_manages_member(o.org_id, o.completed_by))) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not public.app_has_access(o.org_id) then
    raise exception 'subscription_inactive' using errcode = 'P0001';
  end if;
  if o.status <> 'submitted' then
    raise exception 'not_submitted' using errcode = 'P0001';
  end if;
  if o.completed_by = me and public.app_role(o.org_id) <> 'owner' then
    raise exception 'cannot_review_own' using errcode = 'P0001';
  end if;
  if not p_approve and length(trim(coalesce(p_comment, ''))) = 0 then
    raise exception 'comment_required' using errcode = 'P0001';
  end if;
  update public.occurrences set
    status = (case when p_approve then 'approved' else 'rejected' end)::public.occ_status,
    reviewed_by = me, reviewed_at = now(),
    review_comment = nullif(trim(coalesce(p_comment, '')), '')
  where id = o.id;
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.plans enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_attachments enable row level security;
alter table public.occurrences enable row level security;
alter table public.occurrence_photos enable row level security;

create policy plans_read on public.plans for select to authenticated using (true);

create policy org_read on public.organizations for select to authenticated
  using (public.app_is_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.app_role(id) = 'owner') with check (public.app_role(id) = 'owner');

create policy members_read on public.memberships for select to authenticated
  using (public.app_is_member(org_id));

create policy groups_read on public.groups for select to authenticated
  using (public.app_is_member(org_id));
create policy groups_insert on public.groups for insert to authenticated
  with check (public.app_is_manager(org_id) and public.app_has_access(org_id));
create policy groups_update on public.groups for update to authenticated
  using (public.app_manages_group(org_id, id))
  with check (public.app_manages_group(org_id, id) and public.app_has_access(org_id));
create policy groups_delete on public.groups for delete to authenticated
  using (public.app_manages_group(org_id, id));

create policy gm_read on public.group_members for select to authenticated
  using (public.app_is_member(org_id));
create policy gm_insert on public.group_members for insert to authenticated
  with check (public.app_manages_group(org_id, group_id) and public.app_has_access(org_id));
create policy gm_update on public.group_members for update to authenticated
  using (public.app_manages_group(org_id, group_id))
  with check (public.app_manages_group(org_id, group_id));
create policy gm_delete on public.group_members for delete to authenticated
  using (public.app_manages_group(org_id, group_id));

create policy tasks_read on public.tasks for select to authenticated
  using (
    public.app_is_member(org_id) and (
      public.app_role(org_id) = 'owner'
      or created_by = auth.uid()
      or public.app_can_manage_task(org_id, group_id, assignee_id)
      or assignee_id = public.app_my_member(org_id)
      or (group_id is not null and public.app_in_group(group_id))));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.app_has_access(org_id)
    and public.app_can_manage_task(org_id, group_id, assignee_id)
    and (group_id is null or exists (select 1 from public.groups g where g.id = group_id and g.org_id = tasks.org_id))
    and (assignee_id is null or exists (select 1 from public.memberships m where m.id = assignee_id and m.org_id = tasks.org_id)));
create policy tasks_update on public.tasks for update to authenticated
  using (public.app_can_manage_task(org_id, group_id, assignee_id))
  with check (
    public.app_has_access(org_id)
    and public.app_can_manage_task(org_id, group_id, assignee_id)
    and (group_id is null or exists (select 1 from public.groups g where g.id = group_id and g.org_id = tasks.org_id))
    and (assignee_id is null or exists (select 1 from public.memberships m where m.id = assignee_id and m.org_id = tasks.org_id)));
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.app_can_manage_task(org_id, group_id, assignee_id));

create policy attach_read on public.task_attachments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy attach_insert on public.task_attachments for insert to authenticated
  with check (public.app_is_manager(org_id) and public.app_has_access(org_id)
    and exists (select 1 from public.tasks t where t.id = task_id and t.org_id = task_attachments.org_id)
    and path like org_id::text || '/instructions/%');
create policy attach_delete on public.task_attachments for delete to authenticated
  using (public.app_is_manager(org_id));

create policy occ_read on public.occurrences for select to authenticated
  using (
    public.app_is_member(org_id) and (
      assignee_id = public.app_my_member(org_id)
      or (assignee_id is null and group_id is not null and public.app_in_group(group_id))
      or public.app_role(org_id) = 'owner'
      or (public.app_is_manager(org_id) and (
            public.app_manages_group(org_id, group_id)
            or (assignee_id is not null and public.app_manages_member(org_id, assignee_id))))));

create policy photos_read on public.occurrence_photos for select to authenticated
  using (exists (select 1 from public.occurrences o where o.id = occurrence_id));

-- директните записи са забранени; всичко минава през RPC
revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.plans, public.memberships,
  public.occurrences, public.occurrence_photos from authenticated;
revoke insert, delete, update on public.organizations from authenticated;
grant update (name) on public.organizations to authenticated;

-- функциите: само влезли потребители
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- вътрешни функции – не се викат от приложението
revoke execute on function public.app_generate_occurrences(uuid, date, date) from authenticated;
revoke execute on function public.trg_task_generate_today() from authenticated;
revoke execute on function public.trg_member_generate_today() from authenticated;

-- ---------------------------------------------------------------- Storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-files', 'task-files', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- път: {org_id}/instructions/... (виждат всички) или {org_id}/proof/... (ръководители и качилият)
create policy tf_read on storage.objects for select to authenticated
  using (
    bucket_id = 'task-files'
    and public.app_is_member(public.app_try_uuid((storage.foldername(name))[1]))
    and (
      (storage.foldername(name))[2] = 'instructions'
      or public.app_is_manager(public.app_try_uuid((storage.foldername(name))[1]))
      or owner_id = auth.uid()::text));

create policy tf_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-files'
    and public.app_is_member(public.app_try_uuid((storage.foldername(name))[1]))
    and public.app_has_access(public.app_try_uuid((storage.foldername(name))[1]))
    and (
      (storage.foldername(name))[2] = 'proof'
      or ((storage.foldername(name))[2] = 'instructions'
          and public.app_is_manager(public.app_try_uuid((storage.foldername(name))[1])))));

create policy tf_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-files'
    and (public.app_is_manager(public.app_try_uuid((storage.foldername(name))[1]))
         or owner_id = auth.uid()::text));
