import type { Lang } from "./i18n";

/** Модули, които работодателят включва/изключва за цялата фирма. */
export type ModuleKey =
  | "calendar" | "shifts" | "timeclock" | "languages"
  | "checklist" | "qr" | "offline" | "comments" | "reports";

export interface OrgSettings {
  features: Record<ModuleKey, boolean>;
  languages: Lang[]; // езици, от които служителите могат да избират (ако модул „languages“ е включен)
}
export const DEFAULT_SETTINGS: OrgSettings = {
  features: {
    calendar: true, shifts: false, timeclock: false, languages: false,
    checklist: false, qr: false, offline: false, comments: false, reports: false,
  },
  languages: ["bg"],
};

export const MODULES: { key: ModuleKey; title: string; desc: string; group: "work" | "tasks" | "staff" }[] = [
  { key: "calendar", title: "Календар", desc: "Месечен календар за отваряне и търсене на задачи.", group: "tasks" },
  { key: "checklist", title: "Чеклист със стъпки и шаблони", desc: "Стъпки с отметки в задачата, шаблони на задачи и „Дублирай“.", group: "tasks" },
  { key: "qr", title: "QR код на обект", desc: "Места с печатен QR код – сканира се и отваря задачите на мястото.", group: "tasks" },
  { key: "comments", title: "Коментари по задача", desc: "Кратка кореспонденция служител – ръководител вътре в задачата.", group: "tasks" },
  { key: "offline", title: "Работа без интернет", desc: "Изпълнените задачи (със снимки) се изпращат сами, щом има връзка.", group: "tasks" },
  { key: "reports", title: "Отчети и експорт на задачите", desc: "Изпълнение по човек, група и период; Excel и печат/PDF.", group: "tasks" },
  { key: "shifts", title: "Смени и графици", desc: "Типове смени, седмичен график, публикуване към служителите.", group: "work" },
  { key: "timeclock", title: "Присъствие и часове", desc: "Начало/край на смяна, отработени часове, таблица за ръководителя и експорт.", group: "work" },
  { key: "languages", title: "Езици за служителите", desc: "Всеки служител избира на какъв език да вижда приложението.", group: "staff" },
];

/** Идеи, които още не са готови – показват се като „скоро“, за да се знае какво идва. */
export const ROADMAP: { title: string; desc: string }[] = [
  { title: "Диктовка на бележка", desc: "Говорите вместо да пишете бележката към задачата." },
  { title: "Масово одобрение", desc: "Одобряване на няколко задачи с едно докосване." },
  { title: "„Не мога“ и предаване на задача", desc: "Служителят отказва с причина или я предава на колега." },
  { title: "Архив със снимки", desc: "Търсене на снимките по обект и дата, за проверки." },
];

/** Какво виждат служителите – задава се по групи от ръководителя. */
export type SchedVis = "none" | "own" | "group";
export interface Visibility {
  see_calendar: boolean;
  see_schedule: SchedVis;
  see_hours: boolean;
  self_clock: boolean;
  see_history: boolean;
}
export const DEFAULT_VISIBILITY: Visibility = {
  see_calendar: true,
  see_schedule: "own",
  see_hours: true,
  self_clock: true,
  see_history: true,
};

const RANK: Record<SchedVis, number> = { none: 0, own: 1, group: 2 };

/** Служител в няколко групи получава най-широките права от тях. */
export function mergeVisibility(list: Partial<Visibility>[]): Visibility {
  if (list.length === 0) return DEFAULT_VISIBILITY;
  const full = list.map((v) => ({ ...DEFAULT_VISIBILITY, ...v }));
  return {
    see_calendar: full.some((v) => v.see_calendar),
    see_hours: full.some((v) => v.see_hours),
    self_clock: full.some((v) => v.self_clock),
    see_history: full.some((v) => v.see_history),
    see_schedule: full.reduce<SchedVis>((best, v) => (RANK[v.see_schedule] > RANK[best] ? v.see_schedule : best), "none"),
  };
}

/** Какво може да ползва текущият човек – модулите на фирмата и (за служител) видимостта от групите му. */
export interface Perm {
  calendar: boolean;
  schedule: "none" | "own" | "group" | "manage";
  hours: boolean; // страница „Часове“
  seeHours: boolean; // вижда отработените си часове
  clock: boolean; // сам отбелязва начало/край
  history: boolean;
  languages: boolean;
  checklist: boolean;
  qr: boolean;
  offline: boolean;
  comments: boolean;
  reports: boolean; // само за ръководители
}
export function computePerm(isManager: boolean, s: OrgSettings, v: Visibility): Perm {
  const f = s.features;
  return {
    checklist: f.checklist,
    qr: f.qr,
    offline: f.offline,
    comments: f.comments,
    reports: f.reports && isManager,
    calendar: f.calendar && (isManager || v.see_calendar),
    schedule: f.shifts ? (isManager ? "manage" : v.see_schedule) : "none",
    hours: f.timeclock && (isManager || v.see_hours || v.self_clock),
    seeHours: f.timeclock && (isManager || v.see_hours),
    clock: f.timeclock && (isManager || v.self_clock),
    history: isManager || v.see_history,
    languages: f.languages,
  };
}
