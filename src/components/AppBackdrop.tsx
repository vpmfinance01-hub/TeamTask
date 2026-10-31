import { useEffect, useState } from "react";
import ParticleHero from "./ParticleHero";

/** Приглушена сфера зад приложението – само в тъмния изглед „Сфера“ и при включени ефекти. */
export default function AppBackdrop() {
  const read = () => document.documentElement.dataset.skin === "sphere" && document.documentElement.dataset.fx === "on";
  const [on, setOn] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setOn(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin", "data-fx"] });
    return () => mo.disconnect();
  }, []);
  return on ? <ParticleHero backdrop /> : null;
}
