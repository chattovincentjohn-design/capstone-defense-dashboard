/**
 * Realistic seed data so the UI runs without a database.
 * Shapes are identical to Supabase rows (see lib/types.ts).
 */
import type { DefenseStage, RubricCriterion, RubricScore, SessionBundle, StageBlend, User } from "./types";

export const USERS: User[] = [
  { id: "u-super", full_name: "Dr. Elena R. Santos", email: "superadmin@demo.edu", role: "superadmin", department: "Office of the Dean" },
  { id: "u-admin", full_name: "Engr. Liza M. Fernandez", email: "coordinator@demo.edu", role: "admin", department: "College of Computing Studies" },
  { id: "u-ramos", full_name: "Dr. Antonio C. Ramos", email: "aramos@demo.edu", role: "chair", department: "College of Computing Studies" },
  { id: "u-diaz", full_name: "Prof. Maria L. Diaz", email: "mdiaz@demo.edu", role: "panelist", department: "College of Computing Studies" },
  { id: "u-gomez", full_name: "Prof. Carlo B. Gomez", email: "cgomez@demo.edu", role: "panelist", department: "College of Engineering" },
  { id: "u-sec", full_name: "Ms. Joy A. Villanueva", email: "jvillanueva@demo.edu", role: "secretary", department: "Office of Research" },
  { id: "u-reyes", full_name: "Engr. Paolo D. Reyes", email: "preyes@demo.edu", role: "adviser", department: "College of Computing Studies" },
  { id: "u-stud", full_name: "Andrea Lim", email: "alim@student.demo.edu", role: "student", department: "BSIT 4-A" },
];

/** JHCSC Capstone Rating Sheet: 15 group items rated 1–5, then 3 individual items out of 10. */
export const RATING_SHEET_ITEMS: { section: string; name: string }[] = [
  { section: "I. Document", name: "Correctness of the statement of the research problem, objectives, significance, scope and limitation" },
  { section: "I. Document", name: "Clarity of defined requirements" },
  { section: "I. Document", name: "Completeness of analytic discussion and consistency with design discussions (document content and organization)" },
  { section: "I. Document", name: "Correctness of the design and implementation issues with respect to the theories and methodologies used in the study" },
  { section: "I. Document", name: "Presence of citations for non-original material; sufficiency of the list of references used" },
  { section: "II. Methodology", name: "Definition and application of the software development methodology" },
  { section: "II. Methodology", name: "Appropriateness of research, data gathering, and analysis tools utilized" },
  { section: "II. Methodology", name: "Appropriateness of the chosen methodology" },
  { section: "II. Methodology", name: "Adequacy of data gathered for the study" },
  { section: "II. Methodology", name: "Adequacy, completeness, and effectiveness of diagrams, graphs, charts, tables, and notations used" },
  { section: "III. Presentation", name: "Clarity and organization of presentation delivery" },
  { section: "III. Presentation", name: "Adequacy of visual aids and other tools used for presentation" },
  { section: "III. Presentation", name: "Ability to answer questions analytically and convincingly" },
  { section: "III. Presentation", name: "Ability to convince the panelists of the ideas being presented" },
  { section: "III. Presentation", name: "Ability to discuss/revise program modules as required by the panel members" },
];
export const RATING_SHEET_INDIVIDUAL = ["Communication Skill", "Work Organization", "Effectiveness"];

/** Equal weights that total exactly 100 at two decimals (15 × ≈6.67, 3 × ≈33.33). */
const evenWeights = (n: number) => {
  const base = Math.floor((100 / n) * 100) / 100;
  const extra = Math.round((100 - base * n) * 100);
  return Array.from({ length: n }, (_, i) => Math.round((base + (i < extra ? 0.01 : 0)) * 100) / 100);
};

export function ratingSheetCriteria(stage: DefenseStage, prefix: string): RubricCriterion[] {
  const gw = evenWeights(RATING_SHEET_ITEMS.length);
  const iw = evenWeights(RATING_SHEET_INDIVIDUAL.length);
  return [
    ...RATING_SHEET_ITEMS.map((it, i): RubricCriterion => ({
      id: `${prefix}-g${i + 1}`, stage, scope: "group", criterion_name: it.name, description: it.section,
      weight_percentage: gw[i], max_score: 5, sort_order: i + 1,
    })),
    ...RATING_SHEET_INDIVIDUAL.map((name, i): RubricCriterion => ({
      id: `${prefix}-i${i + 1}`, stage, scope: "individual", criterion_name: name, description: "Individual evaluation (10 points)",
      weight_percentage: iw[i], max_score: 10, sort_order: i + 1,
    })),
  ];
}

export const FINAL_CRITERIA = ratingSheetCriteria("final", "c-f");
export const PROPOSAL_CRITERIA = ratingSheetCriteria("proposal", "c-p");
export const TITLE_CRITERIA = ratingSheetCriteria("title", "c-t");

/** Rubric templates (what the Coordinator edits). Sessions keep their own snapshot. */
export function seedRubric(): RubricCriterion[] {
  return [...TITLE_CRITERIA, ...PROPOSAL_CRITERIA, ...FINAL_CRITERIA].map((c) => ({ ...c, is_active: true }));
}

/** Default final-grade blend per stage (Coordinator-editable). */
export function seedGrading(): Record<DefenseStage, StageBlend> {
  return {
    title: { groupWeight: 30, individualWeight: 70 },
    proposal: { groupWeight: 30, individualWeight: 70 },
    final: { groupWeight: 30, individualWeight: 70 },
  };
}

function scoreRows(sessionId: string, assignmentId: string, rows: [string, string | null, number][]): RubricScore[] {
  return rows.map(([criterion_id, student_id, score]) => ({
    id: `s-${assignmentId}-${criterion_id}-${student_id ?? "g"}`,
    session_id: sessionId,
    panel_assignment_id: assignmentId,
    criterion_id,
    student_id,
    score,
  }));
}

const S1 = "sess-g4-final";
const S2 = "sess-g7-proposal";

export function seedBundles(): SessionBundle[] {
  return [
    {
      session: {
        id: S1, project_id: "p-g4", stage: "final", scheduled_at: "2026-11-23T09:00:00+08:00",
        room_or_link: "CCS Audio-Visual Room 2", secretary_id: "u-sec",
        verdict: null, is_locked: false, locked_at: null, chair_signature_hash: null,
        started_at: "2026-11-23T09:05:00+08:00", started_by: "u-ramos",
        group_weight: 30, individual_weight: 70,
      },
      project: {
        id: "p-g4", group_label: "Group 4", title: "IoT-Based Smart Agriculture System",
        abstract: "A low-cost sensor network (soil moisture, pH, temperature) with LoRa uplink and an offline-first mobile dashboard that automates irrigation scheduling for smallholder rice farms.",
        manuscript_url: "/sample-manuscript.pdf", demo_url: "https://example.com/smart-agri-demo",
        adviser_id: "u-reyes", academic_year: "2026-2027",
      },
      members: [
        { id: "m-g4-1", project_id: "p-g4", student_name: "Andrea Lim", student_number: "2022-00417", user_id: "u-stud" },
        { id: "m-g4-2", project_id: "p-g4", student_name: "Mark Bautista", student_number: "2022-00533" },
        { id: "m-g4-3", project_id: "p-g4", student_name: "Kyla Mendoza", student_number: "2022-00691" },
      ],
      assignments: [
        { id: "pa-1-ramos", session_id: S1, faculty_id: "u-ramos", panel_role: "chair", has_submitted: false, signature_hash: null, submitted_at: null },
        { id: "pa-2-diaz", session_id: S1, faculty_id: "u-diaz", panel_role: "member", has_submitted: true, signature_hash: null, submitted_at: "2026-11-23T02:41:17.000Z" },
        { id: "pa-3-gomez", session_id: S1, faculty_id: "u-gomez", panel_role: "member", has_submitted: false, signature_hash: null, submitted_at: null },
      ],
      criteria: FINAL_CRITERIA,
      scores: [
        // Chair: group ratings in progress, individuals not yet
        ...scoreRows(S1, "pa-1-ramos", [5, 4, 4, 4, 3, 4, 5, 4].map((r, i): [string, null, number] => [`c-f-g${i + 1}`, null, r])),
        // Diaz: complete & signed
        ...scoreRows(S1, "pa-2-diaz", [
          ...[5, 4, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 4].map((r, i): [string, null, number] => [`c-f-g${i + 1}`, null, r]),
          ["c-f-i1", "m-g4-1", 9], ["c-f-i2", "m-g4-1", 9], ["c-f-i3", "m-g4-1", 8],
          ["c-f-i1", "m-g4-2", 8], ["c-f-i2", "m-g4-2", 7], ["c-f-i3", "m-g4-2", 8],
          ["c-f-i1", "m-g4-3", 9], ["c-f-i2", "m-g4-3", 8], ["c-f-i3", "m-g4-3", 8],
        ]),
        // Gomez: partially graded
        ...scoreRows(S1, "pa-3-gomez", [
          ...[4, 5, 4, 4, 4, 3, 4, 4, 4, 4].map((r, i): [string, null, number] => [`c-f-g${i + 1}`, null, r]),
          ["c-f-i1", "m-g4-1", 9], ["c-f-i2", "m-g4-1", 8],
        ]),
      ],
      comments: [
        { id: "cm-1", session_id: S1, panel_assignment_id: "pa-2-diaz", category: "database_architecture", severity: "mandatory", comment_text: "Fix database schema for offline sync: add conflict-resolution columns (updated_at, device_id) to sensor_readings and document the merge strategy.", is_resolved: false, resolution_note: null, resolution_reference: null, resolved_at: null, created_at: "2026-11-23T01:35:00.000Z" },
        { id: "cm-2", session_id: S1, panel_assignment_id: "pa-2-diaz", category: "methodology", severity: "mandatory", comment_text: "Expand the methodology chapter: describe sensor calibration procedure and include the acceptance-testing protocol with ISO 25010 metrics.", is_resolved: false, resolution_note: null, resolution_reference: null, resolved_at: null, created_at: "2026-11-23T01:38:00.000Z" },
        { id: "cm-3", session_id: S1, panel_assignment_id: "pa-3-gomez", category: "system_ui", severity: "suggestion", comment_text: "Consider larger touch targets and a Filipino-language toggle on the farmer mobile dashboard.", is_resolved: false, resolution_note: null, resolution_reference: null, resolved_at: null, created_at: "2026-11-23T01:44:00.000Z" },
        { id: "cm-4", session_id: S1, panel_assignment_id: "pa-1-ramos", category: "documentation", severity: "mandatory", comment_text: "Update Chapter 4 figures to reflect the final LoRa gateway topology; current diagram shows the Wi-Fi prototype.", is_resolved: false, resolution_note: null, resolution_reference: null, resolved_at: null, created_at: "2026-11-23T01:46:00.000Z" },
      ],
      minutes: {
        id: "min-1", session_id: S1, recorder_id: "u-sec", started_at: "2026-11-23T01:02:00.000Z", ended_at: null,
        attendance_json: [
          { id: "at-1", name: "Dr. Antonio C. Ramos", role: "Chair", present: true },
          { id: "at-2", name: "Prof. Maria L. Diaz", role: "Panel Member", present: true },
          { id: "at-3", name: "Prof. Carlo B. Gomez", role: "Panel Member", present: true },
          { id: "at-4", name: "Engr. Paolo D. Reyes", role: "Adviser", present: true },
          { id: "at-5", name: "Andrea Lim", role: "Proponent", present: true },
          { id: "at-6", name: "Mark Bautista", role: "Proponent", present: true },
          { id: "at-7", name: "Kyla Mendoza", role: "Proponent", present: false },
        ],
        qa_entries_json: [
          { id: "qa-1", timestamp: "2026-11-23T01:12:00.000Z", panelist_id: "u-ramos", question: "How will the system perform during power outages?", response: "Nodes run on 18650 cells with a 6 W solar panel; readings are buffered on SD for up to 72 hours and sync when the gateway reconnects.", action_required: "Include outage-test results in Chapter 5." },
          { id: "qa-2", timestamp: "2026-11-23T01:18:00.000Z", panelist_id: "u-diaz", question: "Please clarify the sensor calibration methods.", response: "", action_required: "" },
        ],
        deliberation_notes: "",
        chair_approved_at: null,
      },
    },
    {
      session: {
        id: S2, project_id: "p-g7", stage: "proposal", scheduled_at: "2026-11-23T13:30:00+08:00",
        room_or_link: "https://meet.example.com/ccs-defense-7", secretary_id: "u-sec",
        verdict: null, is_locked: false, locked_at: null, chair_signature_hash: null,
        group_weight: 30, individual_weight: 70,
      },
      project: {
        id: "p-g7", group_label: "Group 7", title: "AI-Assisted Enrollment Queue Management System",
        abstract: "A queue forecasting and SMS-notification platform that predicts registrar load and assigns time slots during enrollment week.",
        manuscript_url: "/sample-manuscript.pdf", demo_url: null, adviser_id: "u-reyes", academic_year: "2026-2027",
      },
      members: [
        { id: "m-g7-1", project_id: "p-g7", student_name: "Rafael Torres", student_number: "2022-00102" },
        { id: "m-g7-2", project_id: "p-g7", student_name: "Bea Santiago", student_number: "2022-00218" },
      ],
      assignments: [
        { id: "pb-1-ramos", session_id: S2, faculty_id: "u-ramos", panel_role: "chair", has_submitted: false, signature_hash: null, submitted_at: null },
        { id: "pb-2-diaz", session_id: S2, faculty_id: "u-diaz", panel_role: "member", has_submitted: false, signature_hash: null, submitted_at: null },
        { id: "pb-3-gomez", session_id: S2, faculty_id: "u-gomez", panel_role: "member", has_submitted: false, signature_hash: null, submitted_at: null },
      ],
      criteria: PROPOSAL_CRITERIA,
      scores: [],
      comments: [],
      minutes: {
        id: "min-2", session_id: S2, recorder_id: "u-sec", started_at: null, ended_at: null,
        attendance_json: [
          { id: "at-b1", name: "Dr. Antonio C. Ramos", role: "Chair", present: true },
          { id: "at-b2", name: "Prof. Maria L. Diaz", role: "Panel Member", present: true },
          { id: "at-b3", name: "Prof. Carlo B. Gomez", role: "Panel Member", present: true },
          { id: "at-b4", name: "Rafael Torres", role: "Proponent", present: true },
          { id: "at-b5", name: "Bea Santiago", role: "Proponent", present: true },
        ],
        qa_entries_json: [],
        deliberation_notes: "",
        chair_approved_at: null,
      },
    },
  ];
}
