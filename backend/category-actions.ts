// Local desktop IDs are not global IDs: resolve names before uploading references.
export async function reconcileCategorySync(supabase: any, input: Record<string, any>, userId?: number): Promise<Record<string, any>> {
  const tables = structuredClone(input);
  const categories = tables.kategoriak || [];
  const ids = new Map<string, number>();
  const localIds = new Set<string>();
  const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const category of categories) {
    if (!Number.isSafeInteger(Number(category.id_kategoria)) || Number(category.id_kategoria) < 1 ||
        typeof category.izena !== "string" || !category.izena.trim() || category.izena.length > 80 || localIds.has(String(category.id_kategoria))) {
      throw new Error("Kategoriaren tokiko identifikatzailea edo izena ez da baliozkoa");
    }
    localIds.add(String(category.id_kategoria));
  }
  for (let offset = 0; offset < categories.length; offset += 100) {
    const batch = categories.slice(offset, offset + 100);
    const { data, error } = await supabase.rpc(userId ? "resolve_user_category_names" : "resolve_category_names", { p_names: batch.map((row: any) => row.izena), ...(userId ? { p_user_id: userId, p_register: false } : { p_create: true }) });
    if (error || !Array.isArray(data)) throw new Error("Ezin izan da kategoria bateratu");
    const byName = new Map(data.map((row: any) => [nameKey(row.izena), Number(row.id_kategoria)]));
    for (const category of batch) {
      const id = byName.get(nameKey(category.izena));
      if (!id) throw new Error("Ezin izan da kategoria bateratu");
      ids.set(String(category.id_kategoria), id);
    }
  }
  const canonical = (value: any) => {
    if (value == null || value === "") return value;
    if (categories.length && !ids.has(String(value))) throw new Error("Kategoriaren tokiko erreferentzia falta da");
    return ids.get(String(value)) ?? value;
  };
  for (const exercise of tables.ariketak || []) {
    if (exercise.id_kategoria != null) exercise.id_kategoria = canonical(exercise.id_kategoria);
    if (typeof exercise.kategoria === "string" && /^\d+$/.test(exercise.kategoria.trim())) {
      exercise.id_kategoria = canonical(exercise.kategoria.trim());
      exercise.kategoria = null;
    }
  }
  const seen = new Set();
  tables.kategoriak_has_ariketak = (tables.kategoriak_has_ariketak || []).filter((link: any) => {
    link.kategoriak_id_kategoria = canonical(link.kategoriak_id_kategoria);
    const key = `${link.ariketak_id_ariketa}:${link.kategoriak_id_kategoria}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  delete tables.kategoriak;
  return tables;
}
