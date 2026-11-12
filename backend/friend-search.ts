import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Invoked only after metro-api has authenticated the session.
export async function searchFriendUsers(
  payload: Record<string, unknown>, supabase: SupabaseClient, userId: number,
  jsonResponse: (status: number, body: unknown) => Response,
): Promise<Response> {
  if (typeof payload.query !== "string" || payload.query.trim().length > 200) {
    return jsonResponse(400, { error: "Bilaketa ez da baliozkoa" });
  }
  const query = payload.query.trim();
  if (!query) return jsonResponse(200, { ok: true, users: [] });
  const pattern = "%" + query.replace(/[\\%_]/g, "\\$&") + "%";
  const { data, error } = await supabase.from("erabiltzaileak")
    .select("id_erabiltzailea,izena").neq("id_erabiltzailea", userId)
    .ilike("izena", pattern).order("izena", { ascending: true }).limit(8);
  if (error) return jsonResponse(500, { error: "Ezin izan dira erabiltzaileak bilatu" });
  return jsonResponse(200, { ok: true, users: (data || []).map((row) => ({ username: row.izena })) });
}
