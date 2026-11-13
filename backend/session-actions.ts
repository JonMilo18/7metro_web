import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type JsonResponse = (status: number, body: unknown) => Response;

// Called by metro-api only after session authentication and team membership checks.
export async function handleSessionAction(
  payload: Record<string, unknown>, supabase: SupabaseClient,
  teamId: number, userId: number, jsonResponse: JsonResponse,
): Promise<Response> {
  const duplicate = payload.action === "pwa_duplicate_session";
  const sourceId = Number(duplicate ? payload.source_id : payload.id);
  if (!Number.isSafeInteger(sourceId) || sourceId < 1) {
    return jsonResponse(400, { error: "Entrenamendua ez da baliozkoa" });
  }

  if (payload.action === "pwa_delete_session") {
    const { error } = await supabase.rpc("delete_team_session", {
      p_team_id: teamId, p_user_id: userId, p_session_id: sourceId,
    });
    if (error) {
      const status = ({ "42501": 403, "P0002": 404 } as Record<string, number>)[error.code];
      return jsonResponse(status || 500, { error: status ? error.message : "Ezin izan da entrenamendua ezabatu" });
    }
    return jsonResponse(200, { ok: true });
  }

  if (payload.action === "pwa_get_session") {
    const { data: session, error: sessionError } = await supabase.from("saioak")
      .select("*").eq("id_saio", sourceId).eq("id_taldea", teamId).maybeSingle();
    if (sessionError) return jsonResponse(500, { error: "Ezin izan da entrenamendua kargatu" });
    if (!session) return jsonResponse(404, { error: "Ez da taldeko entrenamendua aurkitu" });
    const { data: rows, error: detailsError } = await supabase.from("saio_xehetasuna")
      .select("*").eq("id_saio", sourceId)
      .order("ordena", { ascending: true, nullsFirst: false }).order("id_xehetasuna", { ascending: true });
    if (detailsError) return jsonResponse(500, { error: "Ezin izan dira entrenamenduko ariketak kargatu" });
    const details = rows || [];
    const ids = [...new Set(details.filter((row) => row.id_ariketa != null).map((row) => Number(row.id_ariketa)))];
    let exercises: Record<string, unknown>[] = [];
    if (ids.length) {
      // Team members may read exercises already linked to this particular training.
      const result = await supabase.from("ariketak").select("*").in("id_ariketa", ids);
      if (result.error || (result.data || []).length !== ids.length) {
        return jsonResponse(500, { error: "Ezin izan dira entrenamenduko ariketak kargatu" });
      }
      exercises = result.data || [];
    }
    return jsonResponse(200, { ok: true, session, details, exercises, snapshot: { session, details } });
  }

  const date = typeof payload.data_ordua === "string" ? payload.data_ordua : "";
  const place = typeof payload.lekua === "string" ? payload.lekua : "";
  const goal = typeof payload.helburu_taktikoa === "string" ? payload.helburu_taktikoa : "";
  const micro = payload.id_mikroziklo == null ? null : Number(payload.id_mikroziklo);
  const raw = payload.exercises;
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(date) || !Number.isFinite(Date.parse(date)) ||
    place.length > 250 || goal.length > 250 ||
    (micro !== null && (!Number.isSafeInteger(micro) || micro < 1)) ||
    !Array.isArray(raw) || raw.length > 1000) {
    return jsonResponse(400, { error: "Entrenamenduaren data edo ariketa-zerrenda ez da baliozkoa" });
  }
  const details: Record<string, unknown>[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return jsonResponse(400, { error: "Entrenamenduaren data edo ariketa-zerrenda ez da baliozkoa" });
    }
    const item = entry as Record<string, unknown>;
    const separator = item.is_separator === true;
    const id = separator ? null : Number(item.id_ariketa);
    const minutes = separator ? 0 : Number(item.iraupena_minutuak);
    const group = item.taldea == null ? null : String(item.taldea);
    const notes = item.aldaerak == null ? null : String(item.aldaerak);
    if ((!separator && (!Number.isSafeInteger(id) || Number(id) < 1)) ||
      !Number.isInteger(minutes) || minutes < 0 || minutes > 999 ||
      (group !== null && group.length > 60) || (notes !== null && notes.length > 3000) ||
      (separator && !group?.trim()) ||
      (item.paraleloa != null && item.paraleloa !== 0 && item.paraleloa !== 1 && typeof item.paraleloa !== "boolean")) {
      return jsonResponse(400, { error: "Entrenamenduaren data edo ariketa-zerrenda ez da baliozkoa" });
    }
    details.push({ id_ariketa: id, iraupena_minutuak: minutes,
      taldea: group, aldaerak: notes, paraleloa: item.paraleloa ? 1 : 0 });
  }
  const snapshot = payload.snapshot as Record<string, unknown> | null;
  if (!snapshot || typeof snapshot !== "object" || !snapshot.session || !Array.isArray(snapshot.details)) {
    return jsonResponse(400, { error: "Birkargatu entrenamendua aldaketak gorde aurretik" });
  }
  const { data, error } = await supabase.rpc("save_team_session", {
    p_team_id: teamId, p_user_id: userId, p_source_id: sourceId, p_duplicate: duplicate,
    p_session: { data_ordua: date, lekua: place, helburu_taktikoa: goal || null, id_mikroziklo: micro },
    p_details: details, p_expected: snapshot,
  });
  if (error) {
    const status = ({ "42501": 403, "P0002": 404, "40001": 409, "22023": 400 } as Record<string, number>)[error.code];
    return jsonResponse(status || 500, { error: status ? error.message :
      duplicate ? "Ezin izan da entrenamendua bikoiztu" : "Ezin izan da entrenamendua eguneratu" });
  }
  return jsonResponse(duplicate ? 201 : 200, { ok: true, ...data });
}
