import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Клиент с правата на викащия потребител (RLS и auth.uid() работят както в приложението). */
export function userClient(req: Request): SupabaseClient {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new HttpError(401, "not_authenticated");
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
}

/** Клиент със service role – само след проверка на правата през userClient. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export async function currentUserId(user: SupabaseClient): Promise<string> {
  const { data, error } = await user.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "not_authenticated");
  return data.user.id;
}

/** Обвивка: CORS, OPTIONS, превръщане на грешки в JSON. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "server_error" }, 500);
    }
  };
}

export function siteUrl(): string {
  return (Deno.env.get("SITE_URL") ?? "http://localhost:5173").replace(/\/$/, "");
}

/** Служебен имейл за служители без собствен имейл: потребителско име + код на фирмата. */
export function staffEmail(username: string, orgCode: string): string {
  return `${username}@${orgCode}.staff.teamtasks.app`;
}
