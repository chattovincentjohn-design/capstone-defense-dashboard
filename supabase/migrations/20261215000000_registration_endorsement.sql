-- Endorsement letter required for group registration.
--  * On /register the group uploads a digital or scanned copy of its endorsement
--    (PDF, JPG or PNG, up to 10 MB) and must choose its adviser from the CDEMS list.
--  * The chosen adviser verifies (or returns) it from their own CDEMS account.
--  * The Coordinator can schedule the group only after the adviser has verified it.
--    Registrations made before this requirement are marked 'none' and are not blocked.

-- Private storage: incoming/<random uuid>.<pdf|jpg|jpeg|png>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('endorsements', 'endorsements', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create or replace function public.registration_is_open() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_open and access_code <> '' from public.registration_settings where id = 1), false)
$$;
revoke execute on function public.registration_is_open() from public;
grant execute on function public.registration_is_open() to anon, authenticated;

alter table public.group_registrations
  add column endorsement_path text,
  add column endorsement_status text not null default 'none'
    check (endorsement_status in ('none', 'pending', 'verified', 'returned')),
  add column endorsement_note text not null default '' check (length(endorsement_note) <= 1000),
  add column endorsement_reviewed_at timestamptz,
  add column endorsement_reviewed_by uuid references public.users (id) on delete set null;
create unique index group_registrations_endorsement_path_key on public.group_registrations (endorsement_path)
  where endorsement_path is not null;
create index group_registrations_reviewed_by_idx on public.group_registrations (endorsement_reviewed_by);

grant select (endorsement_path, endorsement_status, endorsement_note, endorsement_reviewed_at, endorsement_reviewed_by)
  on public.group_registrations to authenticated;

-- The assigned adviser sees the registrations that name them.
create policy group_registrations_adviser_read on public.group_registrations for select to authenticated
  using (adviser_id = (select auth.uid()));

-- Upload while registration is open (the page is used signed out); never overwrite.
create policy endorsements_upload on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'endorsements'
    and name ~ '^incoming/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$'
    and public.registration_is_open());
-- Read: the Coordinator, and the adviser named on that registration.
create policy endorsements_read on storage.objects for select to authenticated
  using (bucket_id = 'endorsements' and (
    public.is_admin()
    or exists (select 1 from public.group_registrations r
                where r.endorsement_path = storage.objects.name and r.adviser_id = (select auth.uid()))));
create policy endorsements_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'endorsements' and public.is_admin());

-- Registration now requires a listed adviser and the uploaded endorsement.
create or replace function public.submit_group_registration(p_code text, p_reg jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  s public.registration_settings;
  v_id uuid;
  v_adviser uuid := nullif(p_reg->>'adviser_id', '')::uuid;
  v_members jsonb := coalesce(p_reg->'members', '[]'::jsonb);
  v_idx int := coalesce((p_reg->>'authorized_index')::int, -1);
  v_pw text := coalesce(p_reg->>'password', '');
  v_endorsement text := trim(coalesce(p_reg->>'endorsement_path', ''));
  v_auth_email text;
  m jsonb;
  v_email_re text := '^[^@\s]+@[^@\s]+\.[^@\s]+$';
begin
  select * into s from public.registration_settings where id = 1;
  if s.id is null or not s.is_open or s.access_code = '' then raise exception 'Group registration is closed.'; end if;
  if lower(trim(coalesce(p_code, ''))) <> lower(trim(s.access_code)) then raise exception 'The registration code is incorrect.'; end if;

  if coalesce(trim(p_reg->>'group_label'), '') = '' then raise exception 'Group name is required.'; end if;
  if coalesce(trim(p_reg->>'title'), '') = '' then raise exception 'Project title is required.'; end if;
  if coalesce(trim(p_reg->>'academic_year'), '') !~ '^\d{4}-\d{4}$' then raise exception 'Academic year must look like 2026-2027.'; end if;
  if v_adviser is null or not exists (
       select 1 from public.users u join auth.users a on a.id = u.id
        where u.id = v_adviser and u.role in ('adviser', 'chair', 'panelist', 'admin', 'superadmin')
          and (a.banned_until is null or a.banned_until <= now())) then
    raise exception 'Choose your capstone adviser from the list. They verify your endorsement in CDEMS.';
  end if;
  if v_endorsement !~ '^incoming/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png)$'
     or not exists (select 1 from storage.objects where bucket_id = 'endorsements' and name = v_endorsement) then
    raise exception 'Upload a digital or scanned copy of your endorsement before submitting.';
  end if;
  if exists (select 1 from public.group_registrations where endorsement_path = v_endorsement) then
    raise exception 'That endorsement file was already used. Upload it again.';
  end if;
  if jsonb_typeof(v_members) <> 'array' or jsonb_array_length(v_members) not between 1 and 10 then
    raise exception 'A group needs 1 to 10 members.';
  end if;
  for m in select * from jsonb_array_elements(v_members) loop
    if coalesce(trim(m->>'student_name'), '') = '' or coalesce(trim(m->>'student_number'), '') = ''
       or coalesce(trim(m->>'email'), '') !~ v_email_re
       or length(m->>'student_name') > 120 or length(m->>'student_number') > 40 or length(m->>'email') > 254 then
      raise exception 'Every member needs a full name, student number and valid email.';
    end if;
  end loop;
  if v_idx < 0 or v_idx >= jsonb_array_length(v_members) then raise exception 'Choose the group''s authorized member.'; end if;
  if length(v_pw) not between 8 and 72 then raise exception 'The group account password must be 8 to 72 characters.'; end if;
  v_auth_email := lower(trim(v_members->v_idx->>'email'));
  if exists (select 1 from public.users where lower(email) = v_auth_email and role <> 'student') then
    raise exception 'The authorized member''s email belongs to a faculty account. Use the student''s own email.';
  end if;
  if (select count(*) from public.group_registrations where status = 'pending') >= 300 then
    raise exception 'Too many pending registrations. Ask the Coordinator to review them first.';
  end if;

  insert into public.group_registrations
    (group_label, title, academic_year, adviser_id, adviser_name, members, manuscript_url, demo_url, abstract,
     contact_email, authorized_index, password_hash, endorsement_path, endorsement_status)
  values (
    trim(p_reg->>'group_label'), trim(p_reg->>'title'), trim(p_reg->>'academic_year'), v_adviser, '',
    (select jsonb_agg(jsonb_build_object(
        'student_name', trim(e->>'student_name'), 'student_number', trim(e->>'student_number'), 'email', lower(trim(e->>'email'))))
       from jsonb_array_elements(v_members) e),
    trim(coalesce(p_reg->>'manuscript_url', '')), trim(coalesce(p_reg->>'demo_url', '')), trim(coalesce(p_reg->>'abstract', '')),
    v_auth_email, v_idx, crypt(v_pw, gen_salt('bf')), v_endorsement, 'pending')
  returning id into v_id;
  return v_id;
end $$;

-- Only the adviser named on the registration can verify or return its endorsement.
create or replace function public.review_endorsement(p_registration uuid, p_verified boolean, p_note text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare r public.group_registrations;
begin
  select * into r from public.group_registrations where id = p_registration for update;
  if r.id is null then raise exception 'Registration not found.'; end if;
  if r.adviser_id is distinct from auth.uid() then
    raise exception 'Only the group''s capstone adviser can verify this endorsement.';
  end if;
  if r.endorsement_path is null then raise exception 'This registration has no endorsement to verify.'; end if;
  if r.status <> 'pending' then raise exception 'This registration is already %.', r.status; end if;
  if not p_verified and length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'Tell the group why the endorsement is returned.';
  end if;
  update public.group_registrations
     set endorsement_status = case when p_verified then 'verified' else 'returned' end,
         endorsement_note = left(trim(coalesce(p_note, '')), 1000),
         endorsement_reviewed_at = now(), endorsement_reviewed_by = auth.uid()
   where id = r.id;
end $$;
revoke execute on function public.review_endorsement(uuid, boolean, text) from public, anon;
grant execute on function public.review_endorsement(uuid, boolean, text) to authenticated;

-- The Coordinator cannot mark a registration scheduled until its endorsement is verified.
create or replace function public.require_verified_endorsement() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'scheduled' and old.status is distinct from 'scheduled'
     and new.endorsement_status not in ('verified', 'none') then
    raise exception 'The adviser has not verified this group''s endorsement yet.';
  end if;
  return new;
end $$;
create trigger group_registrations_require_endorsement before update of status on public.group_registrations
  for each row execute function public.require_verified_endorsement();

-- API callers may change only the status column; endorsement fields change through review_endorsement().
revoke update on public.group_registrations from authenticated;
grant update (status) on public.group_registrations to authenticated;
