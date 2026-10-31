// Изглед: „sphere“ (тъмен, като входната страница – по подразбиране), „studio“ (дизайнерски – топли тонове,
// сериф заглавия, плавни ефекти) или „classic“ (простият светъл). Ефектите се изключват отделно.
// „sphere“ е цветова кожа върху структурата на „studio“: data-theme="studio" + data-skin="sphere".
export type Theme = "sphere" | "studio" | "classic";
const K_THEME = "teamtasks.theme2"; // нов ключ: старият избор („studio“) не заглушава новата тема „Сфера“ по подразбиране
const K_FX = "teamtasks.fx";

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(K_THEME);
    return v === "classic" || v === "studio" ? v : "sphere";
  } catch {
    return "sphere";
  }
}
export function getFx(): boolean {
  try {
    return localStorage.getItem(K_FX) !== "off";
  } catch {
    return true;
  }
}

export function applyTheme(): void {
  const root = document.documentElement;
  const th = getTheme();
  root.dataset.theme = th === "classic" ? "classic" : "studio";
  if (th === "sphere") root.dataset.skin = "sphere";
  else delete root.dataset.skin;
  root.dataset.fx = getFx() ? "on" : "off";
}

export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(K_THEME, t);
  } catch {
    /* частен режим */
  }
  applyTheme();
}
export function setFx(on: boolean): void {
  try {
    localStorage.setItem(K_FX, on ? "on" : "off");
  } catch {
    /* частен режим */
  }
  applyTheme();
}

/** Ефектите са разрешени от потребителя и от системата („намали движението“ ги изключва). */
export function fxEnabled(): boolean {
  return getFx() && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
