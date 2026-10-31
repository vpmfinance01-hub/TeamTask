import { supabase, BUCKET } from "./supabase";
import type { OccStatus, Org, Role } from "./types";
import { getLang, LOCALE, t } from "./i18n";

// ---------- дати (локални, без UTC изместване)
export function ymd(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export const WD_SHORT = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** Име на ден от седмицата / месец на езика на потребителя (Intl). */
export function weekdayName(d: Date, style: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat(LOCALE[getLang()], { weekday: style }).format(d);
}
export function monthName(m: number, style: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat(LOCALE[getLang()], { month: style }).format(new Date(2026, m, 1));
}
export function niceDate(s: string): string {
  const d = parseYmd(s);
  const today = ymd();
  const num = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  const label = `${weekdayName(d)}, ${num}`;
  if (s === today) return `${t("Днес")} · ${label}`;
  if (s === addDays(today, -1)) return `${t("Вчера")} · ${label}`;
  if (s === addDays(today, 1)) return `${t("Утре")} · ${label}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
export function niceDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/** Дали повтарящата се задача се пада на дадена дата – същото правило като в базата (ensure_occurrences). */
export function taskOccursOn(
  t: { recurrence: string; recurrence_days: number[] | null; start_date: string; end_date: string | null; active: boolean },
  d: string,
): boolean {
  if (!t.active || d < t.start_date || (t.end_date && d > t.end_date)) return false;
  switch (t.recurrence) {
    case "once":
      return d === t.start_date;
    case "daily":
      return true;
    case "weekly":
      return (t.recurrence_days ?? [parseYmd(t.start_date).getDay()]).includes(parseYmd(d).getDay());
    case "monthly": {
      const dd = parseYmd(d);
      const last = new Date(dd.getFullYear(), dd.getMonth() + 1, 0).getDate();
      return dd.getDate() === Math.min(parseYmd(t.start_date).getDate(), last);
    }
    default:
      return false;
  }
}

// ---------- етикети
export const STATUS_LABEL: Record<OccStatus, string> = {
  pending: "За изпълнение",
  submitted: "Чака одобрение",
  approved: "Одобрено",
  rejected: "Върнато",
};
export const ROLE_LABEL: Record<Role, string> = {
  owner: "Собственик",
  manager: "Ръководител",
  employee: "Служител",
};
/** Етикети на езика на потребителя. */
export const statusLabel = (s: OccStatus) => t(STATUS_LABEL[s]);
export const roleLabel = (r: Role) => t(ROLE_LABEL[r]);

// ---------- абонамент
export function hasAccess(org: Org): boolean {
  if (org.sub_status === "active") return true;
  if (org.sub_status === "trialing") return new Date(org.trial_ends_at) > new Date();
  if (org.sub_status === "past_due") {
    const base = org.current_period_end ? new Date(org.current_period_end) : new Date();
    return base.getTime() + 7 * 864e5 > Date.now();
  }
  return false;
}
export function trialDaysLeft(org: Org): number {
  return Math.max(0, Math.ceil((new Date(org.trial_ends_at).getTime() - Date.now()) / 864e5));
}

// ---------- грешки -> четим български текст
const ERRORS: Record<string, string> = {
  member_limit: "Достигнат е лимитът на служители за вашия план. Преминете на по-голям план.",
  group_limit: "Достигнат е лимитът на групи за вашия план.",
  subscription_inactive: "Абонаментът е неактивен. Собственикът трябва да поднови плана.",
  photo_required: "Тази задача изисква снимка.",
  note_required: "Тази задача изисква текстова бележка.",
  steps_required: "Отбележете всички стъпки, преди да изпратите задачата.",
  comment_required: "При връщане напишете причина.",
  already_submitted: "Задачата вече е изпратена.",
  not_submitted: "Задачата не чака одобрение.",
  cannot_review_own: "Не можете да одобрявате собствена задача.",
  not_allowed: "Нямате право на това действие.",
  user_exists: "Вече има акаунт с това потребителско име или имейл.",
  username_taken: "Това потребителско име вече се използва във фирмата.",
  weak_password: "Паролата трябва да е поне 8 символа.",
  bad_username: "Потребителското име: 2–30 символа – малки латински букви, цифри, точка, тире.",
  group_required: "Изберете поне една група.",
  billing_not_configured: "Плащането още не е настроено. Свържете се с поддръжката.",
  plan_not_configured: "Този план още не е свързан със Stripe.",
  "Invalid login credentials": "Грешно потребителско име или парола.",
  "User already registered": "Вече има регистрация с този имейл.",
  "Email not confirmed": "Имейлът не е потвърден – отворете писмото, което изпратихме.",
};
export function errMsg(e: unknown): string {
  const raw =
    typeof e === "string"
      ? e
      : (e as { message?: string; error?: string })?.message ?? (e as { error?: string })?.error ?? "";
  for (const k of Object.keys(ERRORS)) if (raw.includes(k)) return t(ERRORS[k]);
  if (raw.includes("duplicate key") && raw.includes("code")) return t("Този код на фирма е зает – изберете друг.");
  if (raw.includes("row-level security")) return t("Нямате право на това действие (или абонаментът е неактивен).");
  if (raw.includes("Failed to fetch") || raw.includes("NetworkError")) return t("Няма връзка. Опитайте отново.");
  return raw || t("Нещо се обърка. Опитайте отново.");
}

/** Грешка от supabase.functions.invoke -> код от тялото на отговора. */
export async function fnError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body?.error) return errMsg(body.error);
    } catch {
      /* ignore */
    }
  }
  return errMsg(error);
}

// ---------- снимки
/** Смалява снимката до ~1600px JPEG – пести трафик и място. */
export async function compressImage(file: File, max = 1600, quality = 0.8): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    return blob ?? file;
  } catch {
    return file; // напр. HEIC без поддръжка – качваме оригинала
  }
}

export async function uploadFile(path: string, blob: Blob, contentType?: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: contentType ?? blob.type ?? "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
}

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function randomPassword(len = 10): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

/** 0888 123 456 -> 359888123456 (международен формат без +); невалиден номер -> "". */
export function normalizePhone(p: string): string {
  let d = p.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "359" + d.slice(1);
  return /^\d{9,15}$/.test(d) ? d : "";
}

export function slugify(s: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
    н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht",
    ъ: "a", ь: "y", ю: "yu", я: "ya",
  };
  return s
    .toLowerCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);
}
