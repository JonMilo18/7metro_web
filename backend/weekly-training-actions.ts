import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const weeklyTrainingActions = new Set([
  "weekly_training_get", "weekly_training_save", "weekly_training_publish",
]);

export async function handleWeeklyTrainingAction(
  payload: Record<string, unknown>, supabase: SupabaseClient, userId: number,
  respond: (status: number, body: unknown) => Response,
): Promise<Response> {
  const teamId = Number(payload.team_id);
  if (!weeklyTrainingActions.has(String(payload.action)) || !Number.isSafeInteger(teamId) || teamId < 1 ||
      JSON.stringify(payload).length > 25000) {
    return respond(400, { error: "Datuak ez dira baliozkoak" });
  }
  const result = await supabase.rpc("weekly_training_action", {
    p_user: userId, p_team: teamId, p_action: String(payload.action).slice("weekly_training_".length),
    p_data: { week_start: payload.week_start, version: payload.version, slots: payload.slots },
  });
  if (result.error) {
    const messages = ["Ez zara talde horretako kidea", "Datuak ez dira baliozkoak", "Aukeratu aste bat",
      "Ordutegia beste gailu batean aldatu da. Birkargatu ordutegia", "Ordutegiaren datuak ez dira baliozkoak",
      "Gehienez 28 entrenamendu sar daitezke astean", "Egun eta ordu bereko entrenamendua errepikatuta dago",
      "Gorde ohiko ordutegia lehenik"];
    const code = result.error.code;
    const status = code === "42501" ? 403 : code === "40001" ? 409 : code === "22023" ? 400 : 500;
    return respond(status, { error: messages.includes(result.error.message) ? result.error.message : "Ezin izan da asteko ordutegia gorde edo argitaratu" });
  }
  return respond(200, { ok: true, ...result.data });
}
