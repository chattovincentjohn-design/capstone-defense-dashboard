-- =============================================================================
-- JHCSC Capstone Rating Sheet as the rubric for every defense stage:
--   15 group items (I. Document, II. Methodology, III. Presentation) rated 1–5,
--   3 individual items out of 10 points; final grade = 30% group + 70% individual.
-- Old criteria are retired (sessions already scored keep their frozen rubric);
-- sessions nobody has scored yet switch to the new rubric and blend.
-- =============================================================================

update public.rubric_criteria set is_active = false where is_active;

insert into public.rubric_criteria (stage, scope, criterion_name, description, weight_percentage, max_score, sort_order)
select st.stage, v.scope::public.rubric_scope, v.name, v.description, v.weight, v.max_score, v.sort_order
from (values ('title'::public.defense_stage), ('proposal'), ('final')) as st(stage)
cross join (values
    ('Correctness of the statement of the research problem, objectives, significance, scope and limitation', 'I. Document', 'group', 6.67, 5, 1),
    ('Clarity of defined requirements', 'I. Document', 'group', 6.67, 5, 2),
    ('Completeness of analytic discussion and consistency with design discussions (document content and organization)', 'I. Document', 'group', 6.67, 5, 3),
    ('Correctness of the design and implementation issues with respect to the theories and methodologies used in the study', 'I. Document', 'group', 6.67, 5, 4),
    ('Presence of citations for non-original material; sufficiency of the list of references used', 'I. Document', 'group', 6.67, 5, 5),
    ('Definition and application of the software development methodology', 'II. Methodology', 'group', 6.67, 5, 6),
    ('Appropriateness of research, data gathering, and analysis tools utilized', 'II. Methodology', 'group', 6.67, 5, 7),
    ('Appropriateness of the chosen methodology', 'II. Methodology', 'group', 6.67, 5, 8),
    ('Adequacy of data gathered for the study', 'II. Methodology', 'group', 6.67, 5, 9),
    ('Adequacy, completeness, and effectiveness of diagrams, graphs, charts, tables, and notations used', 'II. Methodology', 'group', 6.67, 5, 10),
    ('Clarity and organization of presentation delivery', 'III. Presentation', 'group', 6.66, 5, 11),
    ('Adequacy of visual aids and other tools used for presentation', 'III. Presentation', 'group', 6.66, 5, 12),
    ('Ability to answer questions analytically and convincingly', 'III. Presentation', 'group', 6.66, 5, 13),
    ('Ability to convince the panelists of the ideas being presented', 'III. Presentation', 'group', 6.66, 5, 14),
    ('Ability to discuss/revise program modules as required by the panel members', 'III. Presentation', 'group', 6.66, 5, 15),
    ('Communication Skill', 'Individual evaluation (10 points)', 'individual', 33.34, 10, 1),
    ('Work Organization', 'Individual evaluation (10 points)', 'individual', 33.33, 10, 2),
    ('Effectiveness', 'Individual evaluation (10 points)', 'individual', 33.33, 10, 3)
) as v(name, description, scope, weight, max_score, sort_order);

update public.stage_grading_config set group_weight = 30, individual_weight = 70, updated_at = now();

-- Re-apply to sessions that are not locked and have no scores yet
with fresh as (
  select s.id, s.stage from public.defense_sessions s
  where not s.is_locked and not exists (select 1 from public.rubric_scores r where r.session_id = s.id)
), cleared as (
  delete from public.session_criteria sc using fresh f where sc.session_id = f.id returning sc.session_id
)
insert into public.session_criteria (session_id, criterion_id)
select f.id, c.id from fresh f join public.rubric_criteria c on c.stage = f.stage and c.is_active;

update public.defense_sessions s set group_weight = 30, individual_weight = 70
where not s.is_locked and not exists (select 1 from public.rubric_scores r where r.session_id = s.id);
