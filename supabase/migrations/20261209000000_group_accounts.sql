-- One sign-in account per capstone group ("authorized member").
--  * The group leader picks the authorized member and sets the password on /register;
--    only a bcrypt hash is stored, and it is never readable through the API.
--  * Scheduling a defense from the registration creates that account (activate_group_account).
--  * A group can never have more than one linked account.
--  * The group account sees every member's grades once the defense is locked.

alter table public.group_registrations
  add column authorized_index int not null default 0 check (authorized_index between 0 and 9),
  add column password_hash text;

-- Hide the hash from API callers: column-level SELECT without password_hash.
revoke select on public.group_registrations from anon, authenticated;
grant select (id, group_label, title, academic_year, adviser_id, adviser_name, members, manuscript_url, demo_url,
              abstract, contact_email, status, created_at, authorized_index)
  on public.group_registrations to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.group_registrations from anon;
revoke insert, truncate, references, trigger on public.group_registrations from authenticated;

create or replace function public.submit_group_registration(p_code text, p_reg jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  s public.registration_settings;
  v_id uuid;
  v_adviser uuid := nullif(p_reg->>'adviser_id', '')::uuid;
  v_members jsonb := coalesce(p_reg->'members', '[]'::jsonb);
  v_idx int := coalesce((p_reg->>'authorized_index')::int, -1);
  v_pw text := coalesce(p_reg->>'password', '');
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
  if v_adviser is not null and not exists (select 1 from public.users where id = v_adviser and role in ('adviser', 'chair', 'panelist', 'admin', 'superadmin')) then
    raise exception 'Choose an adviser from the list.';
  end if;
  if v_adviser is null and coalesce(trim(p_reg->>'adviser_name'), '') = '' then raise exception 'Adviser is required.'; end if;
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
     contact_email, authorized_index, password_hash)
  values (
    trim(p_reg->>'group_label'), trim(p_reg->>'title'), trim(p_reg->>'academic_year'), v_adviser,
    case when v_adviser is null then trim(coalesce(p_reg->>'adviser_name', '')) else '' end,
    (select jsonb_agg(jsonb_build_object(
        'student_name', trim(e->>'student_name'), 'student_number', trim(e->>'student_number'), 'email', lower(trim(e->>'email'))))
       from jsonb_array_elements(v_members) e),
    trim(coalesce(p_reg->>'manuscript_url', '')), trim(coalesce(p_reg->>'demo_url', '')), trim(coalesce(p_reg->>'abstract', '')),
    v_auth_email, v_idx, crypt(v_pw, gen_salt('bf')))
  returning id into v_id;
  return v_id;
end $$;

-- One linked account per group.
create or replace function public.admin_create_member_account(p_member uuid, p_email text default null)
returns table (user_id uuid, temp_password text, linked_existing boolean)
language plpgsql security definer set search_path = public, auth as $$
declare
  m public.project_members;
  v_email text;
  v_group text;
  v_existing uuid;
  v_existing_role public.user_role;
  v_new_id uuid;
  v_pw text;
  v_holder text;
begin
  if not public.is_admin() then raise exception 'Only the Capstone Coordinator can create accounts'; end if;
  select * into m from public.project_members where id = p_member for update;
  if m.id is null then raise exception 'Member not found'; end if;
  if m.user_id is not null then raise exception '% already has an account', m.student_name; end if;
  select pm.student_name into v_holder from public.project_members pm
   where pm.project_id = m.project_id and pm.user_id is not null and pm.id <> m.id limit 1;
  if v_holder is not null then
    raise exception 'This group already has its account (%). Delete that account first to choose another member.', v_holder;
  end if;
  v_email := lower(trim(coalesce(nullif(trim(p_email), ''), m.email, '')));
  if v_email = '' then raise exception 'Add an email for % first', m.student_name; end if;
  select u.id, u.role into v_existing, v_existing_role from public.users u where lower(u.email) = v_email;
  if v_existing is not null then
    if v_existing_role <> 'student' then raise exception '% belongs to a faculty account', v_email; end if;
    update public.project_members set user_id = v_existing, email = v_email where id = p_member;
    return query select v_existing, null::text, true;
    return;
  end if;
  select coalesce(group_label, 'Proponent') into v_group from public.capstone_projects where id = m.project_id;
  select c.user_id, c.temp_password into v_new_id, v_pw
    from public.admin_create_account(v_email, m.student_name, 'student', v_group) c;
  update public.project_members set user_id = v_new_id, email = v_email where id = p_member;
  return query select v_new_id, v_pw, false;
end $$;

-- Create (or link) the authorized member's account from a scheduled registration,
-- using the password the group chose. Returns what happened.
create or replace function public.activate_group_account(p_registration uuid) returns jsonb
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  r public.group_registrations;
  v_member jsonb;
  v_email text;
  pm public.project_members;
  v_existing uuid;
  v_role public.user_role;
  v_id uuid := gen_random_uuid();
  v_holder text;
begin
  if not public.is_admin() then raise exception 'Only the Capstone Coordinator can create accounts'; end if;
  select * into r from public.group_registrations where id = p_registration for update;
  if r.id is null then raise exception 'Registration not found'; end if;
  v_member := r.members->r.authorized_index;
  v_email := lower(trim(v_member->>'email'));
  select pm2.* into pm from public.project_members pm2 join public.capstone_projects p on p.id = pm2.project_id
   where lower(pm2.email) = v_email and p.title = r.title and p.group_label = r.group_label
   order by p.created_at desc limit 1;
  if pm.id is null then
    return jsonb_build_object('status', 'not_found', 'name', v_member->>'student_name', 'email', v_email);
  end if;
  select x.student_name into v_holder from public.project_members x where x.project_id = pm.project_id and x.user_id is not null limit 1;
  if v_holder is not null then
    return jsonb_build_object('status', 'exists', 'name', v_holder, 'email', v_email);
  end if;

  select u.id, u.role into v_existing, v_role from public.users u where lower(u.email) = v_email;
  if v_existing is not null then
    if v_role <> 'student' then raise exception '% belongs to a faculty account', v_email; end if;
    update public.project_members set user_id = v_existing where id = pm.id;
    update public.group_registrations set password_hash = null where id = r.id;
    return jsonb_build_object('status', 'linked', 'name', pm.student_name, 'email', v_email);
  end if;
  if r.password_hash is null then
    return jsonb_build_object('status', 'no_password', 'name', pm.student_name, 'email', v_email);
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    r.password_hash, now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', pm.student_name),
    now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', null, now(), now());
  update public.users set role = 'student', full_name = pm.student_name, department = r.group_label where id = v_id;
  update public.project_members set user_id = v_id where id = pm.id;
  update public.group_registrations set password_hash = null where id = r.id;
  return jsonb_build_object('status', 'created', 'name', pm.student_name, 'email', v_email);
end $$;

revoke execute on function public.activate_group_account(uuid) from public, anon;
grant execute on function public.activate_group_account(uuid) to authenticated;

-- The group account sees every member's grades once the defense is locked.
drop policy scores_read on public.rubric_scores;
create policy scores_read on public.rubric_scores for select to authenticated using (
  public.owns_assignment(panel_assignment_id)
  or (public.session_locked(session_id) and (
        public.is_admin() or public.is_panelist(session_id) or public.is_secretary(session_id)
        or public.is_session_adviser(session_id) or public.is_session_student(session_id)))
  or (public.is_chair(session_id) and public.all_panel_submitted(session_id))
  or (public.is_panelist(session_id)
      and (public.my_assignment(session_id)).has_submitted
      and public.assignment_submitted(panel_assignment_id))
);
