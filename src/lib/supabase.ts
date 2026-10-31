import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createDemoClient } from "./demo/client";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Без Supabase настройки приложението работи в демо режим (данни само в този браузър). */
export const isDemo = !(url && key);

export const supabase: SupabaseClient = isDemo
  ? (createDemoClient() as unknown as SupabaseClient)
  : createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

export const STAFF_DOMAIN = "staff.teamtasks.app";
export const BUCKET = "task-files";
