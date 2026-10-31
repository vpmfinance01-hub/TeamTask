export type Role = "owner" | "manager" | "employee";
export type OccStatus = "pending" | "submitted" | "approved" | "rejected";
export type Recurrence = "once" | "daily" | "weekly" | "monthly";
export type AssignMode = "each" | "any";

export interface Plan {
  key: string;
  name: string;
  price_eur: number;
  max_members: number;
  max_groups: number;
  sort: number;
}

export interface Org {
  id: string;
  name: string;
  code: string;
  plan_key: string;
  sub_status: "trialing" | "active" | "past_due" | "canceled";
  trial_ends_at: string;
  current_period_end: string | null;
  stripe_customer_id: string | null;
}

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: Role;
  display_name: string;
  username: string | null;
  active: boolean;
}

export interface Group {
  id: string;
  org_id: string;
  name: string;
  color: string;
}

export interface GroupMember {
  group_id: string;
  membership_id: string;
  is_leader: boolean;
}

export interface Task {
  id: string;
  org_id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  group_id: string | null;
  assignee_id: string | null;
  assign_mode: AssignMode;
  priority: number;
  requires_note: boolean;
  requires_photo: boolean;
  requires_approval: boolean;
  recurrence: Recurrence;
  recurrence_days: number[] | null;
  start_date: string;
  end_date: string | null;
  due_time: string | null;
  active: boolean;
  steps: string[]; // чеклист със стъпки (по желание)
  steps_required: boolean; // всички стъпки трябва да са отметнати, за да се изпрати
  place_id: string | null; // място (QR)
}

export interface Place {
  id: string;
  org_id: string;
  name: string;
  code: string;
  group_id: string | null;
}

export interface TaskTemplate {
  id: string;
  org_id: string;
  name: string;
  payload: Partial<Omit<Task, "id" | "org_id" | "active">>;
}

export interface TaskComment {
  id: string;
  org_id: string;
  occurrence_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface Occurrence {
  id: string;
  org_id: string;
  task_id: string;
  group_id: string | null;
  due_date: string;
  assignee_id: string | null;
  status: OccStatus;
  completed_by: string | null;
  completed_at: string | null;
  note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  steps_done: boolean[];
  tasks: Pick<
    Task,
    | "title" | "description" | "instructions" | "priority" | "requires_note" | "requires_photo" | "requires_approval" | "due_time"
    | "steps" | "steps_required" | "place_id"
  >;
  groups: Pick<Group, "name" | "color"> | null;
  assignee: Pick<Membership, "display_name"> | null;
  completer: Pick<Membership, "display_name"> | null;
}

/** Колоните за списъци със задания (вкл. вградените таблици). */
export const OCC_SELECT =
  "*, tasks(title, description, instructions, priority, requires_note, requires_photo, requires_approval, due_time, steps, steps_required, place_id), " +
  "groups(name, color), " +
  "assignee:memberships!occurrences_assignee_id_fkey(display_name), " +
  "completer:memberships!occurrences_completed_by_fkey(display_name)";
