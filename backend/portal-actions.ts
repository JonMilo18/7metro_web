import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const portalActions = new Set([
  "portal_bootstrap", "portal_invite_answer", "portal_coach_snapshot", "portal_invite", "portal_revoke",
  "portal_publish_callup", "portal_create_notice", "portal_delete_notice", "portal_player_snapshot", "portal_respond", "portal_read_notice",
  "portal_apply_attendance",
]);

// The caller supplies the authenticated account ID, never an ID from the request body.
export async function handlePortalAction(payload: Record<string, unknown>, supabase: SupabaseClient, userId: number,
  respond: (status: number, body: unknown) => Response): Promise<Response> {
  const action = String(payload.action);
  if (!portalActions.has(action)) return respond(400, { error: "Ekintza ez da baliozkoa" });
  if (JSON.stringify(payload).length > 16000 || (action === "portal_invite_answer" && typeof payload.accept !== "boolean")) {
    return respond(400, { error: "Datuak ez dira baliozkoak" });
  }
  const importing = action === "portal_apply_attendance";
  if (importing && (!Number.isSafeInteger(payload.team_id) || Number(payload.team_id) <= 0 ||
    !Number.isSafeInteger(payload.session_id) || Number(payload.session_id) <= 0)) return respond(400, { error: "Datuak ez dira baliozkoak" });
  const { data, error } = importing
    ? await supabase.rpc("apply_session_response_attendance", { p_team_id: payload.team_id, p_user_id: userId, p_session_id: payload.session_id })
    : await supabase.rpc("player_portal_action", { p_user_id: userId, p_action: action, p_payload: payload });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "23505" ? 409 :
      ["22023", "22P02", "23514", "23502", "22001", "22007", "22008", "22003"].includes(error.code || "") ? 400 : 500;
    const safeMessages = ["Saioa iraungi da; hasi berriro", "Gonbidapena ez dago erabilgarri", "Ez zara talde horretako kidea",
      "Ez da taldeko jokalaria aurkitu", "Jokalariak kontua lotuta dauka jada", "Jokalariak kontua sortu behar du lehenik",
      "Ez da taldeko partida aurkitu", "Deialdiko jokalariak ez dira baliozkoak", "Deialdiko jokalariak ez dira taldekoak",
      "Data ez da baliozkoa", "Ez duzu jokalari honen baimenik", "Jarduera ez da baliozkoa", "Jarduera ez dago erabilgarri", "Abisua ez dago erabilgarri", "Ez da taldeko entrenamendua aurkitu"];
    return respond(status, { error: safeMessages.includes(error.message) ? error.message :
      status === 409 ? "Kontu hori taldeko beste jokalari bati lotuta dago jada" : status === 400 ? "Datuak ez dira baliozkoak" : "Ezin izan da jokalarien aplikazioko ekintza burutu" });
  }
  return respond(200, data);
}
