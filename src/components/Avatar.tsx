const TONES = ["#1f4d3f", "#8a5a44", "#4b5d7a", "#7a4b64", "#6b6a33", "#3f6b72"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
function tone(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

/** Кръгче с инициалите на човека (цветът е постоянен за всяко име). */
export default function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <span className="avatar" style={{ background: tone(name), width: size, height: size, fontSize: size * 0.34 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
