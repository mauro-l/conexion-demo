// supabase/functions/send-push/index.ts
// Edge Function (Deno) — fanout Web Push al barbero tras reserva/cancelación.
//
// Scaffold T5: NO deployada aún. Requiere secrets VAPID_* + migración phase10
// aplicada. Ver README.md de esta carpeta para deploy y prueba.
//
// ESTILO: Deno fmt (dobles comillas) — excepción documentada a la prettier
// single-quote del repo app (esta carpeta está excluida de tsc y eslint app).
//
// Contrato:
//   POST {
//     barbero_id: number, evento: "reserva" | "cancelacion",
//     titulo: string, cuerpo: string, turno_id?: number
//   }
//   → 200 { sent, skipped, pruned, errors }
//   4xx ante input/autorización inválidos.
//   Los fallos de envío por suscripción NUNCA lanzan: se acumulan en `errors`
//   y las suscripciones muertas (404/410) se prunan en silencio.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "@supabase/supabase-js";
// @deno-types="npm:@types/web-push@3"
import webpush from "web-push";

type PushEvento = "reserva" | "cancelacion";

type PushRequest = {
  barbero_id: number;
  evento: PushEvento;
  titulo: string;
  cuerpo: string;
  turno_id?: number;
};

type PushResult = {
  sent: number;
  skipped: number;
  pruned: number;
  errors: string[];
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isPushEvento(value: unknown): value is PushEvento {
  return value === "reserva" || value === "cancelacion";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let payload: PushRequest;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Cuerpo JSON inválido." }, 400);
  }

  if (
    typeof payload.barbero_id !== "number" ||
    !isPushEvento(payload.evento) ||
    typeof payload.titulo !== "string" ||
    typeof payload.cuerpo !== "string"
  ) {
    return json(
      { error: "Payload inválido: barbero_id, evento, titulo, cuerpo requeridos." },
      400,
    );
  }

  // --- Auth: JWT del caller o service_role (server-to-server) ---
  // El service_role NUNCA sale al cliente: solo se compara acá, en server,
  // para permitir futuros triggers internos (webhooks). El JWT se valida
  // con el cliente anon + header Authorization del caller.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  const isServiceRoleCall =
    callerToken !== "" && callerToken === SUPABASE_SERVICE_ROLE_KEY;

  let callerUserId: string | null = null;
  if (!isServiceRoleCall) {
    if (!callerToken) return json({ error: "Falta Authorization." }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await userClient.auth.getUser();
    if (error || !data.user) return json({ error: "JWT inválido." }, 401);
    callerUserId = data.user.id;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // --- Barbero + prefs (ownership: el JWT debe ser dueño del barbero) ---
  const { data: barbero, error: barberoError } = await admin
    .from("Barbero")
    .select("id, users_id, notify_on_reserva, notify_on_cancelacion")
    .eq("id", payload.barbero_id)
    .maybeSingle();

  if (barberoError || !barbero) {
    return json({ error: "Barbero no encontrado." }, 404);
  }
  if (callerUserId && barbero.users_id !== callerUserId) {
    return json({ error: "No autorizado para este barbero." }, 403);
  }

  const { data: subs, error: subsError } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("barbero_id", payload.barbero_id);

  if (subsError) {
    const result: PushResult = {
      sent: 0,
      skipped: 0,
      pruned: 0,
      errors: ["No se pudieron leer las suscripciones."],
    };
    return json(result, 500);
  }

  const result: PushResult = { sent: 0, skipped: 0, pruned: 0, errors: [] };

  // Pref off → no enviar; skipped cuenta las subs que se omitieron.
  const prefOn =
    payload.evento === "reserva"
      ? barbero.notify_on_reserva
      : barbero.notify_on_cancelacion;
  if (prefOn === false) {
    result.skipped = subs?.length ?? 0;
    return json(result);
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    result.errors.push("Faltan secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.");
    result.skipped = subs?.length ?? 0;
    return json(result, 500);
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const notificationPayload = JSON.stringify({
    title: payload.titulo,
    body: payload.cuerpo,
    turno_id: payload.turno_id ?? null,
    evento: payload.evento,
  });

  for (const sub of subs ?? []) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await webpush.sendNotification(subscription, notificationPayload);
      result.sent += 1;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Suscripción muerta → prune, sin error.
        const { error: delError } = await admin
          .from("push_subscriptions")
          .delete()
          .eq("id", sub.id);
        if (delError) result.errors.push(`Prune falló para sub ${sub.id}.`);
        else result.pruned += 1;
      } else {
        result.errors.push(
          `Envío falló (${statusCode ?? "sin código"}) para sub ${sub.id}.`,
        );
      }
    }
  }

  return json(result);
});
