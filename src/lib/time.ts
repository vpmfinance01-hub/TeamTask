import { addDays, parseYmd, ymd } from "./util";
import { t } from "./i18n";

export interface ShiftType {
  id: string;
  org_id: string;
  name: string;
  start_time: string; // "07:00"
  end_time: string; // "15:00" (по-малко от началото = минава полунощ)
  color: string;
  break_min: number;
}
export type ShiftKind = "work" | "off" | "leave" | "sick";
export interface Shift {
  id: string;
  org_id: string;
  membership_id: string;
  group_id: string | null;
  date: string;
  kind: ShiftKind;
  shift_type_id: string | null;
  start_time: string | null;
  end_time: string | null;
  break_min: number;
  note: string | null;
  published: boolean;
}
export interface TimeEntry {
  id: string;
  org_id: string;
  membership_id: string;
  shift_id: string | null;
  work_date: string;
  started_at: string;
  ended_at: string | null;
  break_min: number;
  method: "self" | "manager";
  note: string | null;
  approved: boolean;
}

export const KIND_LABEL: Record<ShiftKind, string> = {
  work: "Смяна",
  off: "Почивен ден",
  leave: "Отпуск",
  sick: "Болничен",
};
export const KIND_COLOR: Record<ShiftKind, string> = {
  work: "#1f4d3f",
  off: "#94a3b8",
  leave: "#c9784a",
  sick: "#b8432e",
};

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
export const hhmm = (s: string | null) => (s ? s.slice(0, 5) : "");

/** Продължителност на планирана смяна в минути (минаване през полунощ се отчита). */
export function shiftMinutes(start: string | null, end: string | null, breakMin = 0): number {
  if (!start || !end) return 0;
  let d = toMin(end) - toMin(start);
  if (d <= 0) d += 24 * 60;
  return Math.max(0, d - breakMin);
}

/** Отработени минути по запис (за незавършен запис – до момента). */
export function entryMinutes(e: Pick<TimeEntry, "started_at" | "ended_at" | "break_min">, now = Date.now()): number {
  const end = e.ended_at ? new Date(e.ended_at).getTime() : now;
  return Math.max(0, Math.round((end - new Date(e.started_at).getTime()) / 60000) - (e.break_min || 0));
}

/** 450 -> „7 ч 30 м“ (на езика на потребителя). */
export function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return t("{m} м", { m });
  return m === 0 ? t("{h} ч", { h }) : t("{h} ч {m} м", { h, m });
}

export const fmtClock = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Понеделник на седмицата, в която е датата. */
export function weekStart(d: string): string {
  const dow = (parseYmd(d).getDay() + 6) % 7;
  return addDays(d, -dow);
}
export const weekDays = (ws: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(ws, i));
export const monthStart = (d: string) => d.slice(0, 7) + "-01";
export function monthEnd(d: string): string {
  const x = parseYmd(d);
  return ymd(new Date(x.getFullYear(), x.getMonth() + 1, 0));
}

/** Локално „datetime-local“ <-> ISO. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => new Date(v).toISOString();

/** CSV, който Excel отваря правилно (BOM + разделител „;“ за български настройки). */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
