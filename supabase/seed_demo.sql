-- Demo data matching the in-browser demo. Run AFTER seed.sql and after the demo
-- accounts exist (users are looked up by email). Safe to run once on an empty project.
do $$
declare
  u_admin uuid := (select id from public.users where email = 'coordinator@example.com');
  u_ramos uuid := (select id from public.users where email = 'aramos@example.com');
  u_diaz  uuid := (select id from public.users where email = 'mdiaz@example.com');
  u_gomez uuid := (select id from public.users where email = 'cgomez@example.com');
  u_sec   uuid := (select id from public.users where email = 'jvillanueva@example.com');
  u_reyes uuid := (select id from public.users where email = 'preyes@example.com');
  u_stud  uuid := (select id from public.users where email = 'alim@example.com');
  p4 uuid; p7 uuid; m41 uuid; m42 uuid; m43 uuid; s1 uuid; s2 uuid;
  a_ramos uuid; a_diaz uuid; a_gomez uuid;
  v_ts timestamptz := '2026-11-23T02:41:17Z';
  v_payload text;
  c record;
  crit jsonb;
begin
  if u_ramos is null then raise exception 'Create the demo accounts first'; end if;

  insert into public.capstone_projects (program_id, title, group_label, abstract, manuscript_url, demo_url, adviser_id, academic_year)
  values ((select id from public.programs where code = 'BSIT'), 'IoT-Based Smart Agriculture System', 'Group 4',
          'A low-cost sensor network (soil moisture, pH, temperature) with LoRa uplink and an offline-first mobile dashboard that automates irrigation scheduling for smallholder rice farms.',
          '/sample-manuscript.pdf', 'https://example.com/smart-agri-demo', u_reyes, '2026-2027')
  returning id into p4;
  insert into public.project_members (project_id, student_name, student_number, user_id) values (p4, 'Andrea Lim', '2022-00417', u_stud) returning id into m41;
  insert into public.project_members (project_id, student_name, student_number) values (p4, 'Mark Bautista', '2022-00533') returning id into m42;
  insert into public.project_members (project_id, student_name, student_number) values (p4, 'Kyla Mendoza', '2022-00691') returning id into m43;

  insert into public.capstone_projects (program_id, title, group_label, abstract, manuscript_url, adviser_id, academic_year)
  values ((select id from public.programs where code = 'BSIT'), 'AI-Assisted Enrollment Queue Management System', 'Group 7',
          'A queue forecasting and SMS-notification platform that predicts registrar load and assigns time slots during enrollment week.',
          '/sample-manuscript.pdf', u_reyes, '2026-2027')
  returning id into p7;
  insert into public.project_members (project_id, student_name, student_number) values
    (p7, 'Rafael Torres', '2022-00102'), (p7, 'Bea Santiago', '2022-00218');

  -- Sessions (insert triggers snapshot the rubric and stamp the grade blend)
  insert into public.defense_sessions (project_id, stage, scheduled_at, room_or_link, secretary_id)
  values (p4, 'final', '2026-11-23T09:00:00+08:00', 'CCS Audio-Visual Room 2', u_sec) returning id into s1;
  insert into public.defense_sessions (project_id, stage, scheduled_at, room_or_link, secretary_id)
  values (p7, 'proposal', '2026-11-23T13:30:00+08:00', 'https://meet.example.com/ccs-defense-7', u_sec) returning id into s2;

  insert into public.panel_assignments (session_id, faculty_id, panel_role) values (s1, u_ramos, 'chair') returning id into a_ramos;
  insert into public.panel_assignments (session_id, faculty_id, panel_role) values (s1, u_diaz, 'member') returning id into a_diaz;
  insert into public.panel_assignments (session_id, faculty_id, panel_role) values (s1, u_gomez, 'member') returning id into a_gomez;
  insert into public.panel_assignments (session_id, faculty_id, panel_role) values
    (s2, u_ramos, 'chair'), (s2, u_diaz, 'member'), (s2, u_gomez, 'member');

  -- Scores: criterion lookup by name within the Final Defense snapshot
  select jsonb_object_agg(rc.criterion_name, rc.id) into crit
    from public.session_criteria sc join public.rubric_criteria rc on rc.id = sc.criterion_id where sc.session_id = s1;

  insert into public.rubric_scores (session_id, panel_assignment_id, student_id, criterion_id, score)
  select s1, x.a, x.st, (crit->>x.cn)::uuid, x.sc from (values
    (a_ramos, null::uuid, 'System Functionality', 4.5), (a_ramos, null, 'Technical Documentation', 4.0),
    (a_ramos, null, 'Methodology & Architecture', 4.2), (a_ramos, null, 'Significance & Innovation', 3.8),
    (a_diaz, null, 'System Functionality', 4.6), (a_diaz, null, 'Technical Documentation', 3.4),
    (a_diaz, null, 'Methodology & Architecture', 4.0), (a_diaz, null, 'Significance & Innovation', 4.2),
    (a_diaz, m41, 'Presentation Delivery', 4.5), (a_diaz, m41, 'Q&A Mastery', 4.4),
    (a_diaz, m42, 'Presentation Delivery', 3.8), (a_diaz, m42, 'Q&A Mastery', 3.5),
    (a_diaz, m43, 'Presentation Delivery', 4.2), (a_diaz, m43, 'Q&A Mastery', 4.0),
    (a_gomez, null, 'System Functionality', 4.4), (a_gomez, null, 'Technical Documentation', 4.5),
    (a_gomez, null, 'Methodology & Architecture', 3.9),
    (a_gomez, m41, 'Presentation Delivery', 4.6), (a_gomez, m41, 'Q&A Mastery', 4.2)
  ) as x(a, st, cn, sc);

  -- Prof. Diaz has submitted: sign exactly as submit_evaluation() does
  select coalesce(string_agg(criterion_id::text || ':' || coalesce(student_id::text, 'group') || ':' || score::text,
                             ',' order by criterion_id, student_id nulls first), '')
    into v_payload from public.rubric_scores where panel_assignment_id = a_diaz;
  update public.panel_assignments
     set has_submitted = true, submitted_at = v_ts,
         signature_hash = encode(extensions.digest(u_diaz::text || '|' ||
           to_char(v_ts at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' || v_payload, 'sha256'), 'hex')
   where id = a_diaz;

  insert into public.panel_comments (session_id, panel_assignment_id, category, severity, comment_text, created_at) values
    (s1, a_diaz, 'database_architecture', 'mandatory', 'Fix database schema for offline sync: add conflict-resolution columns (updated_at, device_id) to sensor_readings and document the merge strategy.', '2026-11-23T01:35:00Z'),
    (s1, a_diaz, 'methodology', 'mandatory', 'Expand the methodology chapter: describe sensor calibration procedure and include the acceptance-testing protocol with ISO 25010 metrics.', '2026-11-23T01:38:00Z'),
    (s1, a_gomez, 'system_ui', 'suggestion', 'Consider larger touch targets and a Filipino-language toggle on the farmer mobile dashboard.', '2026-11-23T01:44:00Z'),
    (s1, a_ramos, 'documentation', 'mandatory', 'Update Chapter 4 figures to reflect the final LoRa gateway topology; current diagram shows the Wi-Fi prototype.', '2026-11-23T01:46:00Z');

  insert into public.defense_minutes (session_id, recorder_id, started_at, attendance_json, qa_entries_json, deliberation_notes) values
    (s1, u_sec, '2026-11-23T01:02:00Z',
     jsonb_build_array(
       jsonb_build_object('id','at-1','name','Dr. Antonio C. Ramos','role','Chair','present',true),
       jsonb_build_object('id','at-2','name','Prof. Maria L. Diaz','role','Panel Member','present',true),
       jsonb_build_object('id','at-3','name','Prof. Carlo B. Gomez','role','Panel Member','present',true),
       jsonb_build_object('id','at-4','name','Engr. Paolo D. Reyes','role','Adviser','present',true),
       jsonb_build_object('id','at-5','name','Andrea Lim','role','Proponent','present',true),
       jsonb_build_object('id','at-6','name','Mark Bautista','role','Proponent','present',true),
       jsonb_build_object('id','at-7','name','Kyla Mendoza','role','Proponent','present',false)),
     jsonb_build_array(
       jsonb_build_object('id','qa-1','timestamp','2026-11-23T01:12:00.000Z','panelist_id',u_ramos,
         'question','How will the system perform during power outages?',
         'response','Nodes run on 18650 cells with a 6 W solar panel; readings are buffered on SD for up to 72 hours and sync when the gateway reconnects.',
         'action_required','Include outage-test results in Chapter 5.'),
       jsonb_build_object('id','qa-2','timestamp','2026-11-23T01:18:00.000Z','panelist_id',u_diaz,
         'question','Please clarify the sensor calibration methods.','response','','action_required','')),
     ''),
    (s2, u_sec, null,
     jsonb_build_array(
       jsonb_build_object('id','at-b1','name','Dr. Antonio C. Ramos','role','Chair','present',true),
       jsonb_build_object('id','at-b2','name','Prof. Maria L. Diaz','role','Panel Member','present',true),
       jsonb_build_object('id','at-b3','name','Prof. Carlo B. Gomez','role','Panel Member','present',true),
       jsonb_build_object('id','at-b4','name','Rafael Torres','role','Proponent','present',true),
       jsonb_build_object('id','at-b5','name','Bea Santiago','role','Proponent','present',true)),
     '[]'::jsonb, '');
end $$;
