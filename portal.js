"use strict";

var portalState = { bootstrap: null, playerId: 0, data: null, tab: "home", coachTab: "accounts", coachData: null, coachTeam: 0, coachMatch: 0, coachEvent: "", sequence: 0, coachSequence: 0, routeSequence: 0, response: null };
function portalModeKey() { return "7metro-mode:" + (user && user.izena || userName || ""); }
function portalSetMode(mode) { saveLocal(portalModeKey(), mode); $("login-mode").value = mode; }
function portalError(id, message) { var el = $(id); el.textContent = message || ""; el.hidden = !message; }
function portalName(player) { return [player.name || player.izena, player.surname || player.abizena].filter(Boolean).join(" "); }
function portalDate(value) {
  var d = new Date(value); if (!Number.isFinite(d.getTime())) return value || "";
  if (I18n.language() === "eu") return d.getDate() + "/" + (d.getMonth() + 1) + "/" + d.getFullYear() + " · " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  return d.toLocaleString(I18n.locale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function portalEmpty(message) { return '<p class="report-empty">' + esc(t(message)) + '</p>'; }
function portalResponseLabel(value) { return t({ yes: "Banoa", no: "Ezin dut", maybe: "Zalantzan" }[value] || "Erantzun gabe"); }
function portalHide() {
  portalState.sequence++; portalState.coachSequence++; portalState.routeSequence++;
  document.body.classList.remove("player-mode");
  $("player-portal").classList.add("hidden"); $("player-portal").classList.remove("on");
}
function portalReset() {
  portalHide(); portalState.bootstrap = null; portalState.playerId = 0; portalState.data = null; portalState.coachData = null;
  if (typeof portalCalendarReset === "function") portalCalendarReset();
  if ($("portal-event-dialog").open) $("portal-event-dialog").close();
  if ($("portal-response-dialog").open) $("portal-response-dialog").close();
  $("portal-response-note").value = "";
  ["portal-home", "portal-agenda", "portal-callups", "portal-notices", "portal-invites", "portal-coach-content", "portal-event-content", "saved-session-responses"].forEach(function (id) { $(id).innerHTML = ""; });
  document.querySelectorAll("[data-att-response]").forEach(function (label) { label.textContent = ""; });
}
async function routeAuthenticatedSession(requested) {
  var sessionToken = token, sequence = ++portalState.routeSequence;
  var boot = await request({ action: "portal_bootstrap" });
  if (!token || token !== sessionToken || sequence !== portalState.routeSequence) return;
  portalState.bootstrap = boot;
  var mode = requested || readStore(portalModeKey()) || ((boot.links.length || boot.invites.length) && !boot.coach ? "player" : "coach");
  if (mode === "player") { portalSetMode("player"); await portalShow(boot); }
  else { portalSetMode("coach"); portalHide(); await loadTeams(true); }
  if (window.InboxUI) window.InboxUI.start();
  if (window.PushUI) await window.PushUI.afterLogin();
}
async function portalShow(boot) {
  var sessionToken = token, sequence = ++portalState.sequence;
  if (scoreMatchMode) scoreExitMatchMode();
  setMobileMenu(false); $("mobile-menu-toggle").hidden = true;
  $("workspace").classList.add("hidden"); $("nav").classList.add("hidden"); $("nav").inert = true;
  $("v-login").classList.remove("on"); $("player-portal").classList.remove("hidden"); $("player-portal").classList.add("on");
  document.body.classList.add("player-mode"); $("account").textContent = user && user.izena || userName;
  portalError("portal-error", "");
  boot = boot || await request({ action: "portal_bootstrap" });
  if (!token || token !== sessionToken || sequence !== portalState.sequence) return;
  portalState.bootstrap = boot;
  $("portal-username").textContent = user && user.izena || userName;
  $("portal-no-link").hidden = !!boot.links.length; $("portal-linked-content").hidden = false;
  document.querySelectorAll("[data-portal-tab]").forEach(function (button) { button.disabled = !boot.links.length && button.dataset.portalTab !== "settings"; });
  $("portal-team-label").hidden = boot.links.length < 2;
  $("portal-coach-mode").hidden = !boot.coach;
  $("portal-invites").innerHTML = boot.invites.map(function (invite) {
    return '<div class="card"><h2>' + esc(invite.team_name) + '</h2><p>' + esc(t("Jokalari-fitxa lotzeko gonbidapena")) + ': ' + esc(portalName(invite)) + '</p><div class="portal-inline-actions"><button type="button" class="btn" data-portal-invite="' + Number(invite.id) + '" data-accept="true">' + esc(t("Onartu")) + '</button><button type="button" class="btn secondary" data-portal-invite="' + Number(invite.id) + '" data-accept="false">' + esc(t("Baztertu")) + '</button></div></div>';
  }).join("");
  var previousPlayer = portalState.playerId;
  if (!boot.links.some(function (link) { return link.player_id === portalState.playerId; })) portalState.playerId = boot.links.length ? boot.links[0].player_id : 0;
  if (!previousPlayer && portalState.playerId) portalState.tab = "home";
  $("portal-team").innerHTML = boot.links.map(function (link) { return '<option value="' + Number(link.player_id) + '">' + esc(link.team_name) + '</option>'; }).join("");
  $("portal-team").value = String(portalState.playerId);
  if (portalState.playerId) await portalLoadPlayer();
  else {
    $("portal-greeting").textContent = t("Nire kontua");
    $("portal-player-name").textContent = ""; portalState.data = null;
    ["portal-home", "portal-agenda", "portal-callups", "portal-notices"].forEach(function (id) { $(id).innerHTML = ""; });
    portalSetTab("settings");
  }
}
async function portalLoadPlayer() {
  var sequence = ++portalState.sequence, id = portalState.playerId;
  portalState.data = null;
  ["portal-home", "portal-agenda", "portal-callups", "portal-notices"].forEach(function (view) { $(view).innerHTML = portalEmpty("Kargatzen…"); });
  try {
    var data = await request({ action: "portal_player_snapshot", player_id: id });
    if (sequence !== portalState.sequence || !token) return;
    portalState.data = data; portalRenderPlayer();
  } catch (error) { if (sequence === portalState.sequence) portalError("portal-error", error.message); }
}
function portalSetTab(tab) {
  if (!portalState.playerId && tab !== "settings") tab = "settings";
  if (tab === "settings" && window.PushUI) window.PushUI.loadPlayerFriends();
  portalState.tab = tab;
  ["home", "agenda", "callups", "notices", "settings"].forEach(function (name) { $("portal-" + name).hidden = name !== tab; });
  document.querySelectorAll("[data-portal-tab]").forEach(function (button) { button.setAttribute("aria-pressed", String(button.dataset.portalTab === tab)); });
}
function portalEventCard(event) {
  var data = portalState.data, kind = event.kind, row = event.row;
  var response = data.responses.find(function (r) { return r.kind === kind && Number(r.event_id) === Number(row.id); });
  var past = String(row.date).slice(0, 10) < planKey(new Date());
  var called = kind === "match" && row.callup;
  var date = new Date(row.date), validDate = Number.isFinite(date.getTime());
  var html = '<article class="card portal-event"><div class="portal-event-heading"><div class="portal-event-day" aria-hidden="true"><strong>' +
    (validDate ? date.getDate() : '–') + '</strong><span>' + esc(validDate ? t(PLAN_MONTHS[date.getMonth()]).slice(0, 3) : '') + '</span></div><div class="portal-event-main"><span class="portal-kind portal-kind-' + kind + '">' + esc(t(kind === "session" ? "Entrenamendua" : "Partida")) + '</span><h3>' + esc(kind === "session" ? row.title || t("Entrenamendua") : row.opponent || t("Aurkaria")) + '</h3><p class="portal-event-date">' + esc(portalDate(row.date)) + '</p>' +
    (row.place ? '<p class="muted">' + esc(kind === "session" ? row.place : t(row.place)) + '</p>' : '') + '</div></div>';
  if (called) html += '<div class="portal-meeting"><strong>' + esc(t("Deialdian zaude")) + '</strong>' + (row.callup.meeting_time ? '<p>' + esc(t("Elkartzeko ordua")) + ': ' + esc(portalDate(row.callup.meeting_time)) + '</p>' : '') + (row.callup.meeting_place ? '<p>' + esc(t("Elkartzeko tokia")) + ': ' + esc(row.callup.meeting_place) + '</p>' : '') + (row.callup.note ? '<p class="portal-authored">' + esc(row.callup.note) + '</p>' : '') + '</div>';
  if (kind === "session" || called) {
    html += '<p class="portal-response ' + (response ? response.response : '') + '">' + esc(portalResponseLabel(response && response.response)) + '</p>';
    if (response && response.note) html += '<p class="portal-authored muted">' + esc(response.note) + '</p>';
    if (!past) html += '<button class="btn' + (response ? ' secondary' : '') + '" type="button" data-portal-respond="' + kind + ':' + Number(row.id) + '">' + esc(t(response ? "Erantzuna aldatu" : "Bertaratzea baieztatu")) + '</button>';
  } else html += '<p class="muted">' + esc(t("Deialdirik gabe")) + '</p>';
  return html + '</article>';
}
function portalHasResponse(event) {
  return portalState.data.responses.some(function (response) { return response.kind === event.kind && Number(response.event_id) === Number(event.row.id); });
}
function portalRenderHome(events, pending, unread) {
  var eligible = events.filter(function (event) {
    return (event.kind === "session" || event.row.callup) && new Date(event.row.date).getTime() >= Date.now();
  });
  var next = eligible[0];
  var html = '<div class="portal-home-summary"><button type="button" data-portal-go="callups" class="portal-summary-action' + (pending.length ? ' needs-response' : '') + '"><strong>' + pending.length + '</strong><span>' + esc(t("Deialdi erantzuteko")) + '</span></button>' +
    '<button type="button" data-portal-go="notices" class="portal-summary-action"><strong>' + unread + '</strong><span>' + esc(t("Abisu irakurri gabe")) + '</span></button></div>';
  html += '<div class="portal-section-heading"><h2>' + esc(t("Hurrengo jarduera")) + '</h2></div><div class="portal-next-event">' +
    (next ? portalEventCard(next) : '<div class="card portal-home-empty"><h3>' + esc(t("Ez dago hurrengo deialdirik")) + '</h3><button class="btn secondary" type="button" data-portal-go="agenda">' + esc(t("Egutegia ikusi")) + '</button></div>') + '</div>';
  var following = eligible.slice(1, 4);
  if (following.length) {
    html += '<div class="portal-section-heading"><h2>' + esc(t("Ondoren")) + '</h2><button type="button" data-portal-go="agenda">' + esc(t("Egutegia ikusi")) + '</button></div><div class="portal-upcoming">' + following.map(function (event) {
      return '<button type="button" class="portal-upcoming-event" data-portal-open-event="' + event.kind + ':' + Number(event.row.id) + '"><span><strong>' + esc(event.kind === "session" ? event.row.title || t("Entrenamendua") : event.row.opponent || t("Partida")) + '</strong><small>' + esc(portalDate(event.row.date)) + '</small></span><span class="portal-upcoming-kind">' + esc(t(event.kind === "session" ? "Entrenamendua" : "Partida")) + '</span></button>';
    }).join("") + '</div>';
  }
  var notice = portalState.data.notices.find(function (item) { return !item.read; });
  if (notice) html += '<div class="portal-section-heading"><h2>' + esc(t("Azken abisua")) + '</h2></div><button class="card portal-home-notice" type="button" data-portal-go="notices"><strong>' + esc(notice.title) + '</strong><span>' + esc(notice.body) + '</span><small>' + esc(t("Abisuak ikusi")) + '</small></button>';
  $("portal-home").innerHTML = html;
}
function portalRenderPlayer() {
  var data = portalState.data; if (!data) return;
  $("portal-greeting").textContent = t("Kaixo, {name}", { name: data.player.name || portalName(data.player) });
  $("portal-player-name").textContent = [data.player.team_name, data.player.number == null ? "" : "#" + data.player.number].filter(Boolean).join(" · ");
  var events = data.sessions.map(function (s) { return { kind: "session", row: s }; }).concat(data.matches.map(function (m) { return { kind: "match", row: m }; })).sort(function (a, b) { return a.row.date.localeCompare(b.row.date); });
  portalRenderAgenda(events);
  var today = planKey(new Date());
  var callups = events.filter(function (event) { return event.kind === "session" || event.row.callup; });
  var upcoming = callups.filter(function (event) { return String(event.row.date).slice(0, 10) >= today; });
  var pending = upcoming.filter(function (event) { return !portalHasResponse(event); });
  var answered = upcoming.filter(portalHasResponse);
  var past = callups.filter(function (event) { return String(event.row.date).slice(0, 10) < today; });
  $("portal-callups").innerHTML = '<h2>' + esc(t("Nire deialdiak")) + '</h2>' +
    (pending.length ? '<h3 class="portal-subheading">' + esc(t("Erantzuteko")) + ' · ' + pending.length + '</h3>' + pending.map(portalEventCard).join("") : upcoming.length ? '<p class="portal-caught-up">' + esc(t("Deialdi guztiak erantzunda dituzu")) + '</p>' : '') +
    (answered.length ? '<details class="portal-history"><summary>' + esc(t("Erantzunda")) + ' · ' + answered.length + '</summary>' + answered.map(portalEventCard).join("") + '</details>' : '') +
    (past.length ? '<details class="portal-history"><summary>' + esc(t("Aurreko deialdiak")) + ' · ' + past.length + '</summary>' + past.map(portalEventCard).join("") + '</details>' : '') +
    (!callups.length ? portalEmpty("Oraindik ez duzu deialdirik.") : '');
  $("portal-notices").innerHTML = '<h2>' + esc(t("Taldeko abisuak")) + '</h2>' + (data.notices.length ? data.notices.map(function (notice) {
    return '<article class="card"><span class="portal-kind">' + esc(portalDate(notice.created_at)) + '</span><h3>' + esc(notice.title) + '</h3><p class="portal-authored">' + esc(notice.body) + '</p>' + (notice.read ? '<p class="portal-response yes">' + esc(t("Irakurrita")) + '</p>' : '<button class="btn secondary" type="button" data-portal-read="' + Number(notice.id) + '">' + esc(t("Irakurrita markatu")) + '</button>') + '</article>';
  }).join("") : portalEmpty("Ez dago taldeko abisurik."));
  var unread = data.notices.filter(function (notice) { return !notice.read; }).length;
  portalRenderHome(events, pending, unread);
  [["callups", pending.length], ["notices", unread]].forEach(function (entry) {
    var badge = document.querySelector('[data-portal-count="' + entry[0] + '"]');
    badge.textContent = entry[1]; badge.hidden = !entry[1];
  });
  portalSetTab(portalState.tab);
}
function portalOpenResponse(key) {
  var bits = key.split(":"), kind = bits[0], id = Number(bits[1]), data = portalState.data;
  if (!data) return;
  var event = (kind === "session" ? data.sessions : data.matches).find(function (row) { return Number(row.id) === id; });
  if (!event) return;
  var response = data.responses.find(function (row) { return row.kind === kind && Number(row.event_id) === id; });
  portalState.response = { player_id: portalState.playerId, kind: kind, event_id: id };
  $("portal-response-name").textContent = (event.title || event.opponent || t("Entrenamendua")) + " · " + portalDate(event.date);
  $("portal-response-value").value = response && response.response || "yes";
  $("portal-response-note").value = response && response.note || "";
  $("portal-response-note-details").open = Boolean(response && response.note);
  portalSyncAnswerButtons();
  portalError("portal-response-error", ""); $("portal-response-dialog").showModal();
}
function portalSyncAnswerButtons() {
  document.querySelectorAll("[data-portal-answer]").forEach(function (button) {
    button.setAttribute("aria-pressed", String(button.dataset.portalAnswer === $("portal-response-value").value));
  });
}

function portalCoachEvents() {
  var today = planKey(new Date());
  return sessions.map(function (s) { return { key: "session:" + s.id_saio, id: Number(s.id_saio), kind: "session", date: s.data_ordua, title: s.helburu_taktikoa || t("Entrenamendua") }; }).concat(matches.map(function (m) { return { key: "match:" + m.id_partida, id: Number(m.id_partida), kind: "match", date: m.data_ordua, title: m.aurkaria || t("Aurkaria") }; })).filter(function (event) { return String(event.date).slice(0, 10) >= today; }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
}
async function portalLoadCoach() {
  var currentTeam = teamId, sequence = ++portalState.coachSequence;
  portalState.coachTeam = currentTeam; portalError("portal-coach-error", "");
  $("portal-coach-content").innerHTML = portalEmpty("Kargatzen…");
  try {
    var result = await request({ action: "portal_coach_snapshot", team_id: currentTeam });
    if (sequence !== portalState.coachSequence || currentTeam !== teamId || !token) return;
    portalState.coachData = result; portalRenderCoach();
  } catch (error) { if (sequence === portalState.coachSequence && currentTeam === teamId) portalError("portal-coach-error", error.message); }
}
function portalCoachPlayer(id) { return players.find(function (p) { return Number(p.id_jokalaria) === Number(id); }); }
function portalRenderCoach() {
  var data = portalState.coachData, tab = portalState.coachTab; if (!data || portalState.coachTeam !== teamId) return;
  document.querySelectorAll("[data-coach-tab]").forEach(function (button) { button.setAttribute("aria-pressed", String(button.dataset.coachTab === tab)); });
  var html = '';
  if (tab === "accounts") {
    html = '<form class="card stack" id="portal-invite-form"><h2>' + esc(t("Jokalaria gonbidatu")) + '</h2><p class="muted">' + esc(t("Jokalariak kontua sortu behar du lehenik")) + '</p><label>' + esc(t("Jokalaria")) + '<select name="player_id" required><option value="">' + esc(t("Aukeratu")) + '</option>' + players.map(function (p) { return '<option value="' + Number(p.id_jokalaria) + '">' + esc(playerName(p)) + '</option>'; }).join("") + '</select></label><label>' + esc(t("Erabiltzaile-izena")) + '<input name="username" minlength="3" maxlength="200" autocomplete="off" required></label><button type="submit" class="btn">' + esc(t("Gonbidapena bidali")) + '</button></form><div class="card"><h2>' + esc(t("Jokalarien sarbideak")) + '</h2>';
    html += players.length ? players.map(function (p) {
      var linked = data.links.find(function (link) { return Number(link.player_id) === Number(p.id_jokalaria); }), invite = data.invites.find(function (i) { return Number(i.player_id) === Number(p.id_jokalaria); });
      return '<div class="portal-roster-row"><div><strong>' + esc(playerName(p)) + '</strong><small class="muted">' + esc(linked ? linked.username + ' · ' + t("Lotuta") : invite ? invite.username + ' · ' + t("Gonbidapena bidalita") : t("Konturik lotu gabe")) + '</small></div>' + (linked || invite ? '<button class="btn secondary" type="button" data-portal-revoke="' + Number(p.id_jokalaria) + '">' + esc(t(linked ? "Lotura kendu" : "Ezeztatu")) + '</button>' : '') + '</div>';
    }).join("") : portalEmpty("Ez dago jokalaririk. Gehitu lehenengo jokalaria.");
    html += '</div>';
  } else if (tab === "callups") {
    var games = portalCoachEvents().filter(function (event) { return event.kind === "match"; });
    if (!games.some(function (event) { return event.id === portalState.coachMatch; })) portalState.coachMatch = games.length ? games[0].id : 0;
    html = games.length ? '<div class="card"><h2>' + esc(t("Partidako deialdia")) + '</h2><label>' + esc(t("Partida")) + '<select id="portal-coach-match">' + games.map(function (g) { return '<option value="' + g.id + '"' + (g.id === portalState.coachMatch ? ' selected' : '') + '>' + esc(portalDate(g.date) + ' - ' + g.title) + '</option>'; }).join("") + '</select></label>' + portalMatchCallupForm(portalState.coachMatch, data, "portal-callup-form") + '</div>' : portalEmpty("Ez dago hurrengo partidarik. Sortu partida Lehiaketan edo Plangintzan.");
  } else if (tab === "notices") {
    html = '<form id="portal-notice-form" class="card stack"><h2>' + esc(t("Abisu berria")) + '</h2><label>' + esc(t("Izenburua")) + '<input name="title" maxlength="150" required></label><label>' + esc(t("Mezua")) + '<textarea name="body" maxlength="2000" required></textarea></label><button type="submit" class="btn">' + esc(t("Abisua argitaratu")) + '</button></form>' + data.notices.map(function (n) {
      return '<article class="card"><h3>' + esc(n.title) + '</h3><p class="portal-authored">' + esc(n.body) + '</p><p class="muted">' + esc(t("Irakurrita")) + ': ' + n.readers.length + '</p>' + (n.readers.length ? '<p class="muted">' + esc(n.readers.map(function (id) { var p = portalCoachPlayer(id); return p ? playerName(p) : t("Jokalaria"); }).join(', ')) + '</p>' : '') + '<button type="button" class="btn danger" data-portal-delete-notice="' + Number(n.id) + '">' + esc(t("Ezabatu")) + '</button></article>';
    }).join("");
  } else {
    var events = portalCoachEvents();
    if (!events.some(function (e) { return e.key === portalState.coachEvent; })) portalState.coachEvent = events.length ? events[0].key : "";
    var current = events.find(function (e) { return e.key === portalState.coachEvent; });
    html = '<div class="card"><h2>' + esc(t("Bertaratze-baieztapenak")) + '</h2><p class="muted">' + esc(t("Aurreikuspen hauek ez dute entrenamenduko benetako asistentzia aldatzen.")) + '</p>';
    html += current ? '<label>' + esc(t("Jarduera")) + '<select id="portal-coach-event">' + events.map(function (e) { return '<option value="' + esc(e.key) + '"' + (e.key === portalState.coachEvent ? ' selected' : '') + '>' + esc(t(e.kind === 'session' ? 'Entrenamendua' : 'Partida') + ' · ' + portalDate(e.date) + ' · ' + e.title) + '</option>'; }).join("") + '</select></label><div class="portal-response-roster">' + players.filter(function (p) { return current.kind === 'session' || data.callups.some(function (c) { return Number(c.match_id) === current.id && Number(c.player_id) === Number(p.id_jokalaria); }); }).map(function (p) {
      var response = data.responses.find(function (r) { return Number(r.player_id) === Number(p.id_jokalaria) && r.kind === current.kind && Number(r.event_id) === current.id; });
      return '<div class="portal-roster-row"><div><strong>' + esc(playerName(p)) + '</strong>' + (response && response.note ? '<small class="portal-authored">' + esc(response.note) + '</small>' : '') + '</div><span class="portal-response ' + (response ? response.response : '') + '">' + esc(portalResponseLabel(response && response.response)) + '</span></div>';
    }).join("") + '</div>' : portalEmpty("Ez dago hurrengo jarduerarik.");
    html += '<button type="button" class="btn secondary" data-portal-coach-refresh>' + esc(t("Birkargatu")) + '</button></div>';
  }
  $("portal-coach-content").innerHTML = html;
}
async function portalCoachMutation(payload, form) {
  if (form.inert) return;
  var eventForm = form.id === "portal-event-callup-form", errorId = eventForm ? "portal-event-error" : "portal-coach-error";
  form.inert = true; portalError(errorId, "");
  if (eventForm) { $("portal-event-close").disabled = true; $("portal-event-refresh").disabled = true; }
  try {
    await request(Object.assign({ team_id: teamId }, payload));
    if (eventForm) await portalLoadEventMatch(); else await portalLoadCoach();
    notify(t("Aldaketak gordeta"), "success");
  } catch (error) { portalError(errorId, error.message); }
  finally {
    form.inert = false;
    if (eventForm) { $("portal-event-close").disabled = false; $("portal-event-refresh").disabled = false; }
  }
}

window.PlayerPortal = { reset: portalReset, hide: portalHide, loadCoach: portalLoadCoach };
window.addEventListener("DOMContentLoaded", function () {
  $("login-mode").value = readStore(portalModeKey());
  $("open-player-mode").addEventListener("click", async function () { try { portalSetMode("player"); await portalShow(); } catch (error) { notify(error.message, "error"); } });
  $("portal-coach-mode").addEventListener("click", async function () { try { portalSetMode("coach"); portalHide(); await loadTeams(true); } catch (error) { notify(error.message, "error"); } });
  $("portal-logout").addEventListener("click", function () { $("logout").click(); });
  $("portal-refresh").addEventListener("click", async function () { try { await portalShow(); } catch (error) { portalError("portal-error", error.message); } });
  $("portal-team").addEventListener("change", function () { portalState.playerId = Number(this.value); portalLoadPlayer(); });
  document.querySelectorAll("[data-portal-tab]").forEach(function (button) { button.addEventListener("click", function () {
    if (button.dataset.portalTab === "agenda") { portalCalendarState.view = "calendar"; portalRenderAgenda(); }
    portalSetTab(button.dataset.portalTab);
  }); });
  document.querySelectorAll("[data-coach-tab]").forEach(function (button) { button.addEventListener("click", function () { portalState.coachTab = button.dataset.coachTab; portalRenderCoach(); }); });
  $("player-portal").addEventListener("click", async function (event) {
    var destination = event.target.closest("[data-portal-go]"), openEvent = event.target.closest("[data-portal-open-event]");
    if (destination) {
      if (destination.dataset.portalGo === "agenda") { portalCalendarState.view = "calendar"; portalRenderAgenda(); }
      portalSetTab(destination.dataset.portalGo); window.scrollTo(0, 0); return;
    }
    if (openEvent) {
      var key = openEvent.dataset.portalOpenEvent, activity = portalAgendaEvents().find(function (item) { return item.kind + ':' + item.row.id === key; });
      if (activity) { portalCalendarState.view = "calendar"; portalCalendarSelect(portalCalendarDate(activity.row.date.slice(0, 10))); portalRenderAgenda(); portalSetTab("agenda"); window.scrollTo(0, 0); }
      return;
    }
    var invite = event.target.closest("[data-portal-invite]"), read = event.target.closest("[data-portal-read]"), respond = event.target.closest("[data-portal-respond]");
    if (respond) { portalOpenResponse(respond.dataset.portalRespond); return; }
    var button = invite || read; if (!button || button.disabled) return;
    button.disabled = true; portalError("portal-error", "");
    try {
      if (invite) { await request({ action: "portal_invite_answer", id: Number(invite.dataset.portalInvite), accept: invite.dataset.accept === "true" }); await portalShow(); }
      else { await request({ action: "portal_read_notice", player_id: portalState.playerId, id: Number(read.dataset.portalRead) }); await portalLoadPlayer(); }
    } catch (error) { portalError("portal-error", error.message); }
    finally { button.disabled = false; }
  });
  $("portal-response-form").addEventListener("submit", async function (event) {
    event.preventDefault(); if (this.inert || !portalState.response) return;
    var form = this; form.inert = true; $("portal-response-close").disabled = true;
    portalError("portal-response-error", "");
    try {
      await request(Object.assign({ action: "portal_respond", response: $("portal-response-value").value, note: $("portal-response-note").value }, portalState.response));
      $("portal-response-dialog").close(); await portalLoadPlayer();
      if (window.InboxUI) window.InboxUI.refresh();
    } catch (error) { portalError("portal-response-error", error.message); }
    finally { form.inert = false; $("portal-response-close").disabled = false; }
  });
  document.querySelectorAll("[data-portal-answer]").forEach(function (button) { button.addEventListener("click", function () {
    $("portal-response-value").value = button.dataset.portalAnswer; portalSyncAnswerButtons();
  }); });
  $("portal-response-value").addEventListener("change", portalSyncAnswerButtons);
  $("portal-response-close").addEventListener("click", function () { if (!$("portal-response-form").inert) $("portal-response-dialog").close(); });
  $("portal-response-dialog").addEventListener("cancel", function (event) { if ($("portal-response-form").inert) event.preventDefault(); });
  $("portal-coach-content").addEventListener("change", function (event) {
    if (event.target.id === "portal-coach-match") { portalState.coachMatch = Number(event.target.value); portalRenderCoach(); }
    if (event.target.id === "portal-coach-event") { portalState.coachEvent = event.target.value; portalRenderCoach(); }
  });
  $("portal-coach-content").addEventListener("submit", function (event) {
    var form = event.target; event.preventDefault(); var fields = Object.fromEntries(new FormData(form));
    if (form.id === "portal-invite-form") portalCoachMutation({ action: "portal_invite", player_id: Number(fields.player_id), username: fields.username }, form);
    if (form.id === "portal-callup-form") portalCoachMutation(portalCallupPayload(form), form);
    if (form.id === "portal-notice-form") portalCoachMutation({ action: "portal_create_notice", title: fields.title, body: fields.body }, form);
  });
  $("portal-coach-content").addEventListener("click", function (event) {
    var revoke = event.target.closest("[data-portal-revoke]"), notice = event.target.closest("[data-portal-delete-notice]");
    if (event.target.closest("[data-portal-coach-refresh]")) { portalLoadCoach(); return; }
    if (revoke && window.confirm(t("Jokalariaren sarbidea kendu?"))) portalCoachMutation({ action: "portal_revoke", player_id: Number(revoke.dataset.portalRevoke) }, revoke);
    if (notice && window.confirm(t("Abisua ezabatu?"))) portalCoachMutation({ action: "portal_delete_notice", id: Number(notice.dataset.portalDeleteNotice) }, notice);
  });
  window.addEventListener("languagechange", function () {
    var restore = languageDraft(); portalRenderPlayer(); portalRenderCoach(); restore();
  });
});
