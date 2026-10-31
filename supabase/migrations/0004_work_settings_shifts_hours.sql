-- Настройки на фирмата (работодател), видимост за служителите (по групи), смени/графици и часове.
-- ЧЕРНОВА: съответства на демото (src/lib/demo/client.ts), но още НЕ е изпълнявана срещу истинска база.
-- При първото свързване да се пусне първо в празна база/клон и да се провери (по образеца на deploy/tests/*.mjs).

-- ---------------------------------------------------------------- настройки
create table public.org_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  features jsonb not null default '{}'::jsonb, -- {"calendar":true,"shifts":false,"timeclock":false,"languages":false}
  languages text[] not null default '{bg}',
  updated_at timestamptz not null default now()
);

-- какво виждат/могат служителите на група: {"see_calendar":true,"see_schedule":"none|own|group","see_hours":true,"self_clock":true,"see_history":true}
create table public.group_settings (
  group_id uuid primary key references public.groups (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  visibility jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- смени и часове
create table public.shift_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  start_time time not null,
  end_time time not null, -- по-малко от началото = минава полунощ
  color text not null default '#1f4d3f' check (color ~ '^#[0-9a-fA-F]{6}$'),
  break_min int not null default 30 check (break_min between 0 and 600),
  created_at timestamptz not null default now()
);
create index shift_types_org_idx on public.shift_types (org_id);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  date date not null,
  kind text not null default 'work' check (kind in ('work', 'off', 'leave', 'sick')),
  shift_type_id uuid references public.shift_types (id) on delete set null,
  start_time time,
  end_time time,
  break_min int not null default 0 check (break_min between 0 and 600),
  note text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (membership_id, date),
  check (kind <> 'work' or (start_time is not null and end_time is not null))
);
create index shifts_org_date_idx on public.shifts (org_id, date);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  shift_id uuid references public.shifts (id) on delete set null,
  work_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  break_min int not null default 0 check (break_min between 0 and 600),
  method text not null default 'self' check (method in ('self', 'manager')),
  note text,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at)
);
create index time_entries_org_date_idx on public.time_entries (org_id, work_date);
-- само един отворен запис (смяна в ход) на човек
create unique index time_entries_one_open_idx on public.time_entries (membership_id) where ended_at is null;

-- ---------------------------------------------------------------- помощни функции
create function public.app_module_on(p_org uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select (s.features ->> p_key)::boolean from public.org_settings s where s.org_id = p_org),
    p_key = 'calendar')
$$;

-- булева настройка за видимост; служител в няколко групи получава най-широките права
create function public.app_vis_flag(p_org uuid, p_key text, p_default boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select bool_or(coalesce((gs.visibility ->> p_key)::boolean, p_default))
       from public.group_members gm
       join public.memberships m on m.id = gm.membership_id
       left join public.group_settings gs on gs.group_id = gm.group_id
      where m.user_id = auth.uid() and m.org_id = p_org and m.active),
    p_default)
$$;

-- график: 'none' | 'own' | 'group' (най-широкото от групите на човека)
create function public.app_schedule_vis(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case max(case coalesce(gs.visibility ->> 'see_schedule', 'own') when 'group' then 2 when 'own' then 1 else 0 end)
              when 2 then 'group' when 1 then 'own' else 'none' end
       from public.group_members gm
       join public.memberships m on m.id = gm.membership_id
       left join public.group_settings gs on gs.group_id = gm.group_id
      where m.user_id = auth.uid() and m.org_id = p_org and m.active),
    'own')
$$;

-- Може ли текущият човек да види дадена смяна (служител: само публикувани, според настройките на групите му)
create function public.app_can_see_shift(p_org uuid, p_member uuid, p_published boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    (public.app_is_manager(p_org) and public.app_manages_member(p_org, p_member))
    or (
      p_published and public.app_is_member(p_org) and public.app_module_on(p_org, 'shifts')
      and (
        (p_member = public.app_my_member(p_org) and public.app_schedule_vis(p_org) <> 'none')
        or (public.app_schedule_vis(p_org) = 'group' and exists (
              select 1 from public.group_members a
              join public.group_members b on b.group_id = a.group_id and not b.is_leader
             where a.membership_id = public.app_my_member(p_org) and b.membership_id = p_member))
      ))
$$;

-- ---------------------------------------------------------------- RLS
alter table public.org_settings enable row level security;
alter table public.group_settings enable row level security;
alter table public.shift_types enable row level security;
alter table public.shifts enable row level security;
alter table public.time_entries enable row level security;

create policy os_read on public.org_settings for select to authenticated using (public.app_is_member(org_id));
create policy os_insert on public.org_settings for insert to authenticated
  with check (public.app_role(org_id) = 'owner' and public.app_has_access(org_id));
create policy os_update on public.org_settings for update to authenticated
  using (public.app_role(org_id) = 'owner') with check (public.app_role(org_id) = 'owner' and public.app_has_access(org_id));

create policy gs_read on public.group_settings for select to authenticated using (public.app_is_member(org_id));
create policy gs_insert on public.group_settings for insert to authenticated
  with check (public.app_manages_group(org_id, group_id) and public.app_has_access(org_id)
              and exists (select 1 from public.groups g where g.id = group_id and g.org_id = group_settings.org_id));
create policy gs_update on public.group_settings for update to authenticated
  using (public.app_manages_group(org_id, group_id))
  with check (public.app_manages_group(org_id, group_id) and public.app_has_access(org_id));

create policy st_read on public.shift_types for select to authenticated using (public.app_is_member(org_id));
create policy st_write on public.shift_types for insert to authenticated
  with check (public.app_is_manager(org_id) and public.app_has_access(org_id));
create policy st_update on public.shift_types for update to authenticated
  using (public.app_is_manager(org_id)) with check (public.app_is_manager(org_id) and public.app_has_access(org_id));
create policy st_delete on public.shift_types for delete to authenticated using (public.app_is_manager(org_id));

create policy sh_read on public.shifts for select to authenticated
  using (public.app_can_see_shift(org_id, membership_id, published));
create policy sh_insert on public.shifts for insert to authenticated
  with check (public.app_is_manager(org_id) and public.app_has_access(org_id) and public.app_manages_member(org_id, membership_id)
              and exists (select 1 from public.memberships m where m.id = membership_id and m.org_id = shifts.org_id));
create policy sh_update on public.shifts for update to authenticated
  using (public.app_is_manager(org_id) and public.app_manages_member(org_id, membership_id))
  with check (public.app_is_manager(org_id) and public.app_has_access(org_id) and public.app_manages_member(org_id, membership_id));
create policy sh_delete on public.shifts for delete to authenticated
  using (public.app_is_manager(org_id) and public.app_manages_member(org_id, membership_id));

-- часове: ръководителят вижда/въвежда/одобрява за хората си; служителят – само своите, и само ако е разрешено
create policy te_read on public.time_entries for select to authenticated
  using (
    (public.app_is_manager(org_id) and public.app_manages_member(org_id, membership_id))
    or (membership_id = public.app_my_member(org_id) and public.app_module_on(org_id, 'timeclock')
        and (public.app_vis_flag(org_id, 'see_hours', true) or public.app_vis_flag(org_id, 'self_clock', true))));
create policy te_insert on public.time_entries for insert to authenticated
  with check (
    public.app_has_access(org_id)
    and exists (select 1 from public.memberships m where m.id = membership_id and m.org_id = time_entries.org_id)
    and (
      (public.app_is_manager(org_id) and public.app_manages_member(org_id, membership_id))
      or (membership_id = public.app_my_member(org_id) and method = 'self' and not approved and ended_at is null
          and public.app_module_on(org_id, 'timeclock') and public.app_vis_flag(org_id, 'self_clock', true)
          and started_at between now() - interval '10 minutes' and now() + interval '5 minutes')));
create policy te_update on public.time_entries for update to authenticated
  using (
    (public.app_is_manager(org_id) and public.app_manages_member(org_id, membership_id))
    or (membership_id = public.app_my_member(org_id) and ended_at is null and method = 'self'))
  with check (
    public.app_has_access(org_id)
    and (
      (public.app_is_manager(org_id) and public.app_manages_member(org_id, membership_id))
      or (membership_id = public.app_my_member(org_id) and method = 'self' and not approved
          and ended_at between now() - interval '5 minutes' and now() + interval '5 minutes')));
create policy te_delete on public.time_entries for delete to authenticated
  using (public.app_is_manager(org_id) and public.app_manages_member(org_id, membership_id));

revoke all on public.org_settings, public.group_settings, public.shift_types, public.shifts, public.time_entries from anon;
revoke all on function public.app_module_on(uuid, text) from public, anon;
revoke all on function public.app_vis_flag(uuid, text, boolean) from public, anon;
revoke all on function public.app_schedule_vis(uuid) from public, anon;
revoke all on function public.app_can_see_shift(uuid, uuid, boolean) from public, anon;
grant execute on function public.app_module_on(uuid, text) to authenticated;
grant execute on function public.app_vis_flag(uuid, text, boolean) to authenticated;
grant execute on function public.app_schedule_vis(uuid) to authenticated;
grant execute on function public.app_can_see_shift(uuid, uuid, boolean) to authenticated;
