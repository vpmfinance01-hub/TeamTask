-- 0005: чеклист със стъпки, места (QR), шаблони на задачи, коментари.
-- ЧЕРНОВА: НЕ е пускана на истинска база (приложението работи само в демо режим).
-- Преди употреба – да се изпробва на тестова Postgres база, както 0001–0003.

alter table public.tasks
  add column steps jsonb not null default '[]'::jsonb,
  add column steps_required boolean not null default true,
  add column place_id uuid;
alter table public.occurrences
  add column steps_done jsonb not null default '[]'::jsonb;

create table public.places (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  code text not null unique,
  group_id uuid references public.groups(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.tasks add constraint tasks_place_fk foreign key (place_id) references public.places(id) on delete set null;

create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  occurrence_id uuid not null references public.occurrences(id) on delete cascade,
  author_id uuid not null references public.memberships(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index on public.task_comments (occurrence_id, created_at);

alter table public.places enable row level security;
alter table public.task_templates enable row level security;
alter table public.task_comments enable row level security;

-- места: четат всички членове (за сканиране), пишат ръководители
create policy pl_read on public.places for select to authenticated using (public.app_is_member(org_id));
create policy pl_write on public.places for insert to authenticated
  with check (public.app_is_manager(org_id) and public.app_has_access(org_id));
create policy pl_update on public.places for update to authenticated using (public.app_is_manager(org_id));
create policy pl_delete on public.places for delete to authenticated using (public.app_is_manager(org_id));

-- шаблони: само ръководители
create policy tt_all_read on public.task_templates for select to authenticated using (public.app_is_manager(org_id));
create policy tt_insert on public.task_templates for insert to authenticated
  with check (public.app_is_manager(org_id) and public.app_has_access(org_id));
create policy tt_delete on public.task_templates for delete to authenticated using (public.app_is_manager(org_id));

-- коментари: вижда ги, който вижда задачата (RLS на occurrences важи в подзаявката)
create policy tc_read on public.task_comments for select to authenticated
  using (exists (select 1 from public.occurrences o where o.id = occurrence_id));
create policy tc_insert on public.task_comments for insert to authenticated
  with check (
    author_id = public.app_my_member(org_id)
    and public.app_has_access(org_id)
    and exists (select 1 from public.occurrences o where o.id = occurrence_id)
  );

-- отметки на стъпките от изпълнителя
create function public.set_occurrence_steps(p_id uuid, p_done jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.occurrences; me uuid;
begin
  select * into o from public.occurrences where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  me := public.app_my_member(o.org_id);
  if me is null or not public.app_has_access(o.org_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if o.assignee_id is distinct from me
     and not (o.assignee_id is null and o.group_id is not null and public.app_in_group(o.group_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if o.status not in ('pending', 'rejected') then raise exception 'already_submitted' using errcode = 'P0001'; end if;
  update public.occurrences set steps_done = coalesce(p_done, '[]'::jsonb) where id = p_id;
end $$;
grant execute on function public.set_occurrence_steps(uuid, jsonb) to authenticated;

-- задължителни стъпки: проверка при изпращане (без пренаписване на submit_occurrence)
create function public.trg_steps_required() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; n int; k int;
begin
  if new.status in ('submitted', 'approved') and old.status in ('pending', 'rejected') then
    select * into t from public.tasks where id = new.task_id;
    n := jsonb_array_length(t.steps);
    if n > 0 and t.steps_required then
      select count(*) into k from jsonb_array_elements(new.steps_done) with ordinality as e(v, i)
        where e.v = 'true'::jsonb and e.i <= n;
      if k < n then raise exception 'steps_required' using errcode = 'P0001'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger occurrences_steps_required before update on public.occurrences
  for each row execute function public.trg_steps_required();
-- Забележка: модулите (checklist/qr/comments/offline/reports) се включват през org_settings.features.
-- TODO при пускане: app_generate_occurrences да копира steps_done = '[]' (подразбира се от default).
