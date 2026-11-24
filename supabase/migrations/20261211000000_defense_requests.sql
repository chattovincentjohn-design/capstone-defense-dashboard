-- Defense requests: a group's account asks for a defense (stage, preferred date, proposed
-- panel), uploading its manuscript PDF and writing the abstract (both required). The
-- Coordinator reviews and schedules it, confirming or changing the proposed panel.

-- Private storage for manuscripts: <project_id>/<file>.pdf
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manuscripts', 'manuscripts', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;

create policy manuscripts_read on storage.objects for select to authenticated
  using (bucket_id = 'manuscripts'
         and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and public.can_view_project(((storage.foldername(name))[1])::uuid));
create policy manuscripts_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'manuscripts' and lower(name) like '%.pdf'
    and (public.is_admin() or exists (
      select 1 from public.project_members m
       where m.user_id = auth.uid() and m.project_id::text = (storage.foldername(name))[1])));
create policy manuscripts_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'manuscripts' and public.is_admin());

create table public.defense_requests (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.capstone_projects (id) on delete cascade,
  requested_by    uuid references public.users (id) on delete set null,
  stage           public.defense_stage not null,
  preferred_at    timestamptz,
  chair_id        uuid references public.users (id) on delete set null,
  member_ids      uuid[] not null default '{}',
  manuscript_path text not null check (manuscript_path <> ''),
  abstract        text not null check (length(trim(abstract)) between 50 and 5000),
  note            text not null default '' check (length(note) <= 1000),
  status          text not null default 'pending' check (status in ('pending', 'scheduled', 'rejected', 'cancelled')),
  created_at      timestamptz not null default now()
);
create index defense_requests_project_idx on public.defense_requests (project_id);
create index defense_requests_requested_by_idx on public.defense_requests (requested_by);
create index defense_requests_chair_idx on public.defense_requests (chair_id);
alter table public.defense_requests enable row level security;

create policy defense_requests_admin on public.defense_requests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy defense_requests_group_read on public.defense_requests for select to authenticated
  using (exists (select 1 from public.project_members m where m.project_id = defense_requests.project_id and m.user_id = (select auth.uid())));

-- The only way for a group to create a request: every requirement is checked here.
create or replace function public.submit_defense_request(
  p_project uuid, p_stage public.defense_stage, p_preferred_at timestamptz, p_chair uuid, p_members uuid[],
  p_manuscript_path text, p_abstract text, p_note text default ''
) returns uuid
language plpgsql security definer set search_path = public, storage as $$
declare v_id uuid; v_adviser uuid; v_bad int;
begin
  if not exists (select 1 from public.project_members where project_id = p_project and user_id = auth.uid()) then
    raise exception 'Only your group''s account can request its defense.';
  end if;
  if exists (select 1 from public.defense_requests where project_id = p_project and status = 'pending') then
    raise exception 'Your group already has a pending request. Wait for the Coordinator, or cancel it first.';
  end if;
  if coalesce(trim(p_manuscript_path), '') = '' or split_part(p_manuscript_path, '/', 1) <> p_project::text
     or lower(p_manuscript_path) not like '%.pdf'
     or not exists (select 1 from storage.objects where bucket_id = 'manuscripts' and name = p_manuscript_path) then
    raise exception 'Upload your manuscript (PDF) before submitting.';
  end if;
  if length(trim(coalesce(p_abstract, ''))) < 50 then raise exception 'Write the abstract (at least 50 characters) before submitting.'; end if;
  if length(p_abstract) > 5000 then raise exception 'The abstract is too long (5,000 characters at most).'; end if;
  select adviser_id into v_adviser from public.capstone_projects where id = p_project;
  if p_chair is null then raise exception 'Choose the Defense Chair.'; end if;
  if coalesce(array_length(p_members, 1), 0) < 2 then raise exception 'Choose at least two panel members.'; end if;
  if p_chair = any(p_members) then raise exception 'The Chair cannot also be a panel member.'; end if;
  if v_adviser is not null and (p_chair = v_adviser or v_adviser = any(p_members)) then
    raise exception 'Your adviser cannot sit on your panel.';
  end if;
  select count(*) into v_bad from unnest(array_append(p_members, p_chair)) f(id)
   where not exists (select 1 from public.users u where u.id = f.id and u.role in ('chair', 'panelist', 'adviser', 'admin', 'superadmin'));
  if v_bad > 0 then raise exception 'Choose the panel from the faculty list.'; end if;

  insert into public.defense_requests (project_id, requested_by, stage, preferred_at, chair_id, member_ids, manuscript_path, abstract, note)
  values (p_project, auth.uid(), p_stage, p_preferred_at, p_chair, (select array_agg(distinct x) from unnest(p_members) x),
          p_manuscript_path, trim(p_abstract), trim(coalesce(p_note, '')))
  returning id into v_id;
  return v_id;
end $$;

-- The group may withdraw its own pending request.
create or replace function public.cancel_defense_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.defense_requests r set status = 'cancelled'
   where r.id = p_request and r.status = 'pending'
     and exists (select 1 from public.project_members m where m.project_id = r.project_id and m.user_id = auth.uid());
  if not found then raise exception 'Request not found or no longer pending.'; end if;
end $$;

-- After scheduling: mark the request done and make its manuscript and abstract the project's.
create or replace function public.complete_defense_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.defense_requests;
begin
  if not public.is_admin() then raise exception 'Only the Capstone Coordinator can schedule defenses'; end if;
  select * into r from public.defense_requests where id = p_request for update;
  if r.id is null then raise exception 'Request not found'; end if;
  update public.capstone_projects set manuscript_url = 'storage:' || r.manuscript_path, abstract = r.abstract where id = r.project_id;
  update public.defense_requests set status = 'scheduled' where id = r.id;
end $$;

revoke execute on function public.submit_defense_request(uuid, public.defense_stage, timestamptz, uuid, uuid[], text, text, text),
  public.cancel_defense_request(uuid), public.complete_defense_request(uuid) from public, anon;
grant execute on function public.submit_defense_request(uuid, public.defense_stage, timestamptz, uuid, uuid[], text, text, text),
  public.cancel_defense_request(uuid), public.complete_defense_request(uuid) to authenticated;
