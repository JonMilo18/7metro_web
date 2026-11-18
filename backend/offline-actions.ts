import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type Respond = (status: number, body: unknown) => Response;

export async function offlineOperation(
  payload: Record<string, unknown>, supabase: SupabaseClient, teamId: number,
  userId: number, respond: Respond, normalized?: Record<string, unknown>,
): Promise<Response | null> {
  if (payload.operation_id === undefined) return null;
  if (typeof payload.operation_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.operation_id)) {
    return respond(400, { error: "Gordetzearen identifikatzailea ez da baliozkoa" });
  }
  const { data, error } = await supabase.rpc(normalized ? "commit_offline_operation" : "read_offline_operation", {
    p_user_id: userId, p_team_id: teamId, p_operation_id: payload.operation_id,
    p_request: payload, ...(normalized ? { p_data: normalized } : {}),
  });
  if (error) {
    const status = ({ "42501": 403, "P0002": 404, "40001": 409, "PT409": 409, "22023": 400 } as Record<string, number>)[error.code];
    return respond(status || 500, { error: status ? error.message : "Ezin izan dira gordetzeko datuak sinkronizatu" });
  }
  if (data) return respond(200, data);
  return normalized ? respond(500, { error: "Ezin izan dira gordetzeko datuak sinkronizatu" }) : null;
}
