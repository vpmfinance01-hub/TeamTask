import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { t } from "../lib/i18n";
import { OCC_SELECT, type Occurrence, type Place } from "../lib/types";
import { errMsg, slugify, uuid, ymd } from "../lib/util";
import OccCard from "../components/OccCard";
import { Alert, Empty, Spinner } from "../components/ui";

const linkFor = (code: string) => `${location.origin}/p/${code}`;

function Qr({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(linkFor(code), { type: "svg", margin: 1, width: 180 }).then(setSvg);
  }, [code]);
  return <div dangerouslySetInnerHTML={{ __html: svg }} style={{ width: "100%", display: "grid", justifyItems: "center" }} />;
}

/** Мениджър: места с QR кодове за печат и лепене. */
export function PlaceList() {
  const { org, groups } = useApp();
  const [list, setList] = useState<Place[] | null>(null);
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase.from("places").select("*").eq("org_id", org.id).order("name");
    setList((data as Place[]) ?? []);
  }, [org]);
  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!org || !name.trim()) return;
    setErr("");
    const code = `${slugify(name) || "mjasto"}-${uuid().slice(0, 6)}`;
    const { error } = await supabase.from("places").insert({ org_id: org.id, name: name.trim(), code, group_id: groupId || null });
    if (error) return setErr(errMsg(error));
    setName("");
    load();
  }
  async function remove(p: Place) {
    if (!confirm(`Изтриване на „${p.name}“? Отпечатаният QR код вече няма да работи.`)) return;
    const { error } = await supabase.from("places").delete().eq("id", p.id);
    if (error) return setErr(errMsg(error));
    load();
  }
  async function copy(p: Place) {
    try {
      await navigator.clipboard.writeText(linkFor(p.code));
      setCopied(p.id);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      prompt("Линк:", linkFor(p.code));
    }
  }

  if (list === null) return <Spinner />;
  return (
    <div className="stack">
      <div className="row between no-print">
        <h1>Места и QR кодове</h1>
        <div className="row">
          <Link className="btn small" to="/tasks">← Задачи</Link>
          {list.length > 0 && <button className="btn small" onClick={() => window.print()}>🖨 Печат</button>}
        </div>
      </div>
      <p className="muted small no-print">
        Залепете QR кода на мястото (стая, машина, склад). Служителят го сканира с камерата на телефона и вижда задачите за това място. Свържете задача с място във формата на задачата.
      </p>
      <div className="card stack no-print">
        <h2>Ново място</h2>
        <div className="row wrap">
          <input type="text" className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Напр. Склад – рампа" maxLength={60} aria-label="Име на мястото" />
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Група">
            <option value="">Всички групи</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <button className="btn primary" onClick={add} disabled={!name.trim()}>Добави</button>
        </div>
        {err && <Alert kind="bad">{err}</Alert>}
      </div>
      {list.length === 0 ? (
        <Empty icon="📍">Още няма места.</Empty>
      ) : (
        <div className="qr-grid">
          {list.map((p) => (
            <div className="qr-card" key={p.id}>
              <Qr code={p.code} />
              <div className="nm">{p.name}</div>
              <div className="row no-print" style={{ gap: 6 }}>
                <button className="btn small" onClick={() => copy(p)}>{copied === p.id ? "✓ Копирано" : "Копирай линк"}</button>
                <button className="btn small danger" onClick={() => remove(p)}>Изтрий</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Служител: отваря се от QR код – задачите за мястото днес. */
export function PlaceView() {
  const { code } = useParams();
  const { org } = useApp();
  const [place, setPlace] = useState<Place | null | undefined>(undefined);
  const [occs, setOccs] = useState<Occurrence[]>([]);

  useEffect(() => {
    if (!org || !code) return;
    (async () => {
      const { data } = await supabase.from("places").select("*").eq("org_id", org.id).eq("code", code).maybeSingle();
      const p = (data as Place | null) ?? null;
      setPlace(p);
      if (!p) return;
      const r = await supabase.from("occurrences").select(OCC_SELECT).eq("org_id", org.id).eq("due_date", ymd());
      setOccs(((r.data as unknown as Occurrence[]) ?? []).filter((o) => o.tasks.place_id === p.id));
    })();
  }, [org, code]);

  if (place === undefined) return <Spinner />;
  if (place === null) return <Alert kind="bad">{t("Този QR код не е разпознат.")}</Alert>;
  return (
    <div className="stack">
      <h1>📍 {place.name}</h1>
      {occs.length === 0 ? <Empty icon="✅">{t("Днес няма задачи за това място.")}</Empty> : occs.map((o) => <OccCard key={o.id} o={o} />)}
    </div>
  );
}

/** Сканиране на QR код с камерата (където браузърът поддържа BarcodeDetector). */
export function ScanPage() {
  const nav = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stop = false;
    let stream: MediaStream | undefined;
    (async () => {
      const BD = (window as unknown as { BarcodeDetector?: new (o: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      if (!BD) return setErr(t("Този браузър не сканира кодове. Отворете камерата на телефона и насочете към QR кода."));
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const det = new BD({ formats: ["qr_code"] });
        const tick = async () => {
          if (stop || !video.current) return;
          const found = await det.detect(video.current).catch(() => []);
          const m = found.map((f) => f.rawValue.match(/\/p\/([\w-]+)/)).find(Boolean);
          if (m) return nav(`/p/${m[1]}`, { replace: true });
          setTimeout(tick, 300);
        };
        tick();
      } catch {
        setErr(t("Няма достъп до камерата."));
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((x) => x.stop());
    };
  }, [nav]);

  return (
    <div className="stack">
      <h1>{t("Сканирай QR код")}</h1>
      {err ? <Alert kind="warn">{err}</Alert> : <div className="scanner"><video ref={video} muted playsInline /></div>}
    </div>
  );
}
