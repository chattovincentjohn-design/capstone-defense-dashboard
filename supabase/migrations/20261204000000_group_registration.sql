-- Group self-registration: groups submit their project and members on a public page
-- (/register) using a code from the Coordinator; the Coordinator reviews them and
-- schedules the defense from a submission.

create table public.registration_settings (
  id          smallint primary key default 1 check (id = 1),
  is_open     boolean not null default false,
  access_code text not null default '',
  updated_at  timestamptz not null default now()
);
insert into public.registration_settings default values;

create table public.group_registrations (
  id             uuid primary key default gen_random_uuid(),
  group_label    text not null check (length(group_label) between 1 and 60),
  title          text not null check (length(title) between 1 and 300),
  academic_year  text not null check (academic_year ~ '^\d{4}-\d{4}$'),
  adviser_id     uuid references public.users (id) on delete set null,
  adviser_name   text not null default '' check (length(adviser_name) <= 120),
  members        jsonb not null check (jsonb_typeof(members) = 'array'),
  manuscript_url text not null default '' check (length(manuscript_url) <= 500),
  demo_url       text not null default '' check (length(demo_url) <= 500),
  abstract       text not null default '' check (length(abstract) <= 5000),
  contact_email  text not null check (length(contact_email) <= 254),
  status         text not null default 'pending' check (status in ('pending', 'scheduled', 'rejected')),
  created_at     timestamptz not null default now()
);
create index group_registrations_created_idx on public.group_registrations (created_at desc);
create index group_registrations_adviser_idx on public.group_registrations (adviser_id);

alter table public.registration_settings enable row level security;
alter table public.group_registrations enable row level security;
create policy registration_settings_admin on public.registration_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy group_registrations_admin on public.group_registrations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Signed-out callers can only use these two functions, and only with the right code.
create or replace function public.registration_form_info(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.registration_settings;
begin
  select * into s from public.registration_settings where id = 1;
  if s.id is null or not s.is_open or s.access_code = '' then
    return jsonb_build_object('open', false, 'valid', false, 'advisers', '[]'::jsonb);
  end if;
  if lower(trim(coalesce(p_code, ''))) <> lower(trim(s.access_code)) then
    return jsonb_build_object('open', true, 'valid', false, 'advisers', '[]'::jsonb);
  end if;
  return jsonb_build_object('open', true, 'valid', true, 'advisers', coalesce((
    select jsonb_agg(jsonb_build_object('id', u.id, 'full_name', u.full_name) order by u.full_name)
      from public.users u join auth.users a on a.id = u.id
     where u.role in ('adviser', 'chair', 'panelist')
       and (a.banned_until is null or a.banned_until <= now())), '[]'::jsonb));
end $$;

create or replace function public.submit_group_registration(p_code text, p_reg jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s public.registration_settings;
  v_id uuid;
  v_adviser uuid := nullif(p_reg->>'adviser_id', '')::uuid;
  v_members jsonb := coalesce(p_reg->'members', '[]'::jsonb);
  m jsonb;
  v_email_re text := '^[^@\s]+@[^@\s]+\.[^@\s]+$';
begin
  select * into s from public.registration_settings where id = 1;
  if s.id is null or not s.is_open or s.access_code = '' then raise exception 'Group registration is closed.'; end if;
  if lower(trim(coalesce(p_code, ''))) <> lower(trim(s.access_code)) then raise exception 'The registration code is incorrect.'; end if;

  if coalesce(trim(p_reg->>'group_label'), '') = '' then raise exception 'Group name is required.'; end if;
  if coalesce(trim(p_reg->>'title'), '') = '' then raise exception 'Project title is required.'; end if;
  if coalesce(trim(p_reg->>'academic_year'), '') !~ '^\d{4}-\d{4}$' then raise exception 'Academic year must look like 2026-2027.'; end if;
  if v_adviser is not null and not exists (select 1 from public.users where id = v_adviser and role in ('adviser', 'chair', 'panelist')) then
    raise exception 'Choose an adviser from the list.';
  end if;
  if v_adviser is null and coalesce(trim(p_reg->>'adviser_name'), '') = '' then raise exception 'Adviser is required.'; end if;
  if coalesce(trim(p_reg->>'contact_email'), '') !~ v_email_re then raise exception 'Enter a valid contact email.'; end if;
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
  -- Flood guard: the public page cannot fill the queue endlessly
  if (select count(*) from public.group_registrations where status = 'pending') >= 300 then
    raise exception 'Too many pending registrations. Ask the Coordinator to review them first.';
  end if;

  insert into public.group_registrations
    (group_label, title, academic_year, adviser_id, adviser_name, members, manuscript_url, demo_url, abstract, contact_email)
  values (
    trim(p_reg->>'group_label'), trim(p_reg->>'title'), trim(p_reg->>'academic_year'), v_adviser,
    case when v_adviser is null then trim(coalesce(p_reg->>'adviser_name', '')) else '' end,
    (select jsonb_agg(jsonb_build_object(
        'student_name', trim(e->>'student_name'), 'student_number', trim(e->>'student_number'), 'email', lower(trim(e->>'email'))))
       from jsonb_array_elements(v_members) e),
    trim(coalesce(p_reg->>'manuscript_url', '')), trim(coalesce(p_reg->>'demo_url', '')), trim(coalesce(p_reg->>'abstract', '')),
    lower(trim(p_reg->>'contact_email')))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.registration_form_info(text), public.submit_group_registration(text, jsonb) from public;
grant execute on function public.registration_form_info(text), public.submit_group_registration(text, jsonb) to anon, authenticated;
