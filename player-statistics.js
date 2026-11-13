"use strict";

(function () {
  var coach = { team: 0, enabled: false, version: 0, busy: false, sequence: 0, message: "" };
  var player = { id: 0, enabled: false, data: null, period: "all", limit: 10, busy: false, statusSequence: 0, statsSequence: 0 };
  var timer = 0;

  function renderCoach() {
    $("player-stats-permission").innerHTML = '<label class="checkrow"><input id="player-stats-enabled" type="checkbox"' +
      (coach.enabled ? ' checked' : '') + (coach.busy || coach.team !== teamId ? ' disabled' : '') + '><span>' +
      esc(t("Jokalariek beren estatistikak ikustea")) + '</span></label><div class="toolbar"><p class="muted" role="status">' +
      esc(coach.message) + '</p><button class="btn secondary" type="button" data-stats-permission-reload' +
      (coach.busy ? ' disabled' : '') + '>' + esc(t("Birkargatu")) + '</button></div>';
  }

  async function refreshCoach() {
    if (!token || !teamId || document.body.classList.contains("player-mode") || (coach.busy && coach.team === teamId)) return;
    var sequence = ++coach.sequence, currentTeam = teamId, sessionToken = token;
    if (coach.team !== teamId) { coach.enabled = false; coach.version = 0; }
    coach.team = teamId; coach.busy = true; coach.message = t("Kargatzen..."); renderCoach();
    try {
      var result = await request({ action: "player_stats_settings", team_id: currentTeam });
      if (sequence !== coach.sequence || currentTeam !== teamId || token !== sessionToken) return;
      coach.enabled = result.enabled; coach.version = result.version;
      coach.message = t(coach.enabled ? "Jokalarien estatistikak aktibatuta" : "Jokalarien estatistikak desaktibatuta");
    } catch (error) {
      if (sequence === coach.sequence && currentTeam === teamId && token === sessionToken) coach.message = error.message;
    } finally {
      if (sequence === coach.sequence && currentTeam === teamId && token === sessionToken) { coach.busy = false; renderCoach(); }
    }
  }

  async function savePermission(enabled) {
    if (coach.busy || coach.team !== teamId) return;
    var sequence = ++coach.sequence, currentTeam = teamId, sessionToken = token;
    var previous = coach.enabled;
    coach.enabled = enabled; coach.busy = true; coach.message = t("Gordetzen..."); renderCoach();
    try {
      var result = await request({ action: "player_stats_save_settings", team_id: currentTeam, enabled: enabled, version: coach.version });
      if (sequence !== coach.sequence || currentTeam !== teamId || token !== sessionToken) return;
      coach.enabled = result.enabled; coach.version = result.version;
      coach.message = t(coach.enabled ? "Jokalarien estatistikak aktibatuta" : "Jokalarien estatistikak desaktibatuta");
    } catch (error) {
      if (sequence === coach.sequence && currentTeam === teamId && token === sessionToken) { coach.enabled = previous; coach.message = error.message; }
    } finally {
      if (sequence === coach.sequence && currentTeam === teamId && token === sessionToken) { coach.busy = false; renderCoach(); }
    }
  }

  function renderEntry() {
    var entry = $("portal-personal-stats-entry");
    var enabled = player.enabled && player.id === portalState.playerId;
    if (entry) {
      entry.hidden = !enabled;
      entry.innerHTML = enabled ? '<button class="btn secondary portal-stats-entry" type="button" data-open-personal-stats>' + esc(t("Nire estatistikak")) + '<span aria-hidden="true">→</span></button>' : '';
    }
    $("portal-personal-stats-account").hidden = !enabled;
  }

  function hidePlayerStats() {
    player.enabled = false; player.data = null; player.statsSequence++; player.busy = false;
    $("portal-personal-stats-content").innerHTML = "";
    renderEntry();
    if (portalState.tab === "stats") portalSetTab("home");
  }

  async function refreshPlayer() {
    if (!token || !portalState.playerId || !document.body.classList.contains("player-mode")) return;
    var id = portalState.playerId, sessionToken = token;
    if (player.id !== id) { hidePlayerStats(); player.id = id; player.period = "all"; }
    var sequence = ++player.statusSequence;
    try {
      var result = await request({ action: "player_stats_status", player_id: id });
      if (sequence !== player.statusSequence || id !== portalState.playerId || token !== sessionToken) return;
      player.enabled = result.enabled === true;
      if (!player.enabled) hidePlayerStats();
      renderEntry();
    } catch (error) {
      if (sequence === player.statusSequence && id === portalState.playerId && token === sessionToken) hidePlayerStats();
    }
  }

  function metric(label, value) {
    return '<div class="insight-metric"><strong>' + esc(value == null ? '—' : String(value)) + '</strong><span>' + esc(t(label)) + '</span></div>';
  }

  function renderStats() {
    if (!player.data) return;
    var data = player.data, summary = data.summary, attendance = data.attendance;
    var html = '<div class="insight-metrics">' + metric("Partidak", summary.matches) + metric("Golak", summary.goals) +
      metric("Jaurtiketak", summary.shots) + metric("Eraginkortasuna", summary.efficiency == null ? null : summary.efficiency + '%') + '</div>';
    html += '<details class="portal-history"><summary>' + esc(t("Zigorrak")) + '</summary><div class="insight-metrics">' +
      metric("Horia", summary.sanctions.horia) + metric("2 min", summary.sanctions['2min']) + metric("Gorria", summary.sanctions.gorria) + metric("Urdina", summary.sanctions.urdina) + '</div></details>';
    if (summary.penaltyShots) html += '<p class="muted">' + esc(t("7 metroko golak / jaurtiketak")) + ' · ' + summary.penaltyGoals + ' / ' + summary.penaltyShots + '</p>';
    html += '<h3>' + esc(t("Nire asistentzia")) + '</h3><div class="insight-metrics">' + metric("Bertaratuta", attendance.present) +
      metric("Huts eginda", attendance.absent) + metric("Berandu", attendance.late) + metric("Asistentzia", attendance.rate == null ? null : attendance.rate + '%') + '</div>';
    if (!attendance.recorded) html += '<p class="muted">' + esc(t("Ez dago asistentzia-erregistrorik hautatutako aldian.")) + '</p>';
    html += '<h3>' + esc(t("Partidaz partida")) + '</h3>';
    html += data.matches.length ? data.matches.slice(0, player.limit).map(function (match) {
      return '<article class="card portal-personal-match"><div><h3>' + esc(match.opponent || t("Aurkaria")) + '</h3><p class="muted">' + esc(portalDate(match.date)) + '</p></div>' +
        '<div class="portal-personal-match-numbers"><span><strong>' + match.goals + '</strong>' + esc(t("Golak")) + '</span><span><strong>' + match.shots + '</strong>' + esc(t("Jaurtiketak")) + '</span><span><strong>' +
        (match.efficiency == null ? '—' : match.efficiency + '%') + '</strong>' + esc(t("Eraginkortasuna")) + '</span></div></article>';
    }).join("") : portalEmpty("Ez dago zure partidako estatistikarik hautatutako aldian.");
    if (data.matches.length > player.limit) html += '<button class="btn secondary" type="button" data-personal-stats-more>' + esc(t("Gehiago ikusi")) + '</button>';
    if (attendance.entries.length) html += '<details class="portal-history"><summary>' + esc(t("Asistentziaren xehetasunak")) + '</summary><ul class="list portal-personal-attendance">' +
      attendance.entries.map(function (entry) { return '<li class="item"><span>' + esc(portalDate(entry.date)) + '</span><strong>' +
        esc(t(!entry.recorded ? "Erregistratu gabe" : entry.present ? "Bertaratuta" : "Huts eginda")) + '</strong></li>'; }).join("") + '</ul></details>';
    $("portal-personal-stats-content").innerHTML = html;
  }

  async function open() {
    if (!token || !portalState.playerId || player.busy) return;
    var id = portalState.playerId, sessionToken = token, sequence = ++player.statsSequence;
    player.statusSequence++;
    player.id = id; player.busy = true; player.data = null; player.limit = 10;
    portalSetTab("stats");
    $("portal-personal-stats-period").value = player.period;
    $("portal-personal-stats-content").innerHTML = portalEmpty("Kargatzen...");
    $("portal-personal-stats-period").disabled = true;
    try {
      var result = await request({ action: "player_stats_get", player_id: id, period: player.period });
      if (sequence !== player.statsSequence || id !== portalState.playerId || token !== sessionToken) return;
      player.enabled = true; player.data = result; renderEntry(); renderStats();
    } catch (error) {
      if (sequence !== player.statsSequence || id !== portalState.playerId || token !== sessionToken) return;
      hidePlayerStats(); notify(error.message, "error");
    } finally {
      if (id === portalState.playerId && token === sessionToken) { player.busy = false; $("portal-personal-stats-period").disabled = false; }
    }
  }

  function reset() {
    coach.sequence++; player.statusSequence++; player.statsSequence++;
    coach.team = 0; coach.enabled = false; coach.busy = false; coach.version = 0; coach.message = "";
    hidePlayerStats(); player.id = 0; player.period = "all";
    clearInterval(timer); timer = 0;
    renderCoach();
  }

  window.PlayerStatistics = {
    reset: reset, refreshCoach: refreshCoach, renderEntry: renderEntry,
    refreshPlayer: function () {
      refreshPlayer();
      if (!timer) timer = setInterval(function () { if (!document.hidden) refreshPlayer(); }, 60000);
    }
  };
  document.addEventListener("DOMContentLoaded", function () {
    renderCoach(); renderEntry();
    $("player-stats-permission").addEventListener("change", function (event) { if (event.target.id === "player-stats-enabled") savePermission(event.target.checked); });
    $("player-stats-permission").addEventListener("click", function (event) { if (event.target.closest("[data-stats-permission-reload]")) refreshCoach(); });
    $("player-portal").addEventListener("click", function (event) {
      if (event.target.closest("[data-open-personal-stats]")) open();
      if (event.target.closest("[data-personal-stats-more]")) { player.limit += 10; renderStats(); }
    });
    $("portal-personal-stats-period").addEventListener("change", function () { player.period = this.value; open(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshPlayer(); });
    window.addEventListener("languagechange", function () { renderCoach(); renderEntry(); renderStats(); });
  });
})();
