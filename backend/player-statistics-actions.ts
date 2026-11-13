import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import "../insights-data.js";

export const playerStatisticsActions = new Set([
  "player_stats_settings", "player_stats_save_settings", "player_stats_status", "player_stats_get",
]);

type PersonalStats = { goals: number; shots: number; efficiency: number | null; penaltyGoals: number;
  penaltyShots: number; sanctions: Record<string, number> };
type Profile = { player: Record<string, unknown>; totals: PersonalStats;
  history: { match: Record<string, unknown>; stats: PersonalStats }[];
  attendanceCount: number; present: number; absent: number; attendanceRate: number | null; late: number;
  attendance: { session: Record<string, unknown>; recorded: boolean; present: boolean | null; late: number }[] };
const model = (globalThis as unknown as { SevenMetroInsights: {
  profile: (id: number, tables: Record<string, unknown[]>, period: string, now: Date) => Profile | null;
} }).SevenMetroInsights;

function personalStats(stats: PersonalStats) {
  return { goals: stats.goals, shots: stats.shots, efficiency: stats.efficiency,
    penaltyGoals: stats.penaltyGoals, penaltyShots: stats.penaltyShots, sanctions: stats.sanctions };
}

export async function handlePlayerStatisticsAction(payload: Record<string, unknown>, supabase: SupabaseClient,
  userId: number, respond: (status: number, body: unknown) => Response): Promise<Response> {
  const action = String(payload.action);
  const coach = action === "player_stats_settings" || action === "player_stats_save_settings";
  const id = Number(coach ? payload.team_id : payload.player_id);
  if (!playerStatisticsActions.has(action) || !Number.isSafeInteger(id) || id < 1 ||
    JSON.stringify(payload).length > 1200 ||
    (action === "player_stats_save_settings" && (typeof payload.enabled !== "boolean" || !Number.isSafeInteger(payload.version))) ||
    (payload.period !== undefined && !["all", "season", "month", "3months"].includes(String(payload.period)))) {
    return respond(400, { error: "Datuak ez dira baliozkoak" });
  }
  const result = await supabase.rpc("player_statistics_action", {
    p_user: userId, p_action: action.slice("player_stats_".length), p_data: {
      team_id: coach ? id : undefined, player_id: coach ? undefined : id,
      enabled: payload.enabled, version: payload.version, period: payload.period || "all",
    },
  });
  if (result.error) {
    const messages = ["Ez zara talde horretako kidea", "Ez duzu jokalari honen baimenik",
      "Entrenatzaileak estatistikak desaktibatuta ditu", "Baimena beste gailu batean aldatu da. Birkargatu"];
    const status = result.error.code === "42501" ? 403 : result.error.code === "40001" ? 409 : result.error.code === "22023" ? 400 : 500;
    return respond(status, { error: messages.includes(result.error.message) ? result.error.message : "Ezin izan dira estatistikak kargatu" });
  }
  if (action !== "player_stats_get") return respond(200, { ok: true, ...result.data });
  // Never return raw matches, event JSON, teammate rows or private profile fields.
  const profile = model.profile(id, result.data.tables, "all", new Date(result.data.today + "T12:00:00"));
  if (!profile) return respond(404, { error: "Ezin izan dira estatistikak kargatu" });
  return respond(200, { ok: true, enabled: true,
    summary: { ...personalStats(profile.totals), matches: profile.history.length },
    matches: profile.history.map(function (item) {
      return { id: item.match.id_partida, date: item.match.data_ordua, opponent: item.match.aurkaria,
        ...personalStats(item.stats) };
    }),
    attendance: { recorded: profile.attendanceCount, present: profile.present, absent: profile.absent,
      rate: profile.attendanceRate, late: profile.late,
      entries: profile.attendance.map(function (entry) {
        return { date: entry.session.data_ordua, recorded: entry.recorded, present: entry.present, late: entry.late };
      }) },
  });
}
