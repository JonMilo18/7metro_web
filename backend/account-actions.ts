import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const accountActions = new Set(["account_get", "account_update", "account_delete_preview", "account_delete"]);

export async function handleAccountAction(
  payload: Record<string, unknown>, supabase: SupabaseClient, userId: number, sessionToken: string,
  respond: (status: number, body: unknown) => Response,
): Promise<Response> {
  if (payload.action === "account_get") {
    const { data, error } = await supabase.from("erabiltzaileak")
      .select("id_erabiltzailea,izena").eq("id_erabiltzailea", userId).maybeSingle();
    if (error || !data) return respond(500, { error: "Ezin izan dira kontuaren datuak kargatu" });
    return respond(200, { ok: true, user: data });
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionToken));
  const sessionHash = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (payload.action === "account_delete_preview" || payload.action === "account_delete") {
    if (payload.action === "account_delete" && (
      typeof payload.current_password !== "string" || !payload.current_password || payload.current_password.length > 1024 ||
      typeof payload.confirmation !== "string" || payload.confirmation.length > 200 ||
      !payload.preview || typeof payload.preview !== "object" || Array.isArray(payload.preview))) {
      return respond(400, { error: "Kontuaren datuak ez dira baliozkoak" });
    }
    const { data, error } = await supabase.rpc("account_deletion_action", {
      p_user_id: userId, p_session_hash: sessionHash, p_action: payload.action,
      p_payload: { current_password: payload.current_password, confirmation: payload.confirmation, preview: payload.preview },
    });
    if (error) {
      const messages: Record<string, [number, string]> = {
        "42501": [401, "Saioa iraungi da; hasi berriro"],
        "28000": [403, "Oraingo pasahitza ez da zuzena"],
        "22023": [400, "Baieztatzeko, idatzi zure erabiltzaile-izena"],
        "40001": [409, "Taldeen egoera aldatu da. Itxi eta ireki berriro kontua ezabatzeko aukera"],
      };
      const failure: [number, string] = messages[error.code] || [500, "Ezin izan da kontua ezabatu"];
      return respond(failure[0], { error: failure[1] });
    }
    return respond(200, data);
  }
  if (payload.action !== "account_update") return respond(400, { error: "Ekintza ez da baliozkoa" });
  const username = typeof payload.username === "string" ? payload.username.trim().toLowerCase() : "";
  const currentPassword = payload.current_password;
  const password = payload.new_password == null ? null : payload.new_password;
  if (username.length < 3 || username.length > 200 ||
    typeof currentPassword !== "string" || !currentPassword || currentPassword.length > 1024 ||
    typeof payload.expected_username !== "string" || payload.expected_username.length > 200 ||
    (password !== null && (typeof password !== "string" || password.length < 8))) {
    return respond(400, { error: "Kontuaren datuak ez dira baliozkoak" });
  }
  if (typeof password === "string" && new TextEncoder().encode(password).length > 72) {
    return respond(400, { error: "Pasahitz berria luzeegia da. Erabili pasahitz laburragoa" });
  }
  const { data, error } = await supabase.rpc("update_account_credentials", {
    p_user_id: userId, p_session_hash: sessionHash, p_current_password: currentPassword,
    p_expected_username: payload.expected_username, p_username: username, p_new_password: password,
  });
  if (error) {
    const messages: Record<string, [number, string]> = {
      "42501": [401, "Saioa iraungi da; hasi berriro"],
      "28000": [403, "Oraingo pasahitza ez da zuzena"],
      "23505": [409, "Erabiltzaile-izen hori erabilita dago"],
      "40001": [409, "Kontua beste gailu batean aldatu da. Itxi eta ireki berriro kontuaren ezarpenak"],
      "22023": [400, "Kontuaren datuak ez dira baliozkoak"],
    };
    const failure: [number, string] = messages[error.code] || [500, "Ezin izan dira kontuaren aldaketak gorde"];
    return respond(failure[0], { error: failure[1] });
  }
  return respond(200, data);
}
