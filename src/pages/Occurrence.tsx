import { useCallback, useEffect, useRef, useState } from "react";
import { confetti } from "../lib/fx";
import { t as tr } from "../lib/i18n";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useApp } from "../lib/session";
import { OCC_SELECT, type Occurrence } from "../lib/types";
import { compressImage, errMsg, niceDate, niceDateTime, signedUrls, uploadFile, uuid } from "../lib/util";
import { enqueueSubmit, isNetworkError, useQueuedIds } from "../lib/offline";
import { Alert, Chip, Field, Spinner, isLate, useLightbox } from "../components/ui";
import Comments from "../components/Comments";

interface Attach {
  id: string;
  path: string;
  name: string | null;
}
interface Draft {
  id: string;
  blob: Blob;
  url: string;
}

export default function OccurrencePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { org, me, isManager, isOwner, perm } = useApp();
  const [o, setO] = useState<Occurrence | null>(null);
  const [stepsDone, setStepsDone] = useState<boolean[]>([]);
  const [placeName, setPlaceName] = useState("");
  const queuedIds = useQueuedIds();
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [attach, setAttach] = useState<Attach[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState(false);

  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const box = useLightbox();

  const load = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase.from("occurrences").select(OCC_SELECT).eq("id", id).maybeSingle();
    if (!data) return setMissing(true);
    const occ = data as unknown as Occurrence;
    const [ph, at] = await Promise.all([
      supabase.from("occurrence_photos").select("path").eq("occurrence_id", id).order("created_at"),
      supabase.from("task_attachments").select("id, path, name").eq("task_id", occ.task_id),
    ]);
    const paths = ((ph.data as { path: string }[]) ?? []).map((p) => p.path);
    const att = (at.data as Attach[]) ?? [];
    setUrls(await signedUrls([...paths, ...att.map((a) => a.path)]).catch(() => ({})));
    setPhotoPaths(paths);
    setAttach(att);
    setStepsDone((occ.tasks.steps ?? []).map((_, i) => Boolean(occ.steps_done?.[i])));
    if (occ.tasks.place_id) {
      const pl = await supabase.from("places").select("name").eq("id", occ.tasks.place_id).maybeSingle();
      setPlaceName((pl.data as { name: string } | null)?.name ?? "");
    }
    setO(occ);
    setNote((n) => n || occ.note || "");
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // след автоматично изпращане от опашката – обнови статуса
  const inQueue = id ? queuedIds.has(id) : false;
  const wasQueued = useRef(false);
  useEffect(() => {
    if (wasQueued.current && !inQueue) load();
    wasQueued.current = inQueue;
  }, [inQueue, load]);

  useEffect(() => () => drafts.forEach((d) => URL.revokeObjectURL(d.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (missing) return <Alert kind="bad">{tr("Задачата не е намерена или нямате достъп до нея.")}</Alert>;
  if (!o || !org || !me) return <Spinner />;

  const mineToDo =
    (o.status === "pending" || o.status === "rejected") &&
    (o.assignee_id === me.id || (o.assignee_id === null && o.group_id !== null));
  const canReview = isManager && o.status === "submitted" && (o.completed_by !== me.id || isOwner);
  const t = o.tasks;

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files).map((f) => ({ id: uuid(), blob: f as Blob, url: URL.createObjectURL(f) }));
    setDrafts((d) => [...d, ...next].slice(0, 6));
  }
  function removeDraft(did: string) {
    setDrafts((d) => d.filter((x) => x.id !== did));
  }

  const steps = t.steps ?? [];
  const stepsLeft = stepsDone.filter((x) => !x).length;

  async function toggleStep(i: number) {
    if (!o) return;
    const next = stepsDone.map((v, j) => (j === i ? !v : v));
    setStepsDone(next); // веднага; при липса на връзка отметките се пращат със задачата
    const { error } = await supabase.rpc("set_occurrence_steps", { p_id: o.id, p_done: next });
    if (error && !isNetworkError(error)) setErr(errMsg(error));
  }

  async function submit() {
    if (!o || !org) return;
    setErr("");
    if (t.requires_photo && drafts.length + photoPaths.length === 0) return setErr(tr("Добавете снимка."));
    if (t.requires_note && !note.trim()) return setErr(tr("Напишете бележка."));
    if (steps.length && t.steps_required && stepsLeft > 0) return setErr(tr("Отбележете всички стъпки, преди да изпратите задачата."));
    setBusy(tr("Изпращане…"));
    let blobs: Blob[] = [];
    try {
      blobs = await Promise.all(drafts.map((d) => compressImage(d.blob as File)));
      if (perm.offline && !navigator.onLine) throw new Error("Failed to fetch");
      const paths: string[] = [];
      for (const [i, blob] of blobs.entries()) {
        setBusy(tr("Качване на снимка {i}/{n}…", { i: i + 1, n: blobs.length }));
        const path = `${org.id}/proof/${o.id}/${uuid()}.${blob.type === "image/jpeg" ? "jpg" : "bin"}`;
        await uploadFile(path, blob, blob.type || "image/jpeg");
        paths.push(path);
      }
      setBusy(tr("Изпращане…"));
      const { error } = await supabase.rpc("submit_occurrence", { p_id: o.id, p_note: note, p_photos: paths });
      if (error) throw error;
      drafts.forEach((d) => URL.revokeObjectURL(d.url));
      setDrafts([]);
      await load();
      confetti();
    } catch (e) {
      if (perm.offline && isNetworkError(e)) {
        await enqueueSubmit({ org_id: org.id, occ_id: o.id, title: t.title, note, steps: stepsDone, photos: blobs });
        drafts.forEach((d) => URL.revokeObjectURL(d.url));
        setDrafts([]);
      } else {
        setErr(errMsg(e));
      }
    } finally {
      setBusy("");
    }
  }
  const queued = queuedIds.has(o.id);

  async function review(approve: boolean) {
    if (!o) return;
    setErr("");
    if (!approve && !comment.trim()) return setErr(tr("При връщане напишете причина."));
    setBusy(tr("Запис…"));
    const { error } = await supabase.rpc("review_occurrence", {
      p_id: o.id,
      p_approve: approve,
      p_comment: comment,
    });
    setBusy("");
    if (error) return setErr(errMsg(error));
    nav(-1);
  }

  const att = attach.map((a) => ({ ...a, url: urls[a.path] }));
  const isImg = (p: string) => /\.(jpe?g|png|webp)$/i.test(p);

  return (
    <div className="stack">
      <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => nav(-1)}>
        ← {tr("Назад")}
      </button>
      <div className="card stack">
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <h1>{t.title}</h1>
          <Chip status={o.status} late={isLate(o)} />
        </div>
        <div className="row wrap small muted" style={{ gap: 10 }}>
          <span>{niceDate(o.due_date)}</span>
          {t.due_time && <span>{tr("до {time}", { time: t.due_time.slice(0, 5) })}</span>}
          {o.groups && (
            <span className="row" style={{ gap: 5 }}>
              <i className="dot" style={{ background: o.groups.color }} />
              {o.groups.name}
            </span>
          )}
          {(o.completer ?? o.assignee) && <span>👤 {(o.completer ?? o.assignee)!.display_name}</span>}
          {t.priority === 1 && <span style={{ color: "var(--bad)", fontWeight: 700 }}>{tr("Спешно")}</span>}
        </div>
        {t.description && <p>{t.description}</p>}
        <div className="row wrap" style={{ gap: 6 }}>
          {t.requires_photo && <span className="chip">📷 {tr("Изисква снимка")}</span>}
          {t.requires_note && <span className="chip">✍️ {tr("Изисква бележка")}</span>}
          {t.requires_approval && <span className="chip">👤 {tr("Одобрява се от ръководител")}</span>}
          {placeName && <span className="chip">📍 {placeName}</span>}
        </div>
      </div>

      {(t.instructions || att.length > 0) && (
        <div className="card stack">
          <h2>{tr("Инструкции")}</h2>
          {t.instructions && <div className="instructions">{t.instructions}</div>}
          {att.length > 0 && (
            <div className="photos">
              {att.map((a) =>
                isImg(a.path) && a.url ? (
                  <img key={a.id} src={a.url} alt={a.name ?? tr("Инструкция")} onClick={() => box.open(a.url!)} />
                ) : (
                  <a key={a.id} className="btn small" href={a.url} target="_blank" rel="noreferrer">
                    📄 {a.name ?? tr("Файл")}
                  </a>
                ),
              )}
            </div>
          )}
        </div>
      )}

      {steps.length > 0 && (
        <div className="card stack">
          <div className="row between">
            <h2>{tr("Стъпки")}</h2>
            <span className="muted small">
              {tr("{done} от {n}", { done: steps.length - stepsLeft, n: steps.length })}
            </span>
          </div>
          <div className="progress" aria-hidden>
            <i style={{ width: `${((steps.length - stepsLeft) / steps.length) * 100}%` }} />
          </div>
          <div className="steps">
            {steps.map((s, i) => (
              <label key={i} className={`step ${stepsDone[i] ? "done" : ""} ${mineToDo && !queued ? "" : "ro"}`}>
                <input type="checkbox" checked={Boolean(stepsDone[i])} disabled={!mineToDo || queued} onChange={() => toggleStep(i)} />
                <span>{s}</span>
              </label>
            ))}
          </div>
          {mineToDo && t.steps_required && stepsLeft > 0 && <p className="muted small">{tr("Всички стъпки са задължителни преди изпращане.")}</p>}
        </div>
      )}

      {o.status === "rejected" && o.review_comment && (
        <Alert kind="bad">
          <b>{tr("Върнато от ръководителя:")}</b> {o.review_comment}
        </Alert>
      )}

      {queued && (
        <Alert kind="info">
          <b>{tr("Запазено в телефона.")}</b> {tr("Задачата ще се изпрати сама, щом има връзка.")}
        </Alert>
      )}

      {/* изпълнение */}
      {mineToDo && !queued && (
        <div className="card stack">
          <h2>{o.status === "rejected" ? tr("Поправете и изпратете отново") : tr("Изпълнение")}</h2>
          <Field label={t.requires_note ? tr("Бележка (задължителна)") : tr("Бележка (по желание)")}>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("Напр. всичко е почистено, липсва препарат…")} />
          </Field>
          <div className="label">{t.requires_photo ? tr("Снимка (задължителна)") : tr("Снимки (по желание)")}</div>
          {(drafts.length > 0 || photoPaths.length > 0) && (
            <div className="photos">
              {photoPaths.map((p) => urls[p] && <img key={p} src={urls[p]} alt={tr("Снимка")} onClick={() => box.open(urls[p])} />)}
              {drafts.map((d) => (
                <div className="ph" key={d.id}>
                  <img src={d.url} alt={tr("Нова снимка")} />
                  <button onClick={() => removeDraft(d.id)} aria-label={tr("Премахни")}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="row wrap">
            <button className="btn" type="button" onClick={() => cam.current?.click()} disabled={drafts.length >= 6}>
              📷 {tr("Снимай")}
            </button>
            <button className="btn" type="button" onClick={() => gal.current?.click()} disabled={drafts.length >= 6}>
              🖼️ {tr("От галерията")}
            </button>
            <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
            <input ref={gal} type="file" accept="image/*" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
          </div>
          {err && <Alert kind="bad">{err}</Alert>}
          <button className="btn primary block" onClick={submit} disabled={Boolean(busy)}>
            {busy || (t.requires_approval ? `✓ ${tr("Готово – изпрати за одобрение")}` : `✓ ${tr("Готово")}`)}
          </button>
        </div>
      )}

      {/* изпратено / готово */}
      {o.status !== "pending" && !mineToDo && (
        <div className="card stack">
          <h2>{tr("Изпълнение")}</h2>
          {o.completed_at && (
            <div className="small muted">
              {o.completer?.display_name ?? ""} · {niceDateTime(o.completed_at)}
            </div>
          )}
          {o.note ? <p style={{ whiteSpace: "pre-wrap" }}>{o.note}</p> : <p className="muted">{tr("Без бележка.")}</p>}
          {photoPaths.length > 0 && (
            <div className="photos">
              {photoPaths.map((p) => urls[p] && <img key={p} src={urls[p]} alt={tr("Снимка")} onClick={() => box.open(urls[p])} />)}
            </div>
          )}
          {o.status === "approved" && o.reviewed_at && (
            <Alert kind="ok">
              {tr("Одобрено")} · {niceDateTime(o.reviewed_at)}
              {o.review_comment ? ` – ${o.review_comment}` : ""}
            </Alert>
          )}
          {o.status === "submitted" && !canReview && <Alert kind="info">{tr("Чака одобрение от ръководител.")}</Alert>}
        </div>
      )}

      {/* одобрение */}
      {canReview && (
        <div className="card stack">
          <h2>Потвърждение</h2>
          <Field label="Коментар (задължителен при връщане)">
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          {err && <Alert kind="bad">{err}</Alert>}
          <div className="row">
            <button className="btn ok grow" onClick={() => review(true)} disabled={Boolean(busy)}>
              ✓ Одобри
            </button>
            <button className="btn danger grow" onClick={() => review(false)} disabled={Boolean(busy)}>
              ↩ Върни
            </button>
          </div>
        </div>
      )}
      {!mineToDo && !canReview && err && <Alert kind="bad">{err}</Alert>}
      {perm.comments && <Comments occurrenceId={o.id} />}
      {box.node}
    </div>
  );
}
