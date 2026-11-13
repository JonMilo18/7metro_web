import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const inboxActions = new Set(["inbox_list", "inbox_count", "inbox_open", "inbox_read_all"]);

export async function handleInboxAction(payload: Record<string, unknown>, supabase: SupabaseClient,
  userId: number, respond: (status: number, body: unknown) => Response): Promise<Response> {
  if (!inboxActions.has(String(payload.action)) || JSON.stringify(payload).length > 1000) {
    return respond(400, { error: "Datuak ez dira baliozkoak" });
  }
  const result = await supabase.rpc("notification_inbox_action", {
    p_user: userId, p_action: String(payload.action).slice(6), p_data: { id: payload.id, before: payload.before },
  });
  if (result.error) {
    if (result.error.code === "P0002") return respond(404, { error: "Jakinarazpena ez dago erabilgarri" });
    if (result.error.code === "22023") return respond(400, { error: "Datuak ez dira baliozkoak" });
    return respond(500, { error: "Ezin izan dira jakinarazpenak kargatu" });
  }
  return respond(200, { ok: true, ...result.data });
}
