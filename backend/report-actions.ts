import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// metro-api authenticates the session and checks membership before invoking this action.
export async function saveMatchReportNotes(
  payload: Record<string, unknown>, supabase: SupabaseClient, teamId: number,
  jsonResponse: (status: number, body: unknown) => Response,
): Promise<Response> {
  const id = Number(payload.id);
  if (!Number.isSafeInteger(id) || id < 1 || typeof payload.notes !== "string" || payload.notes.length > 10000 ||
    !("expected_notes" in payload) || (payload.expected_notes !== null && typeof payload.expected_notes !== "string")) {
    return jsonResponse(400, { error: "Partidaren oharrak ez dira baliozkoak" });
  }
  let query = supabase.from("partidak").update({ partida_analisia: payload.notes || null })
    .eq("id_partida", id).eq("id_taldea", teamId);
  query = payload.expected_notes === null ? query.is("partida_analisia", null) : query.eq("partida_analisia", payload.expected_notes);
  const { data, error } = await query.select("id_partida,partida_analisia").maybeSingle();
  if (error) return jsonResponse(500, { error: "Ezin izan dira partidaren oharrak gorde" });
  if (!data) {
    const result = await supabase.from("partidak").select("id_partida").eq("id_partida", id).eq("id_taldea", teamId).maybeSingle();
    if (result.error) return jsonResponse(500, { error: "Ezin izan da partida egiaztatu" });
    return jsonResponse(result.data ? 409 : 404, { error: result.data ?
      "Partidaren oharrak beste gailu batean aldatu dira. Birkargatu txostena berriro gorde aurretik" : "Ez da taldeko partida aurkitu" });
  }
  return jsonResponse(200, { ok: true, id: data.id_partida, notes: data.partida_analisia });
}
