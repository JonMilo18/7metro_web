import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { allowedPushEndpoint } from "./push-actions.ts";
type Job = { id: number; lease: string; notification_id: number; kind: string; target: Record<string, unknown>; endpoint: string; p256dh: string; auth: string; language: string; binding: string };
type Vapid = { publicKey: string; privateKey: string; subject: string };
export function pushPayload(job: Job): Record<string, unknown> {
  const es = job.language === "es", kind = job.kind;
  const titles: Record<string, string[]> = {
    callups: job.target.kind === "session" ? ["Entrenamendu berria", "Nuevo entrenamiento"] : job.target.reason === "new" ? ["Deialdi berria", "Nueva convocatoria"] : ["Deialdia aldatu da", "La convocatoria ha cambiado"],
    schedule: ["Ordutegia edo tokia aldatu da", "Han cambiado el horario o el lugar"],
    notices: ["Taldeko abisu berria", "Nuevo aviso del equipo"], responses: ["Bertaratze-erantzun berria", "Nueva respuesta de asistencia"],
    friends: ["Lagun-eskaera berria", "Nueva solicitud de amistad"], test: ["Probako jakinarazpena", "Notificación de prueba"],
  };
  return { title: (titles[kind] || ["7metro", "7metro"])[es ? 1 : 0],
    body: kind === "test" ? (es ? "Las notificaciones funcionan en este dispositivo." : "Jakinarazpenak ondo dabiltza gailu honetan.") :
      (es ? "Abre la aplicación para ver los detalles." : "Ireki aplikazioa xehetasunak ikusteko."),
    notification_id: job.notification_id, binding: job.binding,
    tag: "7metro:" + kind + ":" + String(job.target.event_id || job.target.id || job.notification_id) };
}
export async function handlePushWorker(request: Request, supabase: SupabaseClient, vapid: Vapid, secret: string,
  generateRequestDetails: (subscription: unknown, payload: string, options: unknown) => { endpoint: string; headers: Record<string, string>; body: Uint8Array },
  fetcher: typeof fetch = fetch): Promise<Response> {
  const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const provided = request.headers.get("x-7metro-push-worker") || "";
  let difference = provided.length ^ secret.length;
  for (let i = 0; i < secret.length; i++) difference |= (provided.charCodeAt(i) || 0) ^ secret.charCodeAt(i);
  let authorized = Boolean(secret) && !difference;
  if (!authorized && secret && request.method === "POST") {
    try {
      const body = await request.json(), signature = request.headers.get("x-7metro-push-signature") || "";
      if (typeof body.nonce !== "string" || !/^[0-9a-f-]{36}$/.test(body.nonce) || !Number.isSafeInteger(body.timestamp) || Math.abs(Date.now() / 1000 - body.timestamp) > 120 || !/^[0-9a-f]{64}$/.test(signature)) throw Error("Invalid wake");
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body.timestamp + ":" + body.nonce));
      const expected = Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");
      let unequal = 0; for (let i = 0; i < expected.length; i++) unequal |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
      if (!unequal) {
        const consumed = await supabase.rpc("push_consume_wake", { p_nonce: body.nonce, p_timestamp: body.timestamp });
        authorized = !consumed.error && consumed.data === true;
      }
    } catch { authorized = false; }
  }
  if (!authorized) return response(401, { error: "Unauthorized" });
  if (request.method !== "POST") return response(405, { error: "POST required" });
  if (!vapid.publicKey || !vapid.privateKey || !vapid.subject) return response(503, { error: "Push unavailable" });
  try {
    if (new URL(request.url).searchParams.get("health") === "1") {
      const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
      const raw = new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey));
      const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const details = generateRequestDetails({ endpoint: "https://fcm.googleapis.com/fcm/send/health", keys: { p256dh: encode(raw), auth: encode(crypto.getRandomValues(new Uint8Array(16))) } },
        JSON.stringify({ title: "Health check" }), { vapidDetails: vapid, TTL: 60, contentEncoding: "aes128gcm" });
      return response(details.body.length > 20 ? 200 : 500, { ready: details.body.length > 20 });
    }
    const claimed = await supabase.rpc("push_claim", { p_limit: 20 });
    if (claimed.error) return response(500, { error: "Queue unavailable" });
    const jobs = (claimed.data || []) as Job[];
    const counts = { processed: jobs.length, sent: 0, failed: 0 };
    for (let start = 0; start < jobs.length; start += 4) {
      await Promise.all(jobs.slice(start, start + 4).map(async (job) => {
        let status = 400;
        if (allowedPushEndpoint(job.endpoint)) {
          try {
            const details = generateRequestDetails({ endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } }, JSON.stringify(pushPayload(job)),
              { vapidDetails: vapid, TTL: 3600, urgency: "normal", contentEncoding: "aes128gcm", topic: String(job.notification_id) });
            const result = await fetcher(details.endpoint, { method: "POST", headers: details.headers, body: new Uint8Array(details.body), redirect: "error", signal: AbortSignal.timeout(8000) });
            status = result.status; await result.body?.cancel();
          } catch { status = 0; }
        }
        const finished = await supabase.rpc("push_finish", { p_id: job.id, p_lease: job.lease, p_status: status });
        if (status >= 200 && status < 300 && !finished.error) counts.sent++; else counts.failed++;
      }));
    }
    return response(200, counts);
  } catch { return response(500, { error: "Push processing failed" }); }
}
