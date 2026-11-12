"use strict";

var portalEventState = { matchId: 0, teamId: 0, sequence: 0, requestId: 0 };
function portalEventResponses(kind, id, data) {
  var rows = players.filter(function (player) {
    return kind === "session" || data.callups.some(function (callup) { return Number(callup.match_id) === id && Number(callup.player_id) === Number(player.id_jokalaria); });
  });
  var counts = { yes: 0, no: 0, maybe: 0, pending: 0 };
  var markup = rows.map(function (player) {
    var response = data.responses.find(function (row) { return row.kind === kind && Number(row.event_id) === id && Number(row.player_id) === Number(player.id_jokalaria); });
    var linked = data.links.some(function (link) { return Number(link.player_id) === Number(player.id_jokalaria); });
    counts[response ? response.response : "pending"]++;
    return '<div class="portal-roster-row"><div><strong>' + esc((player.dortsala == null ? '' : '#' + player.dortsala + ' ') + playerName(player)) + '</strong>' + (!linked ? '<small class="muted">' + esc(t("Konturik lotu gabe")) + '</small>' : '') + (response && response.note ? '<small class="portal-authored">' + esc(response.note) + '</small>' : '') + '</div><span class="portal-response ' + (response ? response.response : '') + '">' + esc(portalResponseLabel(response && response.response)) + '</span></div>';
  }).join("");
  if (!rows.length) return portalEmpty(kind === "match" ? "Oraindik ez dago deialdirik." : "Ez dago jokalaririk.");
  return '<div class="portal-response-counts">' + [["yes", "Banoa"], ["no", "Ezin dut"], ["maybe", "Zalantzan"], ["pending", "Erantzun gabe"]].map(function (entry) {
    return '<div><strong class="portal-response ' + entry[0] + '">' + counts[entry[0]] + '</strong><span>' + esc(t(entry[1])) + '</span></div>';
  }).join("") + '</div><div class="portal-response-roster">' + markup + '</div>';
}
function portalMatchCallupForm(matchId, data, formId) {
  var callups = data.callups.filter(function (c) { return Number(c.match_id) === matchId; }), first = callups[0] || {};
  return '<form id="' + formId + '" class="stack"><input type="hidden" name="match_id" value="' + matchId + '"><label>' + esc(t("Elkartzeko ordua")) + '<input name="meeting_time" type="datetime-local" value="' + esc(first.meeting_time || '') + '"></label><label>' + esc(t("Elkartzeko tokia")) + '<input name="meeting_place" maxlength="250" value="' + esc(first.meeting_place || '') + '"></label><label>' + esc(t("Oharrak")) + '<textarea name="note" maxlength="2000">' + esc(first.note || '') + '</textarea></label><p class="muted">' + esc(t("Hautatutako jokalariek deialdia ikusiko dute beren aplikazioan.")) + '</p><div class="portal-callup-roster">' + players.map(function (player) {
    return '<label class="checkrow"><input type="checkbox" name="player_ids" value="' + Number(player.id_jokalaria) + '"' + (callups.some(function (c) { return Number(c.player_id) === Number(player.id_jokalaria); }) ? ' checked' : '') + '><span>' + esc((player.dortsala == null ? '' : '#' + player.dortsala + ' ') + playerName(player)) + '</span></label>';
  }).join("") + '</div><button type="submit" class="btn">' + esc(t("Deialdia gorde")) + '</button></form>';
}
function portalCallupPayload(form) {
  var data = new FormData(form), fields = Object.fromEntries(data);
  return { action: "portal_publish_callup", match_id: Number(fields.match_id), player_ids: data.getAll("player_ids").map(Number), meeting_time: fields.meeting_time, meeting_place: fields.meeting_place, note: fields.note };
}
function portalNormalizeEventData(data) {
  return { responses: data.responses || [], links: data.links || [], callups: data.callups || [] };
}
async function portalLoadSessionResponses(id, targetId) {
  id = Number(id);
  var target = $(targetId || "saved-session-responses"), requestId = ++portalEventState.requestId, currentTeam = teamId, sessionToken = token;
  target.dataset.requestId = String(requestId); target.innerHTML = portalEmpty("Kargatzen…");
  try {
    var data = await request({ action: "portal_coach_snapshot", team_id: currentTeam });
    if (!token || token !== sessionToken || teamId !== currentTeam || target.dataset.requestId !== String(requestId)) return;
    target.innerHTML = portalEventResponses("session", id, portalNormalizeEventData(data));
  } catch (error) {
    if (target.dataset.requestId === String(requestId) && token === sessionToken && teamId === currentTeam) target.innerHTML = '<p class="notice error" role="alert">' + esc(error.message) + '</p>';
  }
}
async function portalLoadAttendanceResponses(id) {
  id = Number(id);
  var marker = $("attendance-response-state"), requestId = ++portalEventState.requestId, currentTeam = teamId, sessionToken = token;
  marker.dataset.requestId = String(requestId); marker.textContent = t("Kargatzen…");
  document.querySelectorAll("[data-att-response]").forEach(function (label) { label.textContent = ""; });
  try {
    var result = await request({ action: "portal_coach_snapshot", team_id: currentTeam });
    if (!token || token !== sessionToken || teamId !== currentTeam || marker.dataset.requestId !== String(requestId)) return;
    var data = portalNormalizeEventData(result);
    marker.textContent = t("Jokalariaren aurreko erantzuna ageri da izenaren azpian. Benetako asistentzia aparte gordetzen da.");
    document.querySelectorAll("[data-att-response]").forEach(function (label) {
      var playerId = Number(label.dataset.attResponse);
      var response = data.responses.find(function (row) { return row.kind === "session" && Number(row.event_id) === id && Number(row.player_id) === playerId; });
      label.innerHTML = '<span class="portal-response ' + (response ? response.response : '') + '">' + esc(t("Aurreikuspena")) + ': ' + esc(portalResponseLabel(response && response.response)) + '</span>' + (response && response.note ? '<span class="portal-authored">' + esc(response.note) + '</span>' : '');
    });
  } catch (error) { if (marker.dataset.requestId === String(requestId) && token === sessionToken && teamId === currentTeam) marker.textContent = error.message; }
}
async function portalOpenMatch(id) {
  var match = matches.find(function (row) { return Number(row.id_partida) === Number(id); });
  if (!match) return;
  portalEventState.matchId = Number(id); portalEventState.teamId = teamId;
  $("portal-event-name").textContent = (match.aurkaria || t("Aurkaria")) + " · " + portalDate(match.data_ordua);
  $("portal-event-dialog").showModal(); $("portal-event-dialog").scrollTop = 0;
  await portalLoadEventMatch();
}
async function portalLoadEventMatch() {
  var sequence = ++portalEventState.sequence, id = portalEventState.matchId, currentTeam = portalEventState.teamId, sessionToken = token;
  portalError("portal-event-error", ""); $("portal-event-content").innerHTML = portalEmpty("Kargatzen…");
  try {
    var result = await request({ action: "portal_coach_snapshot", team_id: currentTeam });
    if (!token || token !== sessionToken || currentTeam !== teamId || sequence !== portalEventState.sequence || !$("portal-event-dialog").open) return;
    var data = portalNormalizeEventData(result), match = matches.find(function (row) { return Number(row.id_partida) === id; });
    var callup = data.callups.find(function (row) { return Number(row.match_id) === id; });
    var meeting = callup ? '<div class="portal-meeting">' + (callup.meeting_time ? '<p><strong>' + esc(t("Elkartzeko ordua")) + ':</strong> ' + esc(portalDate(callup.meeting_time)) + '</p>' : '') + (callup.meeting_place ? '<p><strong>' + esc(t("Elkartzeko tokia")) + ':</strong> ' + esc(callup.meeting_place) + '</p>' : '') + (callup.note ? '<p class="portal-authored">' + esc(callup.note) + '</p>' : '') + '</div>' : '';
    $("portal-event-content").innerHTML = meeting + '<h3>' + esc(t("Deialdiaren erantzunak")) + '</h3>' + portalEventResponses("match", id, data) +
      (match && String(match.data_ordua).slice(0, 10) >= planKey(new Date()) ? '<details class="portal-callup-editor"' + (callup ? '' : ' open') + '><summary>' + esc(t(callup ? "Deialdia editatu" : "Deialdia prestatu")) + '</summary>' + portalMatchCallupForm(id, data, "portal-event-callup-form") + '</details>' : '');
    var form = $("portal-event-callup-form"); if (form) form.dataset.cleanDraft = JSON.stringify(Array.from(new FormData(form)));
  } catch (error) {
    if (sequence === portalEventState.sequence && currentTeam === teamId && token === sessionToken) {
      $("portal-event-content").innerHTML = ""; portalError("portal-event-error", error.message);
    }
  }
}
window.PlayerPortal.loadSession = portalLoadSessionResponses;
window.PlayerPortal.loadAttendance = portalLoadAttendanceResponses;
window.PlayerPortal.openMatch = portalOpenMatch;
window.addEventListener("DOMContentLoaded", function () {
  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-match-callup]");
    if (button) portalOpenMatch(button.dataset.matchCallup);
  });
  $("saved-session-responses-refresh").addEventListener("click", function () { portalLoadSessionResponses($("v-session-detail").dataset.sessionId); });
  $("saved-session-attendance").addEventListener("click", function () { openAttendanceDialog($("v-session-detail").dataset.sessionId); });
  $("portal-event-close").addEventListener("click", function () { if (!this.disabled) $("portal-event-dialog").close(); });
  $("portal-event-dialog").addEventListener("close", function () { portalEventState.sequence++; });
  $("portal-event-dialog").addEventListener("cancel", function (event) { if ($("portal-event-close").disabled) event.preventDefault(); });
  $("portal-event-refresh").addEventListener("click", function () {
    var form = $("portal-event-callup-form");
    if (form && JSON.stringify(Array.from(new FormData(form))) !== form.dataset.cleanDraft && !window.confirm(t("Gorde gabeko aldaketak galduko dira. Jarraitu?"))) return;
    portalLoadEventMatch();
  });
  $("portal-event-content").addEventListener("submit", function (event) {
    event.preventDefault(); if (portalEventState.teamId !== teamId) return;
    portalCoachMutation(portalCallupPayload(event.target), event.target);
  });
  window.addEventListener("languagechange", function () {
    if ($("attendance-dialog").open) portalLoadAttendanceResponses($("attendance-session").value);
  });
});
