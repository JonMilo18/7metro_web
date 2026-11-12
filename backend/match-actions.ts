import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function updateMatch(payload: Record<string, unknown>, supabase: SupabaseClient, teamId: number,
  jsonResponse: (status: number, body: unknown) => Response): Promise<Response> {
const id = Number(payload.id);
const venue = payload.lekua;
if (venue !== undefined && venue !== "Etxean" && venue !== "Kanpoan") {
  return jsonResponse(400, { error: "Tokia ez da baliozkoa" });
}
const stats = Array.isArray(payload.stats) ? payload.stats : null;
if (!Number.isSafeInteger(id) || id < 1) return jsonResponse(400, { error: "Partida ez da baliozkoa" });
if (!stats || stats.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
  return jsonResponse(400, { error: "Jokalarien estatistikak ez dira baliozkoak" });
}
const playerIds = stats.map((item) => Number((item as Record<string, unknown>).id_jokalaria));
if (playerIds.some((playerId) => !Number.isSafeInteger(playerId) || playerId < 1) ||
  new Set(playerIds).size !== playerIds.length) {
  return jsonResponse(400, { error: "Jokalariaren identifikatzailea ez da baliozkoa" });
}
if (stats.some((item) => typeof (item as Record<string, unknown>).jokatu !== "boolean")) {
  return jsonResponse(400, { error: "Jokalariaren partaidetza adierazi behar da" });
}
const ownScore = Number(payload.emaitza_geurea), opponentScore = Number(payload.emaitza_aurkaria);
if ([ownScore, opponentScore].some((value) => !Number.isInteger(value) || value < 0 || value > 999)) {
  return jsonResponse(400, { error: "Emaitza ez da baliozkoa" });
}
if (playerIds.length) {
  const { data: teamPlayers, error: playerError } = await supabase.from("jokalariak")
    .select("id_jokalaria").eq("id_taldea", teamId).in("id_jokalaria", playerIds);
  if (playerError) return jsonResponse(500, { error: "Ezin izan dira jokalariak egiaztatu" });
  if ((teamPlayers ?? []).length !== playerIds.length) {
    return jsonResponse(404, { error: "Jokalari bat ez da taldekoa" });
  }
}
const { data: existingMatch, error: existingMatchError } = await supabase.from("partidak")
  .select("id_partida").eq("id_partida", id).eq("id_taldea", teamId).maybeSingle();
if (existingMatchError) return jsonResponse(500, { error: "Ezin izan da partida egiaztatu" });
if (!existingMatch) return jsonResponse(404, { error: "Ez da taldeko partida aurkitu" });

const sanctionTypes = [["horia", "horia"], ["two_min", "2min"], ["gorria", "gorria"], ["urdina", "urdina"]] as const;
const playerRows: Array<{ id_jokalaria: number; golak: number; jaurtiketak: number }> = [];
const unplayedPlayerIds: number[] = [];
const sanctions: Array<{ id_jokalaria: number; mota: string }> = [];
let statsError: string | null = null;
for (const item of stats) {
  const stat = item as Record<string, unknown>;
  const playerId = Number(stat.id_jokalaria);
  const played = stat.jokatu === true;
  const goals = stat.golak == null ? 0 : Number(stat.golak);
  const shots = stat.jaurtiketak == null ? 0 : Number(stat.jaurtiketak);
  if ([goals, shots].some((value) => !Number.isInteger(value) || value < 0 || value > 999)) {
    statsError = "Gol edo jaurtiketa kopurua ez da baliozkoa";
  }
  if (played) playerRows.push({
    id_jokalaria: playerId, golak: goals, jaurtiketak: Math.max(shots, goals),
  });
  else unplayedPlayerIds.push(playerId);
  for (const [field, type] of sanctionTypes) {
    const count = stat[field] == null ? 0 : Number(stat[field]);
    if (!Number.isInteger(count) || count < 0 || count > 100) {
      statsError = "Zigor kopurua 0 eta 100 artean egon behar da";
      continue;
    }
    if (played) {
      for (let index = 0; index < count; index++) sanctions.push({ id_jokalaria: playerId, mota: type });
    }
  }
}
if (statsError) return jsonResponse(400, { error: statsError });

const { error: matchUpdateError } = await supabase.from("partidak").update({
  emaitza_geurea: ownScore, emaitza_aurkaria: opponentScore,
  ...(venue === undefined ? {} : { lekua: venue }),
}).eq("id_partida", id).eq("id_taldea", teamId);
if (matchUpdateError) return jsonResponse(500, { error: "Ezin izan da partidaren emaitza eguneratu" });

if (playerRows.length) {
  const { error } = await supabase.from("partida_jokalariak").upsert(
    playerRows.map((row) => ({ ...row, id_partida: id })),
    { onConflict: "id_partida,id_jokalaria" },
  );
  if (error) return jsonResponse(500, { error: "Emaitza eguneratu da, baina jokalarien estatistikak ezin izan dira gorde" });
}
if (unplayedPlayerIds.length) {
  const { error } = await supabase.from("partida_jokalariak").delete()
    .eq("id_partida", id).in("id_jokalaria", unplayedPlayerIds);
  if (error) return jsonResponse(500, { error: "Emaitza eguneratu da, baina jokalarien estatistikak ezin izan dira ezabatu" });
}

const { error: deleteSanctionsError } = await supabase.from("partidu_zigorrak")
  .delete().eq("id_partida", id);
if (deleteSanctionsError) {
  return jsonResponse(500, { error: "Emaitza eguneratu da, baina aurreko zigorrak ezin izan dira eguneratu" });
}
if (sanctions.length) {
  const { error } = await supabase.from("partidu_zigorrak")
    .insert(sanctions.map((row) => ({ ...row, id_partida: id, minutua: 0 })));
  if (error) {
    return jsonResponse(500, { error: "Emaitza eta jokalarien estatistikak eguneratu dira, baina zigorrak ezin izan dira gorde" });
  }
}
return jsonResponse(200, { ok: true, id });
}
