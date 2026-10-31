import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { uploadFile, uuid } from "./util";

/**
 * Работа без интернет: изпълнена задача (отметки, бележка, снимки) се пази в телефона (IndexedDB)
 * и се изпраща сама, щом има връзка. Включва се от работодателя (модул „Работа без интернет“).
 */
export interface QueuedSubmit {
  id: string;
  org_id: string;
  occ_id: string;
  title: string;
  note: string;
  steps: boolean[];
  photos: Blob[];
  created: number;
}

export const QUEUE_EVENT = "teamtasks:queue";
const DB_NAME = "teamtasks-offline";
const STORE = "queue";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let ids = new Set<string>();
const emit = () => window.dispatchEvent(new Event(QUEUE_EVENT));

export const queuedList = (): Promise<QueuedSubmit[]> => tx("readonly", (s) => s.getAll() as IDBRequest<QueuedSubmit[]>);

async function refresh() {
  try {
    ids = new Set((await queuedList()).map((q) => q.occ_id));
  } catch {
    ids = new Set();
  }
  emit();
}

export async function enqueueSubmit(item: Omit<QueuedSubmit, "id" | "created">): Promise<void> {
  // една задача – един запис (последният замества предишния)
  const existing = (await queuedList()).filter((q) => q.occ_id === item.occ_id);
  for (const e of existing) await tx("readwrite", (s) => s.delete(e.id));
  await tx("readwrite", (s) => s.put({ ...item, id: uuid(), created: Date.now() }));
  await refresh();
}

/** Мрежова грешка (няма връзка), а не отказ от сървъра. */
export function isNetworkError(e: unknown): boolean {
  const msg = (e as { message?: string })?.message ?? String(e ?? "");
  return !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
}

let flushing = false;
/** Изпраща чакащите задачи; спира при липса на връзка. Връща броя изпратени и отказани от сървъра. */
export async function flushQueue(): Promise<{ sent: number; rejected: { title: string; error: string }[] }> {
  const out = { sent: 0, rejected: [] as { title: string; error: string }[] };
  if (flushing || !navigator.onLine) return out;
  flushing = true;
  try {
    for (const q of await queuedList()) {
      try {
        const paths: string[] = [];
        for (const blob of q.photos) {
          const path = `${q.org_id}/proof/${q.occ_id}/${uuid()}.jpg`;
          await uploadFile(path, blob, blob.type || "image/jpeg");
          paths.push(path);
        }
        if (q.steps.length) {
          const s = await supabase.rpc("set_occurrence_steps", { p_id: q.occ_id, p_done: q.steps });
          if (s.error) throw s.error;
        }
        const { error } = await supabase.rpc("submit_occurrence", { p_id: q.occ_id, p_note: q.note, p_photos: paths });
        if (error) throw error;
        await tx("readwrite", (s) => s.delete(q.id));
        out.sent++;
      } catch (e) {
        if (isNetworkError(e)) break; // продължаваме при следваща връзка
        out.rejected.push({ title: q.title, error: (e as { message?: string })?.message ?? "грешка" });
        await tx("readwrite", (s) => s.delete(q.id)); // сървърът я отказва (напр. вече е изпратена) – не се опитва пак
      }
    }
  } finally {
    flushing = false;
    await refresh();
  }
  return out;
}

/** Кои задания чакат изпращане (за значка в списъците). */
export function useQueuedIds(): Set<string> {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener(QUEUE_EVENT, on);
    refresh();
    return () => window.removeEventListener(QUEUE_EVENT, on);
  }, []);
  return ids;
}
