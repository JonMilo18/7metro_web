type Row = Record<string, unknown>;
type LoadExercises = (ids: number[]) => Promise<{ data: Row[]; error: string | null }>;

// The snapshot caller has already authenticated membership and loaded this team's sessions.
export async function addSessionExerciseReferences(
  tables: Record<string, Row[]>, loadExercises: LoadExercises,
): Promise<string | null> {
  const sessionIds = new Set((tables.saioak || []).map(row => Number(row.id_saio)));
  const details = (tables.saio_xehetasuna || []).filter(row => sessionIds.has(Number(row.id_saio)));
  const exerciseIds = [...new Set(details.map(row => Number(row.id_ariketa))
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  const result = await loadExercises(exerciseIds);
  if (result.error) return result.error;
  const requested = new Set(exerciseIds);
  tables.saio_reference_ariketak = result.data.filter(row => requested.has(Number(row.id_ariketa)));
  const available = new Set(tables.saio_reference_ariketak.map(row => Number(row.id_ariketa)));
  tables.saio_xehetasuna = details.filter(row => row.id_ariketa == null || available.has(Number(row.id_ariketa)));
  return null;
}
