export const sessionTemplateActions = new Set(["session_template_list", "session_template_get", "session_template_save", "session_template_delete"]);

export async function handleSessionTemplateAction(payload: Record<string, any>, supabase: any, userId: number, respond: any) {
  const teamId = Number(payload.team_id), create = payload.action === "pwa_create_session";
  const action = create ? "create" : String(payload.action).replace("session_template_", "");
  const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (!Number.isSafeInteger(teamId) || teamId < 1 || !["list", "get", "save", "delete", "create"].includes(action) ||
      (action !== "list" && !uuid(payload.template_id)) || (create && !uuid(payload.operation_id))) {
    return respond(400, { error: "Txantiloia edo taldea ez da baliozkoa" });
  }
  let normalized = null;
  if (action === "save" || create) {
    const source = create ? payload : payload.session;
    const raw = payload.exercises;
    if (!source || typeof source !== "object" || Array.isArray(source) || !Array.isArray(raw) || raw.length > 1000 ||
        typeof source.lekua !== "string" || source.lekua.length > 250 || typeof source.helburu_taktikoa !== "string" || source.helburu_taktikoa.length > 250 ||
        (action === "save" && (typeof payload.name !== "string" || !payload.name.trim() || payload.name.trim().length > 120 || !Number.isInteger(payload.total_minutes) || payload.total_minutes < 0 || payload.total_minutes > 999)) ||
        (create && (typeof source.data_ordua !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(source.data_ordua) || !Number.isFinite(Date.parse(source.data_ordua))))) {
      return respond(400, { error: "Txantiloiaren datuak ez dira baliozkoak" });
    }
    const details = [];
    for (const row of raw) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return respond(400, { error: "Ariketa-zerrenda ez da baliozkoa" });
      const separator = row.is_separator === true, id = separator ? null : Number(row.id_ariketa), minutes = separator ? 0 : Number(row.iraupena_minutuak);
      if ((!separator && (!Number.isSafeInteger(id) || Number(id) < 1)) || !Number.isInteger(minutes) || minutes < 0 || minutes > 999 ||
          (row.taldea != null && (typeof row.taldea !== "string" || row.taldea.length > 60)) || (separator && !row.taldea?.trim()) ||
          (row.aldaerak != null && (typeof row.aldaerak !== "string" || row.aldaerak.length > 3000)) ||
          (row.paraleloa != null && ![0, 1, true, false].includes(row.paraleloa))) return respond(400, { error: "Ariketa-zerrenda ez da baliozkoa" });
      details.push({ id_ariketa: id, iraupena_minutuak: minutes, taldea: row.taldea || null, aldaerak: row.aldaerak || null, paraleloa: row.paraleloa ? 1 : 0 });
    }
    const micro = source.id_mikroziklo == null ? null : Number(source.id_mikroziklo);
    if (create && micro !== null && (!Number.isSafeInteger(micro) || micro < 1)) return respond(400, { error: "Mikrozikloa ez da baliozkoa" });
    normalized = { session: { lekua: source.lekua, helburu_taktikoa: source.helburu_taktikoa,
      ...(create ? { data_ordua: source.data_ordua, id_mikroziklo: micro } : {}) }, details,
      ...(create ? {} : { name: payload.name.trim(), total_minutes: payload.total_minutes }) };
  }
  const { data, error } = await supabase.rpc("session_template_action", { p_user_id: userId, p_team_id: teamId, p_action: action, p_payload: payload, p_data: normalized });
  if (error) {
    const status = ({ "42501": 403, "P0002": 404, "PT409": 409, "22023": 400, "22P02": 400 } as Record<string, number>)[error.code];
    return respond(status || 500, { error: status ? error.message : "Ezin izan da entrenamenduaren txantiloia kudeatu" });
  }
  return respond(create || action === "save" ? 201 : 200, data);
}
