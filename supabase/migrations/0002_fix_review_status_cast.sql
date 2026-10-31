-- Поправка (намерена при проверка на жива база): review_occurrence записваше статуса като text вместо occ_status.
-- Нови инсталации вече имат поправката в 0001; тази миграция е за бази, създадени преди нея.
create or replace function public.review_occurrence(p_id uuid, p_approve boolean, p_comment text default null)
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
