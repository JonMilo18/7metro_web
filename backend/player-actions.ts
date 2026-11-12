import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// metro-api verifies the session and team membership before calling this handler.
export async function updatePlayer(
  payload: Record<string, unknown>, supabase: SupabaseClient, teamId: number,
  respond: (status: number, body: unknown) => Response,
): Promise<Response> {
  const id = Number(payload.id);
  const fields = ["izena", "abizena", "dortsala", "posizioa", "egoera", "jaiotze_data", "altuera_cm", "pisua_kg", "eskua", "telefonoa", "emaila", "oharrak"];
  const expected = payload.expected as Record<string, unknown>;
  if (!Number.isSafeInteger(id) || id < 1 || !expected || typeof expected !== "object" || Array.isArray(expected) ||
      fields.some((key) => !(key in expected) || (expected[key] !== null && !["string", "number"].includes(typeof expected[key])))) {
    return respond(400, { error: "Jokalariaren datuak ez dira baliozkoak" });
  }
  const row: Record<string, unknown> = {};
  for (const key of fields) {
    const value = payload[key];
    if (["dortsala", "altuera_cm", "pisua_kg"].includes(key)) {
      if (value !== null && !["string", "number"].includes(typeof value)) return respond(400, { error: "Jokalariaren zenbakizko datuak ez dira baliozkoak" });
      const number = value === null || value === "" ? null : Number(value);
      const min = key === "dortsala" ? 0 : key === "altuera_cm" ? 100 : 20;
      const max = key === "dortsala" ? 999 : 250;
      if (number !== null && (!Number.isFinite(number) || number < min || number > max || (key !== "pisua_kg" && !Number.isInteger(number)))) {
        return respond(400, { error: "Jokalariaren zenbakizko datuak ez dira baliozkoak" });
      }
      row[key] = number;
    } else {
      if (value !== null && typeof value !== "string") return respond(400, { error: "Jokalariaren datuak ez dira baliozkoak" });
      const text = String(value || "").trim();
      if (text.length > (key === "oharrak" ? 10000 : ["izena", "abizena"].includes(key) ? 100 : 200)) return respond(400, { error: "Jokalariaren datuak ez dira baliozkoak" });
      row[key] = text || null;
    }
  }
  if (!row.izena) return respond(400, { error: "Jokalariaren izena beharrezkoa da" });
  const date = row.jaiotze_data;
  if (date && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
    return respond(400, { error: "Jaiotze-data ez da baliozkoa" });
  }
  let query = supabase.from("jokalariak").update(row).eq("id_jokalaria", id).eq("id_taldea", teamId);
  for (const key of fields) query = expected[key] === null ? query.is(key, null) : query.eq(key, expected[key]);
  const { data, error } = await query.select("id_jokalaria").maybeSingle();
  if (error) return respond(500, { error: "Ezin izan dira jokalariaren aldaketak gorde" });
  if (!data) return respond(409, { error: "Jokalariaren datuak aldatu dira edo ez dago taldean. Birkargatu berriro editatu aurretik" });
  return respond(200, { ok: true, id: data.id_jokalaria, player: { ...row, id_jokalaria: data.id_jokalaria } });
}
