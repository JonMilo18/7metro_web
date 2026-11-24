export const exerciseEditActions = new Set(["pwa_get_exercise", "pwa_update_exercise"]);
export async function handleExerciseEdit(payload: Record<string, any>, supabase: any, userId: number, respond: any) {
  const teamId = Number(payload.team_id), id = Number(payload.id), update = payload.action === "pwa_update_exercise";
  if (!exerciseEditActions.has(payload.action) || !Number.isSafeInteger(teamId) || teamId < 1 || !Number.isSafeInteger(id) || id < 1) return respond(400, { error: "Ariketa edo taldea ez da baliozkoa" });
  let data = null;
  if (update) {
    const name = typeof payload.izena === "string" ? payload.izena.trim() : "";
    const count = payload.jokalari_kopurua == null ? null : Number(payload.jokalari_kopurua);
    const categories = payload.kategoriak;
    if (!name || name.length > 140 || (count !== null && (!Number.isInteger(count) || count < 1 || count > 100)) ||
        !Array.isArray(categories) || categories.length > 100 || categories.some(n => typeof n !== "string" || !n.trim() || n.length > 80) ||
        (payload.deskribapena != null && typeof payload.deskribapena !== "string") || (payload.bideo_url != null && typeof payload.bideo_url !== "string") ||
        !payload.snapshot || typeof payload.snapshot !== "object" || !payload.snapshot.exercise || !Array.isArray(payload.snapshot.categories)) return respond(400, { error: "Ariketaren datuak ez dira baliozkoak" });
    const board = payload.arbela_datuak;
    if (board != null && typeof board !== "string") return respond(400, { error: "Arbelaren datuak ez dira baliozkoak" });
    // Untouched legacy boards may use an old format; metadata edits preserve their exact bytes.
    if (board && board !== payload.snapshot.exercise.arbela_datuak) {
      if (board.length > 200_000) return respond(400, { error: "Arbelaren datuak handiegiak dira" });
      try { const parsed = JSON.parse(board); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); }
      catch { return respond(400, { error: "Arbelaren datuak ez dira baliozkoak" }); }
    }
    data = { izena: name, deskribapena: payload.deskribapena || null, jokalari_kopurua: count,
      bideo_url: payload.bideo_url || null, arbela_datuak: board || null, categories };
  }
  const { data: result, error } = await supabase.rpc("edit_owned_exercise", { p_user_id: userId, p_team_id: teamId, p_action: update ? "update" : "get", p_id: id, p_data: data, p_expected: update ? payload.snapshot : null });
  if (error) {
    const status = ({ "42501": 403, "P0002": 404, "PT409": 409, "22023": 400 } as Record<string, number>)[error.code];
    return respond(status || 500, { error: status ? error.message : "Ezin izan da ariketa eguneratu" });
  }
  return respond(200, result);
}
