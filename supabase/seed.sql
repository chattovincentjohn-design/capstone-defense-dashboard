-- Default rubric criteria (editable by Admin / Capstone Coordinator).
-- Weights within each (stage, scope) must total 100.

-- Every course (program) gets its own copy; each Coordinator edits theirs in the app.
insert into public.rubric_criteria (program_id, stage, scope, criterion_name, description, weight_percentage, max_score, sort_order)
select p.id, v.stage::public.defense_stage, v.scope::public.rubric_scope, v.criterion_name, v.description, v.weight, v.max_score, v.sort_order
from public.programs p cross join (values
  -- FINAL DEFENSE — group
  ('final', 'group', 'System Functionality', 'Completeness, correctness and stability of the deployed system against stated objectives.', 35, 5, 1),
  ('final', 'group', 'Technical Documentation', 'Manuscript quality, adherence to format, user/technical manuals.', 25, 5, 2),
  ('final', 'group', 'Methodology & Architecture', 'Soundness of SDLC, system architecture, database design and testing.', 25, 5, 3),
  ('final', 'group', 'Significance & Innovation', 'Novelty and measurable impact on the target beneficiaries.', 15, 5, 4),
  -- FINAL DEFENSE — individual
  ('final', 'individual', 'Presentation Delivery', 'Clarity, confidence, time management and visual aids.', 50, 5, 1),
  ('final', 'individual', 'Q&A Mastery', 'Accuracy and depth of answers; ownership of the work.', 50, 5, 2),

  -- PROPOSAL DEFENSE — group
  ('proposal', 'group', 'Problem Statement & Objectives', 'Specific, measurable, and grounded in evidence.', 30, 5, 1),
  ('proposal', 'group', 'Review of Related Literature', 'Coverage, synthesis, and identified research gap.', 25, 5, 2),
  ('proposal', 'group', 'Proposed Methodology & Architecture', 'Feasibility of design, tools and evaluation plan.', 30, 5, 3),
  ('proposal', 'group', 'Significance & Innovation', 'Expected contribution and beneficiaries.', 15, 5, 4),
  ('proposal', 'individual', 'Presentation Delivery', 'Clarity and organization.', 50, 5, 1),
  ('proposal', 'individual', 'Q&A Mastery', 'Understanding of the proposal.', 50, 5, 2),

  -- TITLE DEFENSE — group
  ('title', 'group', 'Relevance & Feasibility', 'Alignment with program and doability within the term.', 50, 5, 1),
  ('title', 'group', 'Novelty', 'Distinctness from existing systems.', 50, 5, 2),
  ('title', 'individual', 'Presentation & Q&A', 'Ability to justify the proposed title.', 100, 5, 1)) as v(stage, scope, criterion_name, description, weight, max_score, sort_order);

-- After creating auth users in Dashboard → Authentication, promote roles, e.g.:
-- update public.users set role = 'admin' where email = 'coordinator@school.edu';
