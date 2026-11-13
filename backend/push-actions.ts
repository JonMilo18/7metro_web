import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
export const pushActions = new Set(["push_status", "push_save", "push_remove", "push_test", "push_resolve"]);
export function allowedPushEndpoint(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value), host = url.hostname;
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash &&
      (host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host.endsWith(".push.services.mozilla.com") ||
       host === "web.push.apple.com" || host === "notify.windows.com" || host.endsWith(".notify.windows.com"));
  } catch { return false; }
}
function keyBytes(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.length > 100) return null;
  try { return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)); } catch { return null; }
}
async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");
}
export async function handlePushAction(payload: Record<string, unknown>, supabase: SupabaseClient, userId: number,
  sessionToken: string, publicKey: string, configured: boolean, respond: (status: number, body: unknown) => Response): Promise<Response> {
  const action = String(payload.action);
  if (!pushActions.has(action) || JSON.stringify(payload).length > 6000) return respond(400, { error: "Datuak ez dira baliozkoak" });
  if (action === "push_resolve") {
    const id = Number(payload.id);
    if (!Number.isSafeInteger(id) || id < 1) return respond(400, { error: "Datuak ez dira baliozkoak" });
    const result = await supabase.from("push_events").select("kind,target").eq("id", id).eq("user_id", userId).maybeSingle();
    if (result.error) return respond(500, { error: "Ezin izan da jakinarazpena ireki" });
    if (!result.data) return respond(404, { error: "Jakinarazpena ez dago erabilgarri" });
    const check = await supabase.rpc("push_target_allowed", { p_user: userId, p_kind: result.data.kind, p_target: result.data.target });
    if (check.error || !check.data) return respond(404, { error: "Jakinarazpena ez dago erabilgarri" });
    await supabase.rpc("notification_inbox_action", { p_user: userId, p_action: "ack_push", p_data: { id } });
    return respond(200, { ok: true, kind: result.data.kind, target: result.data.target });
  }
  if (typeof payload.device_secret !== "string" || !/^[0-9a-f]{64}$/.test(payload.device_secret)) return respond(400, { error: "Datuak ez dira baliozkoak" });
  if (!configured && ["push_save", "push_test"].includes(action)) return respond(503, { error: "Jakinarazpenen zerbitzua ez dago erabilgarri" });
  const data: Record<string, unknown> = {};
  if (action === "push_save") {
    const subscription = payload.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const p256dh = keyBytes(subscription?.keys?.p256dh), auth = keyBytes(subscription?.keys?.auth);
    if (!allowedPushEndpoint(subscription?.endpoint) || !p256dh || p256dh.length !== 65 || p256dh[0] !== 4 || !auth || auth.length !== 16) {
      return respond(400, { error: "Jakinarazpenen harpidetza ez da baliozkoa" });
    }
    try { await crypto.subtle.importKey("raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []); }
    catch { return respond(400, { error: "Jakinarazpenen harpidetza ez da baliozkoa" }); }
    const prefs = payload.preferences as Record<string, unknown>, kinds = ["callups", "schedule", "notices", "responses", "friends"];
    if (!prefs || typeof prefs !== "object" || Object.keys(prefs).length !== kinds.length || kinds.some((kind) => typeof prefs[kind] !== "boolean") || !["eu", "es"].includes(String(payload.language))) {
      return respond(400, { error: "Datuak ez dira baliozkoak" });
    }
    Object.assign(data, { endpoint: subscription.endpoint, p256dh: subscription.keys!.p256dh, auth: subscription.keys!.auth, preferences: prefs, language: payload.language });
  }
  const result = await supabase.rpc("push_device_action", { p_user: userId, p_session: await hash(sessionToken),
    p_device: await hash(payload.device_secret), p_action: action.slice(5), p_data: data });
  if (result.error) {
    const error = result.error, safe = ["Saioa iraungi da; hasi berriro", "Aktibatu jakinarazpenak lehenik", "Itxaron minutu bat berriro probatu aurretik"];
    return respond(error.code === "42501" ? 403 : error.code === "23505" ? 409 : error.code === "22023" ? 429 : 500,
      { error: safe.includes(error.message) ? error.message : "Ezin izan dira jakinarazpenen ezarpenak gorde" });
  }
  return respond(200, { ok: true, ...result.data, configured, public_key: configured ? publicKey : "" });
}
