import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { DICT } from "./dict";

/**
 * Многоезичност: българският текст е ключ (t("Днес")), а другите езици го превеждат.
 * Липсващ превод се показва на български. Данните (имена на задачи, бележки) не се превеждат.
 */
export type Lang = "bg" | "en" | "ru" | "uk";
export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "bg", label: "Български", flag: "🇧🇬" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "ru", label: "Русский", flag: "🇷🇺" },
  { code: "uk", label: "Українська", flag: "🇺🇦" },
];
export const LOCALE: Record<Lang, string> = { bg: "bg-BG", en: "en-GB", ru: "ru-RU", uk: "uk-UA" };

const KEY = "teamtasks.lang";
function read(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    return v === "en" || v === "ru" || v === "uk" || v === "bg" ? v : "bg";
  } catch {
    return "bg";
  }
}
let current: Lang = read();
if (typeof document !== "undefined") document.documentElement.lang = current;

export const getLang = (): Lang => current;

/** Превод по български ключ; {име} в текста се заменя със стойности от vars. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = current === "bg" ? key : DICT[current]?.[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
}
const C = createContext<Ctx>({ lang: "bg", setLang: () => undefined });
export const useLang = () => useContext(C);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(current);
  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang: (l) => {
        current = l;
        try {
          localStorage.setItem(KEY, l);
        } catch {
          /* частен режим */
        }
        document.documentElement.lang = l;
        set(l);
      },
    }),
    [lang],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
