"use strict";

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  // Also expose the shared calculations when bundled for the Edge runtime.
  root.SevenMetroInsights = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  var shotTypes = ["gol", "jaurtiketa", "penalti_gol", "penalti_jaurtiketa"];
  var sanctionTypes = ["horia", "2min", "gorria", "urdina"];
  function rows(tables, name) { return Array.isArray(tables[name]) ? tables[name] : []; }
  function count(value) { var n = Number(value); return Number.isFinite(n) ? Math.max(0, n) : 0; }
  function goal(type) { return type === "gol" || type === "penalti_gol"; }
  function penalty(type) { return type === "penalti_gol" || type === "penalti_jaurtiketa"; }
  function side(value) { return /aurkari|opponent|away/i.test(String(value || "")) ? "away" : "home"; }
  function point(value) { return Array.isArray(value) && value.length === 2 && value.every(function (v) { return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1; }) ? value.slice() : null; }
  function name(player) { return [player.izena, player.abizena].filter(Boolean).join(" "); }
  function rate(goals, shots) { return shots > 0 ? Math.round(goals / shots * 100) : null; }
  function events(match) {
    try {
      var data = typeof match.estatistika_aurreratuak === "string" ? JSON.parse(match.estatistika_aurreratuak) : match.estatistika_aurreratuak;
      return data && Array.isArray(data.event_records) ? data.event_records.filter(function (e) { return e && typeof e === "object" && !Array.isArray(e); }) : [];
    } catch (error) { return []; }
  }
  function shot(event) {
    return { side: side(event.taldea), type: event.type || event.mota, playerId: event.player_id == null ? (event.id_jokalaria == null ? null : Number(event.id_jokalaria)) : Number(event.player_id),
      minute: count(event.minute == null ? event.minutua : event.minute),
      from: event.shot_from ? point(event.shot_from) : point([event.jatorri_x, event.jatorri_y]),
      to: event.shot_to ? point(event.shot_to) : point([event.helburu_x, event.helburu_y]) };
  }
  function signature(s) { return JSON.stringify([s.side, s.type, s.playerId, s.minute, s.from, s.to]); }
  function mappedShots(match, tables) {
    var mapped = events(match).filter(function (e) { return shotTypes.includes(e.type); }).map(shot).filter(function (s) { return s.from && s.to; });
    var available = new Map();
    mapped.forEach(function (s) { var key = signature(s); available.set(key, (available.get(key) || 0) + 1); });
    rows(tables, "partidu_jaurtiketak").filter(function (s) { return Number(s.id_partida) === Number(match.id_partida); }).map(shot).forEach(function (s) {
      if (!s.from || !s.to || !shotTypes.includes(s.type)) return;
      var key = signature(s), copies = available.get(key) || 0;
      if (copies) available.set(key, copies - 1); else mapped.push(s);
    });
    return mapped;
  }
  function emptyStats(id, label, number) {
    return { id: id, label: label, number: number == null ? "" : String(number), goals: 0, shots: 0,
      penaltyGoals: 0, penaltyShots: 0, sanctions: { horia: 0, "2min": 0, gorria: 0, urdina: 0 } };
  }
  function total(list) {
    var result = emptyStats(null, "", "");
    list.forEach(function (s) {
      ["goals", "shots", "penaltyGoals", "penaltyShots"].forEach(function (k) { result[k] += s[k]; });
      sanctionTypes.forEach(function (k) { result.sanctions[k] += s.sanctions[k]; });
    });
    result.efficiency = rate(result.goals, result.shots); return result;
  }
  function breakdown(match, tables) {
    var allEvents = events(match), mapped = mappedShots(match, tables);
    var registered = rows(tables, "partida_jokalariak").filter(function (r) { return Number(r.id_partida) === Number(match.id_partida); });
    var sanctions = rows(tables, "partidu_zigorrak").filter(function (r) { return Number(r.id_partida) === Number(match.id_partida); });
    var roster = rows(tables, "jokalariak"), home = new Map(), away = new Map();
    registered.forEach(function (r) {
      var id = Number(r.id_jokalaria), p = roster.find(function (p) { return Number(p.id_jokalaria) === id; });
      var s = emptyStats(id, p ? name(p) : "#" + id, p && p.dortsala);
      s.goals = count(r.golak); s.shots = Math.max(s.goals, count(r.jaurtiketak)); home.set(id, s);
    });
    var homeEvents = allEvents.filter(function (e) { return side(e.taldea) === "home" && shotTypes.includes(e.type); });
    var awayEvents = allEvents.filter(function (e) { return side(e.taldea) === "away" && shotTypes.includes(e.type); });
    var homeShots = homeEvents.length ? homeEvents.map(shot) : mapped.filter(function (s) { return s.side === "home"; });
    var awayShots = awayEvents.length ? awayEvents.map(shot) : mapped.filter(function (s) { return s.side === "away"; });
    if (!registered.length) homeShots.forEach(function (s) {
      if (s.playerId == null) return;
      if (!home.has(s.playerId)) {
        var p = roster.find(function (p) { return Number(p.id_jokalaria) === s.playerId; });
        var e = homeEvents.find(function (e) { return Number(e.player_id) === s.playerId; });
        home.set(s.playerId, emptyStats(s.playerId, p ? name(p) : e && e.player_label || "#" + s.playerId, p && p.dortsala));
      }
      var value = home.get(s.playerId); value.shots++; if (goal(s.type)) value.goals++;
    });
    home.forEach(function (s) {
      var ps = homeShots.filter(function (shot) { return shot.playerId === s.id && penalty(shot.type); });
      s.penaltyShots = Math.min(s.shots, ps.length); s.penaltyGoals = Math.min(s.goals, s.penaltyShots, ps.filter(function (s) { return goal(s.type); }).length);
    });
    sanctions.forEach(function (r) {
      if (!sanctionTypes.includes(r.mota)) return;
      var id = Number(r.id_jokalaria);
      if (!home.has(id)) {
        var p = roster.find(function (p) { return Number(p.id_jokalaria) === id; });
        home.set(id, emptyStats(id, p ? name(p) : "#" + id, p && p.dortsala));
      }
      home.get(id).sanctions[r.mota]++;
    });
    if (!registered.length && !sanctions.length) allEvents.filter(function (e) { return side(e.taldea) === "home" && sanctionTypes.includes(e.type); }).forEach(function (e) {
      var s = home.get(Number(e.player_id)); if (s) s.sanctions[e.type]++;
    });
    allEvents.filter(function (e) { return side(e.taldea) === "away"; }).forEach(function (e) {
      var p = e.aurkaria;
      if (!p || !(shotTypes.includes(e.type) || sanctionTypes.includes(e.type))) return;
      var number = String(p.zenbakia || ""), label = String(p.izena || "");
      if (!number && !label) return;
      var key = number ? "number:" + number : "name:" + label.trim().toLocaleLowerCase();
      if (!away.has(key)) away.set(key, emptyStats(key, label, number));
      var s = away.get(key); if (label) s.label = label;
      if (shotTypes.includes(e.type)) s.shots++;
      if (goal(e.type)) s.goals++;
      if (penalty(e.type)) { s.penaltyShots++; if (goal(e.type)) s.penaltyGoals++; }
      if (sanctionTypes.includes(e.type)) s.sanctions[e.type]++;
    });
    var sort = function (a, b) { return (Number(a.number) || 999) - (Number(b.number) || 999) || a.label.localeCompare(b.label); };
    var own = Array.from(home.values()).sort(sort), opponents = Array.from(away.values()).sort(sort);
    own.concat(opponents).forEach(function (s) { s.efficiency = rate(s.goals, s.shots); });
    var homeTotal = total(own), awayTotal = total(opponents);
    homeShots.filter(function (s) { return s.playerId == null; }).forEach(function (s) {
      homeTotal.shots++; if (goal(s.type)) homeTotal.goals++;
      if (penalty(s.type)) { homeTotal.penaltyShots++; if (goal(s.type)) homeTotal.penaltyGoals++; }
    });
    if (awayShots.length) {
      awayTotal.shots = awayShots.length; awayTotal.goals = awayShots.filter(function (s) { return goal(s.type); }).length;
      awayTotal.penaltyShots = awayShots.filter(function (s) { return penalty(s.type); }).length;
      awayTotal.penaltyGoals = awayShots.filter(function (s) { return penalty(s.type) && goal(s.type); }).length;
    }
    awayTotal.sanctions = { horia: 0, "2min": 0, gorria: 0, urdina: 0 };
    allEvents.filter(function (e) { return side(e.taldea) === "away" && sanctionTypes.includes(e.type); }).forEach(function (e) { awayTotal.sanctions[e.type]++; });
    homeTotal.efficiency = rate(homeTotal.goals, homeTotal.shots); awayTotal.efficiency = rate(awayTotal.goals, awayTotal.shots);
    return { match: match, home: own, away: opponents, homeTotal: homeTotal, awayTotal: awayTotal, mapped: mapped, events: allEvents };
  }
  function inPeriod(value, period, now) {
    var date = new Date(String(value || "").replace(" ", "T"));
    if (!Number.isFinite(date.getTime())) return false;
    var end = new Date(now); end.setHours(23, 59, 59, 999);
    if (date > end) return false;
    if (period === "all") return true;
    var start = new Date(now); start.setHours(0, 0, 0, 0);
    if (period === "season") start = new Date(now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1, 7, 1);
    else start.setMonth(start.getMonth() - (period === "month" ? 1 : 3));
    return date >= start;
  }
  function profile(playerId, tables, period, now) {
    now = now || new Date(); period = period || "all";
    var player = rows(tables, "jokalariak").find(function (p) { return Number(p.id_jokalaria) === Number(playerId); });
    if (!player) return null;
    var history = [], maps = [];
    rows(tables, "partidak").filter(function (m) { return inPeriod(m.data_ordua, period, now); }).forEach(function (m) {
      var data = breakdown(m, tables), stats = data.home.find(function (s) { return s.id === Number(playerId); });
      if (stats) history.push({ match: m, stats: stats });
      maps = maps.concat(data.mapped.filter(function (s) { return s.side === "home" && s.playerId === Number(playerId); }));
    });
    history.sort(function (a, b) { return String(b.match.data_ordua).localeCompare(String(a.match.data_ordua)); });
    var attendance = rows(tables, "saioak").filter(function (s) { return inPeriod(s.data_ordua, period, now); }).map(function (session) {
      var record = rows(tables, "saio_bertaratzea").find(function (r) { return Number(r.id_saio) === Number(session.id_saio) && Number(r.id_jokalaria) === Number(playerId); });
      return { session: session, recorded: Boolean(record), present: record ? Number(record.bertaratu) === 1 : null,
        late: record ? count(record.atzerapena_min) : 0, lateType: record && record.atzerapena_mota || "" };
    }).sort(function (a, b) { return String(b.session.data_ordua).localeCompare(String(a.session.data_ordua)); });
    var recorded = attendance.filter(function (a) { return a.recorded; }), present = recorded.filter(function (a) { return a.present; }).length;
    return { player: player, history: history, mapped: maps, totals: total(history.map(function (h) { return h.stats; })),
      attendance: attendance, attendanceCount: recorded.length, present: present, absent: recorded.length - present,
      attendanceRate: rate(present, recorded.length), late: recorded.filter(function (a) { return a.present && a.late > 0; }).length };
  }
  return { breakdown: breakdown, profile: profile, events: events, rate: rate, goal: goal, name: name, sanctionTypes: sanctionTypes };
});
