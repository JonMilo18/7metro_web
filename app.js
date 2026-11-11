"use strict";

var DEFAULT_API_URL = "https://txkjflrtoziscqcytpbc.supabase.co";
var DEFAULT_API_KEY = "sb_publishable_R2yjFvK-Z7ezWbXVi2KqmA_dzox4-pd";
var t = window.I18n.t;
var $ = function (id) { return document.getElementById(id); };
var readStore = function (key) {
  try { return localStorage.getItem(key) || ""; }
  catch (error) { console.error(t("Ezin izan da tokiko biltegia irakurri"), error); return ""; }
};
// Supabase connection details are deployment configuration, not account
// settings. Keep them internal so users cannot alter the app endpoint.
var apiBase = DEFAULT_API_URL;
var apiKey = DEFAULT_API_KEY;
try {
  localStorage.removeItem("7metro-supabase-url");
  localStorage.removeItem("7metro-supabase-key");
} catch (error) { console.error(t("Ezin izan da konexio-ezarpen zaharrak garbitu"), error); }
var token = readStore("7metro-supabase-token");
var userName = readStore("7metro-username");
var user = userName ? { izena: userName } : null, teamId = Number(readStore("7metro-team-id")) || 0, team = null;
var teams = [], tables = {}, players = [], exercises = [], sessions = [], matches = [];
var macros = [], micros = [], playerStats = [], toastTimer, installPrompt = null;
var loadingCount = 0, loadingDelay = 0;
var boardState = { fondo: "Zelaia", posizioak: {}, marrazkiak: [], animazioa: [] };
var boardTool = "move", boardSelection = null, boardPointer = null, boardImages = {};
var boardCurve = 0;
var boardFrameIndex = -1, boardAnimationRaf = 0;
var previewAnimation = null, previewAnimationFrame = 0;
var sessionView = { ids: [], index: 0, raf: 0 };
var sessionViewReturn = "v-sessions";
var sessionSelection = [];
var activeSessionGroup = null;
var sessionDragState = null;
var sessionCategoryFilter = "";
var planMonth = new Date();
planMonth.setDate(1);
var planView = window.matchMedia("(max-width: 680px)").matches ? "agenda" : "month";
var planFormContext = null;
var PLAN_MONTHS = ["Urtarrila", "Otsaila", "Martxoa", "Apirila", "Maiatza", "Ekaina",
  "Uztaila", "Abuztua", "Iraila", "Urria", "Azaroa", "Abendua"];
var MACRO_PALETTE = ["#0044EE", "#12399C", "#315FC8", "#0A2260",
  "#1E52C7", "#0038D1", "#526FBA", "#163FBA"];
var MICRO_TYPE_COLORS = {
  "Egokitzapena": "#1E52C7", "Karga": "#0044EE", "Inpaktua": "#12399C",
  "Aktibazioa": "#315FC8", "Lehia": "#0A2260", "Berreskurapena": "#526FBA"
};
var MICRO_TYPES = Object.keys(MICRO_TYPE_COLORS);

function notify(message, type) {
  var box = $("toast");
  box.textContent = t(message);
  box.className = "notice" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { box.classList.add("hidden"); }, 5000);
}

function loadingStart() {
  loadingCount++;
  if (loadingCount !== 1) return;
  clearTimeout(loadingDelay);
  loadingDelay = setTimeout(function () {
    if (loadingCount > 0) $("loading-indicator").hidden = false;
  }, 140);
}

function loadingEnd() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount !== 0) return;
  clearTimeout(loadingDelay);
  $("loading-indicator").hidden = true;
}

function saveLocal(key, value) {
  try { localStorage.setItem(key, value); }
  catch (error) {
    console.error(t("Ezin izan da tokiko datua gorde"), error);
    throw new Error(t("Ezin izan dira saio-datuak gorde nabigatzailean"));
  }
}

function setColorTheme(theme, persist) {
  var mode = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
  var themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = mode === "light" ? "#FFFFFF" : "#060E1A";
  ["light", "dark"].forEach(function (option) {
    var button = $("theme-" + option);
    if (button) button.setAttribute("aria-pressed", String(option === mode));
  });
  if (persist) {
    try { localStorage.setItem("7metro-theme", mode); }
    catch (error) { console.error(t("Ezin izan da itxura gordeta utzi"), error); }
  }
}

setColorTheme(readStore("7metro-theme") || "dark", false);

// Re-render interface messages in place while preserving every unfinished form.
function languageDraft() {
  var fields = Array.from(document.querySelectorAll("input,select,textarea")).map(function (field) {
    var path = [], node = field;
    while (node && !node.id) {
      var siblings = Array.from(node.parentElement.children).filter(function (sibling) { return sibling.tagName === node.tagName; });
      path.unshift(node.tagName.toLowerCase() + ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")");
      node = node.parentElement;
    }
    return { selector: "#" + CSS.escape(node.id) + (path.length ? ">" + path.join(">") : ""),
      value: field.value, checked: field.checked, disabled: field.disabled };
  });
  return function () {
    fields.forEach(function (saved) {
      var field = document.querySelector(saved.selector);
      if (!field) return;
      field.value = saved.value;
      if ("checked" in field) field.checked = saved.checked;
      field.disabled = saved.disabled;
    });
  };
}

window.addEventListener("languagechange", function () {
  var restore = languageDraft(), scrollX = window.scrollX, scrollY = window.scrollY;
  var editor = $("match-edit-form"), editingMatch = editor && editor.dataset.matchEditId;
  stopExerciseAnimation(); stopBoardAnimation();
  renderPlayers(); renderExercises(); renderSessions(); renderMatches(); renderCycles(); renderDashboard();
  renderFriends(); renderTeamInvitations();
  if ($("v-session-detail").dataset.sessionId) renderSavedSession($("v-session-detail").dataset.sessionId);
  if (editingMatch) renderMatchEditor(editingMatch, false);
  if (planFormContext) openPlanForm(planFormContext.kind, planFormContext.id);
  renderSessionBoard(); renderShotGoalZones(); updateBoardAnimationControls();
  restore();
  renderStats(); updateSessionTimeBar(); updateShareExerciseCount(); scoreRender(); drawShotCanvases();
  $("score-save-status").textContent = scoreboard.savedMatchId ? t("Partida gordeta dago.") : t("Oraindik ez da gorde.");
  $("shot-record").textContent = shotTargetEvent ? t("Kokapena gorde") : t("Jaurtiketa erregistratu");
  $("shot-context").textContent = shotTargetEvent ? t("Kokapena gehitu: ") + scoreEventText(shotTargetEvent) : t("Jaurtiketa berria");
  $("install-status").textContent = standalone ? t("Instalatuta erabiltzen ari zara") : t("Arakatzailetik erabiltzen ari zara");
  $("score-fullscreen").querySelector(".score-fullscreen-label").textContent = scoreMatchMode ? t("Irten") : t("Partida modua");
  $("score-fullscreen").setAttribute("aria-label", scoreMatchMode ? t("Partida modutik irten") : t("Pantaila osoko partida modua ireki"));
  $("session-preview-play").textContent = t("Animazioa ikusi");
  clearTimeout(toastTimer); $("toast").classList.add("hidden");
  setMobileMenu($("nav").classList.contains("menu-open"));
  window.scrollTo(scrollX, scrollY);
});

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function endpoint() {
  var parsed;
  try { parsed = new URL(apiBase); }
  catch (error) { throw new Error(t("Supabase proiektuaren URL-a ez da baliozkoa")); }
  if (parsed.protocol !== "https:") throw new Error(t("Supabase proiektuaren URL-ak HTTPS erabili behar du"));
  return parsed.toString().replace(/\/+$/, "") + "/functions/v1/metro-api";
}

async function request(payload, anonymous) {
  loadingStart();
  try { return await requestImpl(payload, anonymous); }
  finally { loadingEnd(); }
}

async function requestImpl(payload, anonymous) {
  var headers = { "Accept": "application/json", "Content-Type": "application/json", "apikey": apiKey };
  if (token && !anonymous) headers["x-7metro-session"] = token;
  var response;
  try {
    response = await fetch(endpoint(), {
      method: "POST", headers: headers, body: JSON.stringify(payload), cache: "no-store"
    });
  } catch (error) {
    throw new Error(t("Ezin da Supabasera konektatu. Egiaztatu Interneteko konexioa eta proiektuaren URL-a."));
  }
  var result;
  try { result = await response.json(); }
  catch (error) {
    if (response.ok) throw new Error(t("Supabasek JSON erantzun baliogabea bidali du"));
    result = {};
  }
  if (response.status === 401 && token && !anonymous) {
    token = "";
    user = null;
    localStorage.removeItem("7metro-supabase-token");
    localStorage.removeItem("7metro-username");
    showLogin();
    throw new Error(t("Online saioa iraungi da; hasi saioa berriro"));
  }
  if (!response.ok) {
    if (payload.action === "pwa_create_match" && /usuario o contrase(?:ñ|Ã±)a no v[aá]lidos/i.test(String(result.error || ""))) {
      throw new Error(t("Supabaseko metro-api zaharkituta dago eta ez du markagailutik gordetzea onartzen. Backendaren eguneraketa argitaratu behar da."));
    }
    throw new Error(I18n.serverMessage(result.error) || (t("Supabase errorea (") + response.status + ")"));
  }
  return result;
}

function showLogin() {
  if (scoreMatchMode) scoreExitMatchMode();
  token = "";
  setMobileMenu(false);
  $("mobile-menu-toggle").hidden = true;
  $("workspace").classList.add("hidden");
  $("nav").classList.add("hidden");
  $("account").textContent = "";
  $("v-login").classList.add("on");
}

function showTeamPicker() {
  if (scoreMatchMode) scoreExitMatchMode();
  setMobileMenu(false);
  $("mobile-menu-toggle").hidden = true;
  $("workspace").classList.remove("hidden");
  $("team-picker").classList.remove("hidden");
  $("team-app").classList.add("hidden");
  $("nav").classList.add("hidden");
  $("v-login").classList.remove("on");
  $("account").textContent = user ? user.izena : "";
  $("team-select").innerHTML = teams.map(function (item) {
    return '<option value="' + Number(item.id_taldea) + '">' + esc(item.izena) + (item._role === "owner" ? t(" · Jabea") : t(" · Kidea")) + "</option>";
  }).join("");
  loadTeamInvitations();
  if (teams.some(function (item) { return Number(item.id_taldea) === teamId; })) {
    $("team-select").value = String(teamId);
  }
  $("open-team").disabled = teams.length === 0;
  updateTeamManagementControls();
}

function selectedTeamForManagement() {
  return teams.find(function (item) { return Number(item.id_taldea) === Number($("team-select").value); }) || null;
}

function updateTeamManagementControls() {
  var selected = selectedTeamForManagement(), isOwner = Boolean(selected && selected._role === "owner");
  $("rename-team").disabled = !isOwner;
  $("delete-team").disabled = !isOwner;
  $("team-management-note").hidden = !selected || isOwner;
}

var teamInvitations = null;

function renderTeamInvitations() {
  if (!teamInvitations) return;
  document.querySelectorAll("[data-team-invitations]").forEach(function (list) {
    var invitations = teamInvitations;
    list.innerHTML = invitations.length ? invitations.map(function (item) {
      var teamName = item.taldeak && item.taldeak.izena || t("Taldea");
      return '<li class="item"><div class="item-main"><strong>' + esc(teamName) + ("</strong><small>" + esc(t("Taldean sartzeko gonbidapena")) + "</small></div><button class=\"btn secondary\" type=\"button\" data-team-invitation=\"accept\" data-id=\"") + Number(item.id) + ("\">" + esc(t("Onartu")) + "</button><button class=\"btn danger\" type=\"button\" data-team-invitation=\"reject\" data-id=\"") + Number(item.id) + ("\">" + esc(t("Baztertu")) + "</button></li>");
    }).join("") : ("<li class=\"empty\">" + esc(t("Ez duzu talde-gonbidapenik.")) + "</li>");
  });
}

async function loadTeamInvitations() {
  var lists = document.querySelectorAll("[data-team-invitations]");
  var list = { set innerHTML(value) { lists.forEach(function (element) { element.innerHTML = value; }); } };
  list.innerHTML = ("<li class=\"empty\">" + esc(t("Gonbidapenak kargatzen…")) + "</li>");
  try {
    var result = await request({ action: "team_invitations" });
    var invitations = result.invitations || [];
    teamInvitations = invitations;
    renderTeamInvitations();
  } catch (error) {
    list.innerHTML = '<li class="notice error">' + esc(error.message) + '</li>';
  }
}

async function ensureActiveTeam() {
  if (teamId && teams.some(function (item) { return Number(item.id_taldea) === teamId; })) {
    await openTeam(teamId);
    return;
  }
  if (teams.length) {
    await openTeam(teams[0].id_taldea);
    return;
  }
  var name = user && user.izena && user.izena !== "Online" ? user.izena.trim() : "";
  if (name.length < 2) name = "Nire taldea";
  var result = await request({ action: "team_create", name: name });
  team = result.team;
  teams.push(team);
  await openTeam(team.id_taldea);
}

async function loadTeams(autoOpen) {
  var result = await request({ action: "teams_list" });
  teams = (result.teams || []).map(function (membership) {
    return Object.assign({}, membership.taldeak, { _role: membership.role });
  }).filter(function (item) { return item && item.id_taldea; });
  if (!teams.some(function (item) { return Number(item.id_taldea) === teamId; })) teamId = 0;
  if (autoOpen === false) { showTeamPicker(); return; }
  try { await ensureActiveTeam(); }
  catch (error) { showTeamPicker(); notify(error.message, "error"); }
}

async function openTeam(id) {
  var selected = teams.find(function (item) { return Number(item.id_taldea) === Number(id); });
  if (!selected) throw new Error(t("Aukeratutako taldea ez da aurkitu"));
  team = selected;
  teamId = Number(selected.id_taldea);
  await refreshAll();
  scoreRead();
  scoreRender();
  loadFriends();
  saveLocal("7metro-team-id", String(teamId));
  $("workspace").classList.remove("hidden");
  $("v-login").classList.remove("on");
  $("team-picker").classList.add("hidden");
  $("team-app").classList.remove("hidden");
  $("nav").classList.remove("hidden");
  $("mobile-menu-toggle").hidden = false;
  setMobileMenu(false);
  $("nav").setAttribute("aria-hidden", "false");
  $("nav").inert = false;
  $("account").textContent = (user ? user.izena + " · " : "") + selected.izena;
  selectSection("v-home");
}

function localDateTime() {
  var date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function numberOrNull(value) { return value === "" ? null : Number(value); }
function playerName(player) { return [player.izena, player.abizena].filter(Boolean).join(" "); }
function formatDate(record) { return String(record.data_ordua || "").replace("T", " "); }
function formatDay(record) {
  var value = String(record.data_ordua || "").slice(0, 10);
  var parts = value.split("-");
  if (parts.length !== 3 || parts.some(function (part) { return !/^\d+$/.test(part); })) return value;
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).toLocaleDateString(I18n.locale());
}

function records(name) { return Array.isArray(tables[name]) ? tables[name] : []; }
function byPlayer(rows, id) {
  return rows.filter(function (row) { return Number(row.id_jokalaria) === Number(id); });
}

function parseBoardData(value) {
  if (!value) return null;
  try {
    var data = typeof value === "string" ? JSON.parse(value) : value;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return {
      fondo: data.fondo === "Zelai-erdia" ? "Zelai-erdia" : "Zelaia",
      posizioak: data.posizioak && typeof data.posizioak === "object"
        ? data.posizioak : (data.pos && typeof data.pos === "object" ? data.pos : {}),
      marrazkiak: Array.isArray(data.marrazkiak) ? data.marrazkiak : [],
      animazioa: Array.isArray(data.animazioa) ? data.animazioa : []
    };
  } catch (error) {
    console.error(t("Ezin izan dira arbelaren datuak irakurri"), error);
    return null;
  }
}

function drawBoard(canvas, state, selection) {
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var width = canvas.width, height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  var background = boardImages[state.fondo];
  if (background && background.complete && background.naturalWidth) {
    ctx.drawImage(background, 0, 0, width, height);
  } else {
    ctx.fillStyle = "#397b47";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(255,255,255,.82)";
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.strokeRect(14, 14, width - 28, height - 28);
    ctx.beginPath();
    ctx.moveTo(width / 2, 14);
    ctx.lineTo(width / 2, height - 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 62, 0, Math.PI * 2);
    ctx.setLineDash([9, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.save();
  ctx.scale(width / 800, height / 500);
  (state.marrazkiak || []).forEach(function (shape, index) {
    if (!shape || !Array.isArray(shape.coords) || shape.coords.length < 2 ||
        !shape.coords.every(Number.isFinite)) return;
    var coords = shape.coords, type = shape.type;
    var strokeColor = "#000";
    var fillColor = "#000";
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = fillColor;
    ctx.lineWidth = Math.max(1, Number(shape.width) || 3);
    var dashParts = String(shape.dash || "").match(/\d+/g);
    ctx.setLineDash(dashParts ? dashParts.map(Number) : []);
    ctx.beginPath();
    if (type === "line" && coords.length >= 4) {
      traceBoardLine(ctx, shape);
      ctx.stroke();
      var end = coords.length - 2;
      if (shape.arrow === "last" || shape.arrow === "both") {
        drawBoardArrow(ctx, coords[end], coords[end + 1], coords[end - 2], coords[end - 1]);
      }
      if (shape.arrow === "first" || shape.arrow === "both") {
        drawBoardArrow(ctx, coords[0], coords[1], coords[2], coords[3]);
      }
    } else if (type === "polygon") {
      ctx.moveTo(coords[0], coords[1]);
      for (var p = 2; p + 1 < coords.length; p += 2) ctx.lineTo(coords[p], coords[p + 1]);
      ctx.closePath();
      if (shape.fill) { ctx.fillStyle = "#000"; ctx.fill(); }
      ctx.strokeStyle = "#000";
      ctx.stroke();
    } else if (type === "rectangle" || type === "oval") {
      var x = Math.min(coords[0], coords[2]), y = Math.min(coords[1], coords[3]);
      var w = Math.abs(coords[2] - coords[0]), h = Math.abs(coords[3] - coords[1]);
      if (type === "rectangle") ctx.strokeRect(x, y, w, h);
      else { ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2); ctx.stroke(); }
    } else if (type === "text") {
      ctx.setLineDash([]);
      ctx.font = "600 16px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(shape.text || ""), coords[0], coords[1], 220);
    }
    ctx.setLineDash([]);
    if (selection && selection.kind === "drawing" && selection.index === index) {
      ctx.strokeStyle = "#ffe14a";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      var bounds = boardShapeBounds(coords);
      ctx.strokeRect(bounds.left - 7, bounds.top - 7, bounds.right - bounds.left + 14, bounds.bottom - bounds.top + 14);
      ctx.setLineDash([]);
    }
  });
  Object.keys(state.posizioak || {}).forEach(function (tag) {
    var position = state.posizioak[tag];
    if (!position || !Number.isFinite(Number(position.x)) || !Number.isFinite(Number(position.y))) return;
    var x = Number(position.x), y = Number(position.y), color = "#1f538d", label = "";
    if (/^g\d/.test(tag)) color = "#8d1f1f";
    else if (/^h\d/.test(tag)) color = "#d4af00";
    else if (tag.indexOf("baloia") === 0) color = "#d4af37";
    else if (tag.indexOf("poste_") === 0) color = "#ff8c00";
    else if (tag.indexOf("maniku_") === 0) color = "#777";
    else if (tag.indexOf("disko_") === 0) color = "#2ecc71";
    label = tag.match(/^(?:u|g|h)(\d+)$/)?.[1] || "";
    if (tag.indexOf("poste_") === 0) {
      var selectedCone = selection && selection.kind === "token" && selection.tag === tag;
      var coneScale = selectedCone ? 1.18 : 1;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(coneScale, coneScale);
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(8, 8);
      ctx.lineTo(12, 12);
      ctx.lineTo(-12, 12);
      ctx.lineTo(-8, 8);
      ctx.closePath();
      ctx.fillStyle = "#ff8c00";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-7, 5);
      ctx.lineTo(7, 5);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      return;
    }
    var radius = tag.indexOf("baloia") === 0 ? 8 : 15;
    ctx.beginPath();
    ctx.arc(x, y, radius + (selection && selection.kind === "token" && selection.tag === tag ? 4 : 0), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (label) {
      ctx.fillStyle = "white";
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x, y);
    } else if (/^(poste|maniku|disko)_/.test(tag)) {
      ctx.fillStyle = tag.indexOf("disko") === 0 ? "#102010" : "white";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tag.indexOf("poste") === 0 ? "P" : tag.indexOf("maniku") === 0 ? "M" : "D", x, y);
    }
  });
  ctx.restore();
}

function boardShapeBounds(coords) {
  var xs = coords.filter(function (_, i) { return i % 2 === 0; });
  var ys = coords.filter(function (_, i) { return i % 2 === 1; });
  return { left: Math.min.apply(null, xs), right: Math.max.apply(null, xs),
    top: Math.min.apply(null, ys), bottom: Math.max.apply(null, ys) };
}

function traceBoardLine(ctx, shape) {
  var c = shape.coords, curved = shape.smooth && !/^(0|false)$/i.test(String(shape.smooth));
  ctx.moveTo(c[0], c[1]);
  if (curved && c.length >= 6) {
    for (var i = 2; i < c.length - 2; i += 2) {
      var last = i === c.length - 4;
      ctx.quadraticCurveTo(c[i], c[i + 1], last ? c[i + 2] : (c[i] + c[i + 2]) / 2,
        last ? c[i + 3] : (c[i + 1] + c[i + 3]) / 2);
    }
  } else {
    for (var j = 2; j + 1 < c.length; j += 2) ctx.lineTo(c[j], c[j + 1]);
  }
}

function drawBoardArrow(ctx, x, y, previousX, previousY) {
  var angle = Math.atan2(y - previousY, x - previousX);
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x, y);
  ctx.lineTo(x - 16 * Math.cos(angle - Math.PI / 6), y - 16 * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x - 16 * Math.cos(angle + Math.PI / 6), y - 16 * Math.sin(angle + Math.PI / 6));
  ctx.closePath(); ctx.fill();
}

function curveBoardLine(shape, amount) {
  var c = shape.coords, x = c[0], y = c[1], endX = c[c.length - 2], endY = c[c.length - 1];
  var dx = endX - x, dy = endY - y, length = Math.hypot(dx, dy) || 1;
  shape.coords = amount ? [x, y, (x + endX) / 2 - dy / length * amount,
    (y + endY) / 2 + dx / length * amount, endX, endY] : [x, y, endX, endY];
  shape.smooth = Boolean(amount);
}

function syncBoardCurveControl() {
  var shape = boardSelection && boardSelection.kind === "drawing" && boardState.marrazkiak[boardSelection.index];
  if (shape && shape.type === "line") {
    var c = shape.coords, dx = c[c.length - 2] - c[0], dy = c[c.length - 1] - c[1];
    boardCurve = c.length === 6 && shape.smooth && !/^(0|false)$/i.test(String(shape.smooth))
      ? Math.round(((c[2] - (c[0] + c[4]) / 2) * -dy + (c[3] - (c[1] + c[5]) / 2) * dx) / (Math.hypot(dx, dy) || 1)) : 0;
  }
  $("board-curve").value = String(boardCurve);
  $("board-curve-value").textContent = String(boardCurve);
}

function redrawBoard() {
  syncBoardCurveControl();
  drawBoard($("exercise-board"), boardState, boardSelection);
}

function loadBoardBackgrounds() {
  [["Zelaia", "./irudiak/Zelaia.png"], ["Zelai-erdia", "./irudiak/Zelai-erdia.png"]]
    .forEach(function (entry) {
      var image = new Image();
      image.onload = function () {
        redrawBoard();
        renderExercises();
        if (sessionView.ids.length) drawSessionBoard();
      };
      image.onerror = function (error) {
        console.error(t("Ezin izan da programako kantxaren irudia kargatu: ") + entry[1], error);
      };
      image.src = entry[1];
      boardImages[entry[0]] = image;
    });
}

function boardPoint(event) {
  var rect = $("exercise-board").getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(800, (event.clientX - rect.left) * 800 / rect.width)),
    y: Math.max(0, Math.min(500, (event.clientY - rect.top) * 500 / rect.height))
  };
}

function boardHit(point) {
  var keys = Object.keys(boardState.posizioak);
  for (var i = keys.length - 1; i >= 0; i--) {
    var pos = boardState.posizioak[keys[i]];
    if (Math.hypot(point.x - Number(pos.x), point.y - Number(pos.y)) < 24) {
      return { kind: "token", tag: keys[i] };
    }
  }
  for (var j = boardState.marrazkiak.length - 1; j >= 0; j--) {
    var coords = boardState.marrazkiak[j].coords || [];
    if (coords.length >= 2) {
      var bounds = boardShapeBounds(coords);
      if (point.x >= bounds.left - 10 && point.x <= bounds.right + 10 && point.y >= bounds.top - 10 && point.y <= bounds.bottom + 10) {
        return { kind: "drawing", index: j };
      }
    }
  }
  return null;
}

function addBoardToken(prefix, point) {
  var max = prefix === "u" || prefix === "g" || prefix === "h" ? 7 : 30;
  var matcher = prefix === "baloia" ? /^baloia_(\d+)$/ : new RegExp("^" + prefix + "_?(\\d+)$");
  var highest = Object.keys(boardState.posizioak).reduce(function (value, tag) {
    var match = tag.match(matcher);
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  if (highest >= max) {
    notify(t("Ezin dira mota honetako elementu gehiago gehitu"), "error");
    return;
  }
  var tag = prefix === "baloia" ? "baloia_" + (highest + 1)
    : (prefix === "u" || prefix === "g" || prefix === "h" ? prefix + (highest + 1) : prefix + "_" + (highest + 1));
  boardState.posizioak[tag] = { x: point.x, y: point.y };
  boardSelection = { kind: "token", tag: tag };
  redrawBoard();
}

function makeBoardShape(start, end, tool) {
  var shape = {
    type: tool === "rectangle" || tool === "oval" ? tool : "line",
    coords: [start.x, start.y, end.x, end.y],
    fill: "#ffffff",
    width: 3
  };
  if (tool === "dashed") shape.dash = "8 6";
  if (tool === "arrow") shape.arrow = "last";
  if (shape.type === "line") curveBoardLine(shape, boardCurve);
  return shape;
}

function finishBoardShape(start, end, tool) {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 4) return;
  boardState.marrazkiak.push(makeBoardShape(start, end, tool));
  boardSelection = { kind: "drawing", index: boardState.marrazkiak.length - 1 };
  redrawBoard();
}

function boardPointerDown(event) {
  if (event.button !== 0) return;
  stopBoardAnimation();
  event.preventDefault();
  var point = boardPoint(event);
  var tool = boardTool;
  if (["u", "g", "h", "baloia", "poste", "maniku", "disko"].includes(tool)) {
    addBoardToken(tool, point);
    return;
  }
  if (tool === "text") {
    var text = prompt(t("Idatzi arbelan agertuko den testua:"));
    if (text && text.trim()) {
      boardState.marrazkiak.push({ type: "text", coords: [point.x, point.y], text: text.trim(), fill: "#ffffff" });
      boardSelection = { kind: "drawing", index: boardState.marrazkiak.length - 1 };
      redrawBoard();
    }
    return;
  }
  if (tool === "move") {
    boardSelection = boardHit(point);
    boardPointer = boardSelection ? { point: point, id: event.pointerId } : null;
    redrawBoard();
    if (boardPointer) $("exercise-board").setPointerCapture(event.pointerId);
    return;
  }
  boardPointer = { point: point, id: event.pointerId, tool: tool };
  $("exercise-board").setPointerCapture(event.pointerId);
}

function boardPointerMove(event) {
  if (!boardPointer || boardPointer.id !== event.pointerId) return;
  var point = boardPoint(event), dx = point.x - boardPointer.point.x, dy = point.y - boardPointer.point.y;
  if (boardPointer.tool) {
    var preview = Object.assign({}, boardState, {
      marrazkiak: boardState.marrazkiak.concat([makeBoardShape(boardPointer.point, point, boardPointer.tool)])
    });
    drawBoard($("exercise-board"), preview, null);
  } else if (boardSelection && boardSelection.kind === "token") {
    var pos = boardState.posizioak[boardSelection.tag];
    pos.x = Math.max(10, Math.min(790, pos.x + dx));
    pos.y = Math.max(10, Math.min(490, pos.y + dy));
    boardPointer.point = point;
    redrawBoard();
  } else if (boardSelection && boardSelection.kind === "drawing") {
    var coords = boardState.marrazkiak[boardSelection.index].coords;
    for (var i = 0; i < coords.length; i += 2) { coords[i] += dx; coords[i + 1] += dy; }
    boardPointer.point = point;
    redrawBoard();
  }
}

function boardPointerUp(event) {
  if (!boardPointer || boardPointer.id !== event.pointerId) return;
  if (boardPointer.tool) finishBoardShape(boardPointer.point, boardPoint(event), boardPointer.tool);
  boardPointer = null;
}

function captureBoardFrame() {
  var frame = JSON.parse(JSON.stringify(boardState.posizioak));
  boardState.marrazkiak.forEach(function (drawing, index) {
    var props = Object.assign({}, drawing);
    delete props.coords;
    frame["dib_" + index] = { coords: drawing.coords.slice(), props: props };
  });
  return frame;
}

function prepareBoardForSave() {
  // Keep the last edited position when the user saves after moving a step.
  if (!boardState.animazioa.length) return;
  var current = captureBoardFrame();
  var last = boardState.animazioa[boardState.animazioa.length - 1];
  if (JSON.stringify(current) !== JSON.stringify(last)) {
    boardState.animazioa.push(current);
    boardFrameIndex = boardState.animazioa.length - 1;
    updateBoardAnimationControls();
  }
}

function updateBoardAnimationControls() {
  var frames = boardState.animazioa;
  $("board-frames").innerHTML = ("<option value=\"-1\">" + esc(t("Uneko arbela")) + "</option>") + frames.map(function (_, index) {
    return '<option value="' + index + '">' + (index + 1) + (esc(t(". pausoa")) + "</option>");
  }).join("");
  $("board-frames").value = String(boardFrameIndex);
  $("board-frame-update").disabled = boardFrameIndex < 0;
  $("board-frame-delete").disabled = boardFrameIndex < 0;
  $("board-animation-play").disabled = frames.length < 2;
  $("board-animation-status").textContent = frames.length + t(" pauso gordeta. Animazioa sortzeko gutxienez 2 behar dira.");
}

function stopBoardAnimation() {
  cancelAnimationFrame(boardAnimationRaf);
  boardAnimationRaf = 0;
  $("board-animation-play").textContent = t("Animazioa ikusi");
  redrawBoard();
}

function playBoardAnimation() {
  if (boardAnimationRaf) { stopBoardAnimation(); return; }
  if (boardState.animazioa.length < 2) return;
  boardPointer = null;
  var started;
  $("board-animation-play").textContent = t("Gelditu");
  function animate(timestamp) {
    if (started == null) started = timestamp;
    var elapsed = (timestamp - started) / 650;
    var index = Math.floor(elapsed), last = boardState.animazioa.length - 1;
    if (index >= last) { stopBoardAnimation(); return; }
    drawBoard($("exercise-board"), interpolateAnimationFrames(
      boardState.animazioa[index], boardState.animazioa[index + 1], elapsed - index, boardState.fondo
    ), null);
    boardAnimationRaf = requestAnimationFrame(animate);
  }
  boardAnimationRaf = requestAnimationFrame(animate);
}

function resetBoard() {
  stopBoardAnimation();
  boardFrameIndex = -1;
  boardCurve = 0;
  boardState = { fondo: $("board-background").value, posizioak: {}, marrazkiak: [], animazioa: [] };
  boardSelection = null;
  updateBoardAnimationControls();
  redrawBoard();
}

function animationFrameState(frame, fondo) {
  var state = { fondo: fondo, posizioak: {}, marrazkiak: [], animazioa: [] };
  if (!frame || typeof frame !== "object") return state;
  Object.keys(frame).forEach(function (tag) {
    var value = frame[tag];
    if (!value || typeof value !== "object") return;
    if (tag.indexOf("dib_") === 0 && Array.isArray(value.coords)) {
      var props = value.props || {};
      state.marrazkiak.push({
        type: props.type,
        smooth: props.smooth,
        splinesteps: props.splinesteps,
        coords: value.coords,
        fill: props.fill,
        outline: props.outline,
        width: props.width,
        dash: props.dash,
        arrow: props.arrow,
        text: props.text
      });
    } else if (Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y))) {
      state.posizioak[tag] = { x: Number(value.x), y: Number(value.y) };
    }
  });
  return state;
}

function interpolateAnimationFrames(start, end, progress, fondo) {
  var from = animationFrameState(start, fondo), to = animationFrameState(end, fondo);
  var state = { fondo: fondo, posizioak: {}, marrazkiak: [], animazioa: [] };
  Object.keys(from.posizioak).forEach(function (tag) {
    if (!to.posizioak[tag]) {
      if (progress < 1) state.posizioak[tag] = from.posizioak[tag];
      return;
    }
    state.posizioak[tag] = {
      x: from.posizioak[tag].x + (to.posizioak[tag].x - from.posizioak[tag].x) * progress,
      y: from.posizioak[tag].y + (to.posizioak[tag].y - from.posizioak[tag].y) * progress
    };
  });
  if (progress >= 1) Object.keys(to.posizioak).forEach(function (tag) {
    state.posizioak[tag] = to.posizioak[tag];
  });
  var count = Math.max(from.marrazkiak.length, to.marrazkiak.length);
  for (var i = 0; i < count; i++) {
    var first = from.marrazkiak[i], last = to.marrazkiak[i];
    if (first && last && first.type === last.type &&
        first.coords.length === last.coords.length && progress < 1) {
      state.marrazkiak.push(Object.assign({}, last, {
        coords: last.coords.map(function (coord, index) {
          return first.coords[index] + (coord - first.coords[index]) * progress;
        })
      }));
    } else if (progress >= 1 ? last : first) {
      state.marrazkiak.push(progress >= 1 ? last : first);
    }
  }
  return state;
}

function stopExerciseAnimation(finalState) {
  if (previewAnimation && previewAnimation.raf) cancelAnimationFrame(previewAnimation.raf);
  if (previewAnimation) {
    var animation = previewAnimation, canvas = animation.canvas;
    canvas.width = animation.width;
    canvas.height = animation.height;
    if (animation.container) animation.container.classList.remove("animation-playing");
    if (animation.button) {
      animation.button.textContent = t("Animazioa ikusi");
      animation.button.setAttribute("aria-label", t("Animazioa ikusi"));
    }
    if (animation.board) drawBoard(canvas, finalState || animation.board, null);
  }
  previewAnimation = null;
  previewAnimationFrame = 0;
  document.querySelectorAll("[data-play-exercise]").forEach(function (button) {
    button.textContent = t("Animazioa ikusi");
    button.setAttribute("aria-label", t("Animazioa ikusi"));
  });
}

function playExerciseAnimation(id, targetCanvas, targetButton) {
  var exercise = exercises.find(function (item) { return Number(item.id_ariketa) === Number(id); });
  var board = exercise && parseBoardData(exercise.arbela_datuak);
  var canvas = targetCanvas || document.querySelector('[data-board-preview="' + Number(id) + '"]');
  if (!board || board.animazioa.length < 2 || !canvas) {
    notify(t("Ariketa honek ez du erreproduzitzeko animaziorik"), "error");
    return;
  }
  stopExerciseAnimation();
  var button = targetButton || document.querySelector('[data-play-exercise="' + Number(id) + '"]');
  var container = canvas.closest(".item");
  if (container) container.classList.add("animation-playing");
  previewAnimation = { id: Number(id), board: board, canvas: canvas, button: button,
    container: container, width: canvas.width, height: canvas.height, frame: 0, raf: 0 };
  canvas.width = 800;
  canvas.height = 500;
  if (button) {
    button.textContent = t("Gelditu");
    button.setAttribute("aria-label", t("Animazioa gelditu"));
  }
  drawBoard(canvas, animationFrameState(board.animazioa[0], board.fondo), null);

  var frameDuration = 650;
  var animate = function (timestamp) {
    if (!previewAnimation || previewAnimation.id !== Number(id)) return;
    var current = previewAnimation.frame;
    var next = current + 1;
    if (next >= board.animazioa.length) {
      stopExerciseAnimation(animationFrameState(board.animazioa[current], board.fondo));
      return;
    }
    var started = previewAnimation.started;
    if (started == null) {
      started = timestamp;
      previewAnimation.started = started;
    }
    var progress = Math.min(1, (timestamp - started) / frameDuration);
    drawBoard(canvas, interpolateAnimationFrames(
      board.animazioa[current], board.animazioa[next], progress, board.fondo
    ), null);
    if (progress >= 1) {
      previewAnimation.frame = next;
      previewAnimation.started = timestamp;
    }
    previewAnimation.raf = requestAnimationFrame(animate);
  };
  previewAnimation.raf = requestAnimationFrame(animate);
}

function sessionViewExercises() {
  return sessionSelection.filter(function (entry) { return !entry.is_separator; })
    .map(function (entry) { return Number(entry.id_ariketa); });
}

function currentSessionBoard() {
  var id = sessionView.ids[sessionView.index];
  var exercise = exercises.find(function (item) { return Number(item.id_ariketa) === Number(id); });
  return { id: id, exercise: exercise, board: exercise && parseBoardData(exercise.arbela_datuak) };
}

function drawSessionBoard() {
  var current = currentSessionBoard();
  var canvas = $("session-board");
  if (current.board) drawBoard(canvas, current.board, null);
  else drawBoard(canvas, { fondo: "Zelaia", posizioak: {}, marrazkiak: [], animazioa: [] }, null);
}

function stopSessionAnimation() {
  if (sessionView.raf) cancelAnimationFrame(sessionView.raf);
  sessionView.raf = 0;
  var button = $("session-play");
  button.textContent = t("Animazioa ikusi");
  button.setAttribute("aria-label", t("Animazioa ikusi"));
  if (sessionView.ids.length) drawSessionBoard();
}

function renderSessionBoard() {
  stopSessionAnimation();
  var current = currentSessionBoard();
  $("session-view-title").textContent = current.exercise ? current.exercise.izena : t("Saioa osatzen");
  $("session-view-position").textContent = sessionView.ids.length
    ? (sessionView.index + 1) + " / " + sessionView.ids.length : "";
  $("session-prev").disabled = sessionView.index <= 0;
  $("session-next").disabled = sessionView.index >= sessionView.ids.length - 1;
  $("session-play").classList.toggle("hidden", !(current.board && current.board.animazioa.length > 1));
  drawSessionBoard();
}

function openSessionBoard(id, exerciseIds, returnSection) {
  id = Number(id);
  var ids = Array.isArray(exerciseIds) ? exerciseIds.map(Number) : sessionViewExercises();
  var index = ids.indexOf(id);
  if (index < 0) {
    sessionView.ids = [id];
    sessionView.index = 0;
  } else {
    sessionView.ids = ids;
    sessionView.index = index;
  }
  sessionViewReturn = returnSection || "v-sessions";
  selectSection("v-session-view");
  renderSessionBoard();
}

function openSessionExercisePreview(id) {
  id = Number(id);
  var exercise = exercises.find(function (item) { return Number(item.id_ariketa) === id; });
  var board = exercise && parseBoardData(exercise.arbela_datuak);
  if (!exercise || !board) return notify(t("Ariketa honek ez dauka arbelarik gordeta"), "error");
  stopExerciseAnimation();
  var canvas = $("session-preview-canvas"), play = $("session-preview-play");
  canvas.width = 800;
  canvas.height = 500;
  drawBoard(canvas, board, null);
  $("session-preview-title").textContent = exercise.izena;
  $("session-preview-caption").textContent = exercise.deskribapena || exercise.kategoria || t("Ariketaren aurrebista");
  play.dataset.exerciseId = String(id);
  play.textContent = t("Animazioa ikusi");
  play.setAttribute("aria-label", t("Animazioa ikusi: ") + exercise.izena);
  play.classList.toggle("hidden", board.animazioa.length < 2);
  var dialog = $("session-preview-dialog");
  if (!dialog.open) dialog.showModal();
}

function playSessionAnimation() {
  var current = currentSessionBoard();
  var board = current.board, canvas = $("session-board");
  if (!board || board.animazioa.length < 2) {
    notify(t("Ariketa honek ez du erreproduzitzeko animaziorik"), "error");
    return;
  }
  stopSessionAnimation();
  var button = $("session-play");
  button.textContent = t("Gelditu");
  button.setAttribute("aria-label", t("Animazioa gelditu"));
  var state = { frame: 0, started: null }, frameDuration = 650;
  drawBoard(canvas, animationFrameState(board.animazioa[0], board.fondo), null);
  var animate = function (timestamp) {
    var next = state.frame + 1;
    if (next >= board.animazioa.length) { stopSessionAnimation(); return; }
    if (state.started == null) state.started = timestamp;
    var progress = Math.min(1, (timestamp - state.started) / frameDuration);
    drawBoard(canvas, interpolateAnimationFrames(
      board.animazioa[state.frame], board.animazioa[next], progress, board.fondo
    ), null);
    if (progress >= 1) { state.frame = next; state.started = timestamp; }
    sessionView.raf = requestAnimationFrame(animate);
  };
  sessionView.raf = requestAnimationFrame(animate);
}

function renderPlayers() {
  renderShotPlayers();
  drawShotCanvases();
  scoreRenderSanctions();
  var query = ($("players-search").value || "").trim().toLocaleLowerCase();
  var status = $("players-status").value;
  var visiblePlayers = players.filter(function (player) {
    return (!status || player.egoera === status) && (!query || (playerName(player) + " " + (player.dortsala == null ? "" : player.dortsala)).toLocaleLowerCase().includes(query));
  });
  var attendanceRows = records("saio_bertaratzea");
  $("players-list").innerHTML = visiblePlayers.length ? visiblePlayers.map(function (player) {
    var playerAttendance = attendanceRows.filter(function (row) {
      return Number(row.id_jokalaria) === Number(player.id_jokalaria);
    });
    var attendanceTotal = playerAttendance.length;
    var attendancePresent = playerAttendance.filter(function (row) {
      return Number(row.bertaratu) === 1 || row.bertaratu === true;
    }).length;
    var attendancePercent = attendanceTotal ? Math.round(attendancePresent / attendanceTotal * 100) : null;
    var attendanceMarkup = attendanceTotal
      ? ("<div class=\"player-attendance\" aria-label=\"" + esc(t("Asistentzia: %"))) + attendancePercent + ', ' + attendancePresent + ' ' + attendanceTotal + esc(t(' saiotik')) + '">' +
        ("<span class=\"player-attendance-label\">" + esc(t("Asistentzia")) + "</span><strong>%") + attendancePercent + '</strong>' +
        '<span class="player-attendance-bar" aria-hidden="true"><i style="width:' + attendancePercent + '%"></i></span>' +
        '<small>' + attendancePresent + '/' + attendanceTotal + (esc(t(" saio")) + "</small></div>")
      : ("<div class=\"player-attendance player-attendance-empty\"><span class=\"player-attendance-label\">" + esc(t("Asistentzia")) + "</span><small>" + esc(t("Erregistrorik ez")) + "</small></div>");
    return '<li class="item"><div class="item-main"><strong>' +
      (player.dortsala != null ? "#" + esc(player.dortsala) + " " : "") + esc(playerName(player)) +
      '</strong><small>' + esc(t(player.posizioa) || t("Posiziorik gabe")) + " · " +
      esc(t(player.egoera) || "") + '</small>' + attendanceMarkup + '</div><button class="btn danger" type="button" data-delete-player="' +
      Number(player.id_jokalaria) + ("\">" + esc(t("Ezabatu")) + "</button></li>");
  }).join("") : '<li class="empty">' + (players.length ? t("Ez da jokalaririk aurkitu iragazki horiekin.") : t("Ez dago jokalaririk. Gehitu lehenengo jokalaria.")) + '</li>';

  var fields = [[t("Gol"), "golak"], [t("Jaurtiketa"), "jaurtiketak"], [t("Horia"), "horia"],
    ["2 min", "two_min"], [t("Gorria"), "gorria"], [t("Urdina"), "urdina"]];
  $("match-players").innerHTML = players.length ? players.map(function (player) {
    var id = Number(player.id_jokalaria), name = esc(playerName(player));
    return '<div class="match-player"><div class="match-player-head">' +
      (player.dortsala != null ? "#" + esc(player.dortsala) + " " : "") + name +
      '</div><div class="player-stats">' + fields.map(function (field) {
        return '<label>' + field[0] + '<input type="number" min="0" max="999" value="0" aria-label="' +
          name + " " + field[0] + '" data-stat="' + field[1] + '" data-player="' + id + '"></label>';
      }).join("") + "</div></div>";
  }).join("") : ("<p class=\"empty\">" + esc(t("Gehitu jokalariak partidako estatistikak jasotzeko.")) + "</p>");

  $("attendance-list").innerHTML = players.length ? players.map(function (player) {
    var id = Number(player.id_jokalaria), name = esc(playerName(player));
    return '<div class="attendance-row"><label class="checkrow"><input type="checkbox" data-att-player="' +
      id + '" checked><span>' + (player.dortsala != null ? "#" + esc(player.dortsala) + " " : "") +
      name + ("</span></label><label>" + esc(t("Berandu (min)")) + "<input type=\"number\" min=\"0\" max=\"999\" value=\"0\" data-late=\"") +
      id + ("\"></label><label>" + esc(t("Atzerapen mota")) + "<select data-late-type=\"") + id +
      ("\"><option value=\"\">" + esc(t("Ez dago")) + "</option><option value=\"Justifikatua\">" + esc(t("Justifikatua")) + "</option><option value=\"Justifikatu gabea\">" + esc(t("Justifikatu gabea")) + "</option></select></label></div>");
  }).join("") : ("<p class=\"empty\">" + esc(t("Ez dago jokalaririk.")) + "</p>");
}

function sessionExerciseById(id) {
  return exercises.find(function (item) { return Number(item.id_ariketa) === Number(id); });
}

function sessionGroupLabel(name) {
  return ["Beroketa", "Zati nagusia", "Bukaera"].includes(name) ? t(name) : name;
}

function normalizeCategoryName(value) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

function exerciseCategoryNames(exercise) {
  if (!exercise) return [];
  var result = [], categories = records("kategoriak");
  function add(value) {
    var name = String(value == null ? "" : value).trim();
    if (!name) return;
    // Older records sometimes store the category ID in ariketak.kategoria.
    if (/^\d+$/.test(name)) {
      var byId = categories.find(function (item) { return Number(item.id_kategoria) === Number(name); });
      if (!byId) return;
      name = String(byId.izena || "").trim();
    }
    if (name && !result.some(function (existing) {
      return normalizeCategoryName(existing) === normalizeCategoryName(name);
    })) result.push(name);
  }
  add(exercise.kategoria);
  if (exercise.id_kategoria != null) add(exercise.id_kategoria);
  records("kategoriak_has_ariketak").forEach(function (relation) {
    if (Number(relation.ariketak_id_ariketa) !== Number(exercise.id_ariketa)) return;
    var category = categories.find(function (item) {
      return Number(item.id_kategoria) === Number(relation.kategoriak_id_kategoria);
    });
    if (category) add(category.izena);
  });
  return result;
}

var sessionSegmentColors = ["#2a5cff", "#198754", "#e08a00", "#bf3030",
  "#7b4fd0", "#0f9bb3", "#c2410c", "#4d7c0f"];

function updateSessionTimeBar() {
  var bar = $("session-time-bar"), input = $("session-total-minutes"), label = $("session-time-label");
  if (!bar || !label) return;
  var total = Math.round(Number(input && input.value));
  if (!Number.isFinite(total) || total < 0) total = 0;
  total = Math.min(999, total);
  var segments = sessionSelection.filter(function (entry) { return !entry.is_separator; }).map(function (entry) {
    var exercise = sessionExerciseById(entry.id_ariketa);
    return { id: Number(entry.id_ariketa), name: exercise ? exercise.izena : "", minutes: Number(entry.iraupena_minutuak) || 0 };
  }).filter(function (segment) { return segment.minutes > 0; });
  var used = segments.reduce(function (sum, segment) { return sum + segment.minutes; }, 0);
  var over = total > 0 && used > total;
  var scaleBase = over ? used : total;
  bar.classList.toggle("over", over);

  var existing = Array.from(bar.querySelectorAll(".session-time-seg"));
  var existingById = {};
  existing.forEach(function (el) {
    if (el.dataset.segId) existingById[Number(el.dataset.segId)] = el;
  });

  segments.forEach(function (segment, index) {
    var el = existingById[segment.id];
    if (!el) {
      el = document.createElement("div");
      el.className = "session-time-seg";
      el.dataset.segId = segment.id;
      el.title = segment.name + ": " + segment.minutes + " min";
      el.style.background = "";
      el.style.width = "0";
      bar.appendChild(el);
      var percent = scaleBase > 0 ? (segment.minutes / scaleBase) * 100 : 0;
      el.style.width = percent.toFixed(3) + "%";
      setTimeout(function () { el.style.width = percent.toFixed(3) + "%"; }, 0);
      requestAnimationFrame(function () {
        el.style.width = percent.toFixed(3) + "%";
      });
      setTimeout(function () {
        el.style.width = percent.toFixed(3) + "%";
      }, 30);
    } else {
      delete existingById[segment.id];
      el.title = segment.name + ": " + segment.minutes + " min";
      el.style.background = "";
      var percent = scaleBase > 0 ? (segment.minutes / scaleBase) * 100 : 0;
      el.style.width = percent.toFixed(3) + "%";
    }
  });

  Object.keys(existingById).forEach(function (key) {
    existingById[Number(key)].remove();
  });

  var warn = $("session-time-warn");
  if (warn) {
    if (over) {
      warn.textContent = t("Denbora gaindituta: ") + (used - total) + t(" min gehiago. Gehitu ditzakezu, baina egiaztatu denbora.");
      warn.classList.add("show");
    } else {
      warn.textContent = "";
      warn.classList.remove("show");
    }
  }

  label.textContent = used + " / " + total + " min";
}

function renderSessionPicker() {
  sessionSelection = sessionSelection.filter(function (entry) {
    return entry.is_separator || sessionExerciseById(entry.id_ariketa);
  });
  var selectedIds = sessionSelection.filter(function (entry) { return !entry.is_separator; })
    .map(function (entry) { return Number(entry.id_ariketa); });
  var available = exercises.filter(function (exercise) {
    return selectedIds.indexOf(Number(exercise.id_ariketa)) === -1;
  });
  var categories = [];
  exercises.forEach(function (exercise) {
    exerciseCategoryNames(exercise).forEach(function (name) {
      if (name && !categories.some(function (existing) {
        return normalizeCategoryName(existing) === normalizeCategoryName(name);
      })) categories.push(name);
    });
  });
  categories.sort(function (a, b) { return a.localeCompare(b); });
  sessionCategoryFilter = sessionCategoryFilter
    ? (categories.find(function (name) {
        return normalizeCategoryName(name) === normalizeCategoryName(sessionCategoryFilter);
      }) || "")
    : "";
  var filter = $("session-category");
  if (filter) {
    filter.innerHTML = ("<option value=\"\">" + esc(t("Kategoria guztiak")) + "</option>");
    categories.forEach(function (name) {
      var option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      filter.appendChild(option);
    });
    filter.value = sessionCategoryFilter;
  }
  var visible = sessionCategoryFilter ? available.filter(function (exercise) {
    return exerciseCategoryNames(exercise).some(function (name) {
      return normalizeCategoryName(name) === normalizeCategoryName(sessionCategoryFilter);
    });
  }) : available;
  $("session-library").innerHTML = visible.length ? visible.map(function (exercise) {
    var id = Number(exercise.id_ariketa);
    var categoryNames = exerciseCategoryNames(exercise);
    return '<li class="session-slot"><span class="slot-name">' + esc(exercise.izena) +
      ' <small class="muted">' + esc(categoryNames.join(", ")) + "</small></span>" +
      '<button class="btn secondary" type="button" data-session-view="' + id + ("\">" + esc(t("Arbela")) + "</button>") +
      '<button class="btn" type="button" data-session-add="' + id + ("\">" + esc(t("Gehitu")) + "</button></li>");
  }).join("") : '<li class="empty">' + (sessionCategoryFilter
    ? t("Ez dago ariketarik kategoria honetan.") : t("Ez dago ariketarik liburutegian.")) + "</li>";
  var groupLabel = $("session-current-group");
  if (groupLabel) groupLabel.textContent = t("Hurrengo ariketak: ") + (activeSessionGroup ? sessionGroupLabel(activeSessionGroup.name) : t("Tarterik gabe"));
  $("session-selected").innerHTML = sessionSelection.length ? sessionSelection.map(function (entry) {
    if (entry.is_separator) return '<li class="session-group-row" data-session-drop-group="' + esc(entry.group_id) + '"><strong>' + esc(sessionGroupLabel(entry.taldea)) +
      '</strong><button class="slot-remove" type="button" data-session-remove-group="' + esc(entry.group_id) + ("\" aria-label=\"" + esc(t("Kendu tartea")) + "\">" + esc(t("×")) + "</button></li>");
    var exercise = sessionExerciseById(entry.id_ariketa), id = Number(entry.id_ariketa);
    if (!exercise) return "";
    return '<li class="session-slot" data-session-drop-exercise="' + id + ("\"><button class=\"session-drag-handle\" type=\"button\" data-session-drag-handle aria-label=\"" + esc(t("Arrastatu ordena aldatzeko: "))) + esc(exercise.izena) + ("\" title=\"" + esc(t("Arrastatu ordena aldatzeko")) + "\">&#8942;&#8942;</button><span class=\"slot-name\">") + esc(exercise.izena) +
      '</span><input type="number" min="0" max="999" value="' + Number(entry.iraupena_minutuak) +
      '" data-session-minutes="' + id + ("\" aria-label=\"" + esc(t("Minutuak: "))) + esc(exercise.izena) + '">' +
      ("<label class=\"session-exercise-notes-field\">" + esc(t("Oharrak")) + "<textarea class=\"session-exercise-notes\" rows=\"2\" maxlength=\"3000\" data-session-notes=\"") + id + ("\" aria-label=\"" + esc(t("Oharrak: "))) + esc(exercise.izena) + ("\" placeholder=\"" + esc(t("Idatzi ariketa honetarako oharrak")) + "\">") + esc(entry.aldaerak || "") + '</textarea></label>' +
      '<button class="slot-remove" type="button" data-session-remove="' + id +
      ("\" aria-label=\"" + esc(t("Kendu ariketa")) + "\">✕</button></li>");
  }).join("") : ("<li class=\"empty\">" + esc(t("Gehitu ariketak ezkerraldetik.")) + "</li>");
  updateSessionTimeBar();
}

function addSessionExercise(id) {
  id = Number(id);
  if (!sessionExerciseById(id)) return;
  if (sessionSelection.some(function (entry) { return Number(entry.id_ariketa) === id; })) return;
  sessionSelection.push({ id_ariketa: id, iraupena_minutuak: 10,
    aldaerak: "",
    taldea: activeSessionGroup ? activeSessionGroup.name : null,
    group_id: activeSessionGroup ? activeSessionGroup.id : null });
  renderSessionPicker();
}

function addSessionGroup(name) {
  name = String(name || "").trim();
  if (!name) { notify(t("Idatzi tartearen izena"), "error"); return; }
  var id = "group-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  sessionSelection.push({ is_separator: true, taldea: name, group_id: id });
  activeSessionGroup = { id: id, name: name };
  renderSessionPicker();
}

function removeSessionGroup(id) {
  var separator = sessionSelection.find(function (entry) { return entry.is_separator && entry.group_id === id; });
  var name = separator && separator.taldea;
  sessionSelection = sessionSelection.filter(function (entry) {
    if (entry.is_separator) return entry.group_id !== id;
    if (entry.group_id === id) { entry.group_id = null; entry.taldea = null; }
    return true;
  });
  if (activeSessionGroup && activeSessionGroup.id === id) activeSessionGroup = null;
  renderSessionPicker();
  if (name) notify('"' + name + t("\" tartea kendu da"), "success");
}

function removeSessionExercise(id) {
  id = Number(id);
  sessionSelection = sessionSelection.filter(function (entry) {
    return Number(entry.id_ariketa) !== id;
  });
  renderSessionPicker();
}

function dropSessionExercise(draggedId, target) {
  var sourceIndex = sessionSelection.findIndex(function (entry) {
    return !entry.is_separator && Number(entry.id_ariketa) === Number(draggedId);
  });
  if (sourceIndex < 0) return;
  var entry = sessionSelection[sourceIndex];
  if (target.type === "exercise" && Number(target.id) === Number(draggedId)) return;
  sessionSelection.splice(sourceIndex, 1);
  var insertAt = -1;
  if (target.type === "group") {
    var separatorIndex = sessionSelection.findIndex(function (item) {
      return item.is_separator && item.group_id === target.id;
    });
    if (separatorIndex < 0) return;
    var separator = sessionSelection[separatorIndex];
    entry.group_id = separator.group_id;
    entry.taldea = separator.taldea;
    insertAt = separatorIndex + 1;
  } else {
    var targetIndex = sessionSelection.findIndex(function (item) {
      return !item.is_separator && Number(item.id_ariketa) === Number(target.id);
    });
    if (targetIndex < 0) return;
    var targetEntry = sessionSelection[targetIndex];
    entry.group_id = targetEntry.group_id || null;
    entry.taldea = targetEntry.taldea || null;
    insertAt = targetIndex + (target.after ? 1 : 0);
  }
  sessionSelection.splice(insertAt, 0, entry);
  renderSessionPicker();
}

function setSessionMinutes(id, value) {
  var entry = sessionSelection.find(function (item) { return Number(item.id_ariketa) === Number(id); });
  if (!entry) return;
  var minutes = Math.round(Number(value));
  entry.iraupena_minutuak = Number.isFinite(minutes) && minutes >= 1 ? Math.min(999, minutes) : 10;
  updateSessionTimeBar();
}

function renderExercises() {
  stopExerciseAnimation();
  renderExerciseCategories();
  renderSessionPicker();
  var filter = $("exercise-list-category");
  var categoryFilter = filter ? filter.value : "";
  var visibleExercises = categoryFilter ? exercises.filter(function (exercise) {
    return exerciseCategoryNames(exercise).some(function (name) {
      return normalizeCategoryName(name) === normalizeCategoryName(categoryFilter);
    });
  }) : exercises;
  $("exercises-list").innerHTML = visibleExercises.length ? visibleExercises.map(function (exercise) {
    var board = parseBoardData(exercise.arbela_datuak);
    var hasAnimation = board && board.animazioa.length > 1;
    return '<li class="item"><div class="item-main"><strong class="exercise-name">' + esc(exercise.izena) +
      '</strong><small>' + esc(exerciseCategoryNames(exercise).join(", ")) +
      (exercise.deskribapena ? " · " + esc(exercise.deskribapena) : "") +
      '</small></div>' + (board ? '<canvas class="exercise-board-preview" width="336" height="210" data-board-preview="' +
      Number(exercise.id_ariketa) + ("\" aria-label=\"" + esc(t("Arbelaren aurrebista: "))) + esc(exercise.izena) + '"></canvas>' : '<span class="exercise-board-placeholder" aria-hidden="true"></span>') +
      '<div class="exercise-actions">' + (hasAnimation
        ? '<button class="btn secondary" type="button" data-play-exercise="' + Number(exercise.id_ariketa) +
          ("\" aria-label=\"" + esc(t("Animazioa ikusi")) + "\">" + esc(t("Animazioa ikusi")) + "</button>") : "") +
      '<button class="btn danger" type="button" data-delete-exercise="' +
      Number(exercise.id_ariketa) + ("\">" + esc(t("Ezabatu")) + "</button></div></li>");
  }).join("") : '<li class="empty">' + (categoryFilter ? t("Ez dago ariketarik kategoria honetan.") : t("Ariketa-liburutegia hutsik dago.")) + '</li>';
  document.querySelectorAll("[data-board-preview]").forEach(function (canvas) {
    var exercise = exercises.find(function (item) {
      return Number(item.id_ariketa) === Number(canvas.dataset.boardPreview);
    });
    var data = exercise && parseBoardData(exercise.arbela_datuak);
    if (data) drawBoard(canvas, data, null);
  });
}

function renderExerciseCategories() {
  var categoryMap = new Map();
  records("kategoriak").filter(function (item) { return item && item.izena; }).forEach(function (item) {
    var key = String(item.izena).trim().toLocaleLowerCase();
    if (key && !categoryMap.has(key)) categoryMap.set(key, item);
  });
  var categories = Array.from(categoryMap.values()).sort(function (a, b) {
    return String(a.izena).localeCompare(String(b.izena));
  });
  var names = [];
  categories.forEach(function (item) {
    var categoryName = String(item.izena).trim();
    if (categoryName && !names.some(function (existing) {
      return existing.toLocaleLowerCase() === categoryName.toLocaleLowerCase();
    })) names.push(categoryName);
  });
  exercises.forEach(function (exercise) {
    exerciseCategoryNames(exercise).forEach(function (name) {
      if (name && !names.some(function (existing) {
        return normalizeCategoryName(existing) === normalizeCategoryName(name);
      })) names.push(name);
    });
  });
  names.sort(function (a, b) { return a.localeCompare(b); });
  var checklist = $("exercise-category");
  if (checklist) {
    var selected = Array.from(checklist.querySelectorAll("input:checked")).map(function (input) { return input.value; });
    checklist.innerHTML = names.length ? names.map(function (name) {
      return '<label class="checkrow"><input type="checkbox" name="kategoriak" value="' + esc(name) + '"' +
        (selected.indexOf(name) !== -1 ? ' checked' : '') + '><span>' + esc(name) + '</span></label>';
    }).join("") : ("<span class=\"muted\">" + esc(t("Oraindik ez dago kategoriarik.")) + "</span>");
  }
  var listFilter = $("exercise-list-category");
  if (listFilter) {
    var selectedFilter = listFilter.value;
    listFilter.innerHTML = ("<option value=\"\">" + esc(t("Kategoria guztiak")) + "</option>") + names.map(function (name) {
      return '<option value="' + esc(name) + '">' + esc(name) + '</option>';
    }).join("");
    listFilter.value = names.find(function (name) {
      return normalizeCategoryName(name) === normalizeCategoryName(selectedFilter);
    }) || "";
  }
  var list = $("exercise-category-list");
  if (list) list.innerHTML = categories.length ? categories.map(function (category) {
    return '<li class="item"><div class="item-main"><strong>' + esc(category.izena) + '</strong></div>' +
      '<button class="btn danger" type="button" data-delete-exercise-category="' + esc(category.izena) + ("\">" + esc(t("Ezabatu")) + "</button></li>");
  }).join("") : ("<li class=\"empty\">" + esc(t("Oraindik ez dago kategoriarik. Sortu kategoria liburutegian erabiltzeko.")) + "</li>");
}

function renderSavedSession(sessionId) {
  var session = sessions.find(function (item) { return Number(item.id_saio) === Number(sessionId); });
  if (!session) return false;
  $("v-session-detail").dataset.sessionId = String(sessionId);
  var micro = records("mikrozikloak").find(function (item) {
    return Number(item.id_mikroziklo) === Number(session.id_mikroziklo);
  });
  var details = records("saio_xehetasuna").filter(function (item) {
    return Number(item.id_saio) === Number(sessionId);
  }).sort(function (a, b) {
    return Number(a.ordena || 0) - Number(b.ordena || 0) || Number(a.id_saio_xehetasuna || 0) - Number(b.id_saio_xehetasuna || 0);
  });
  var totalMinutes = details.reduce(function (total, item) {
    return total + (item.id_ariketa == null ? 0 : Number(item.iraupena_minutuak || 0));
  }, 0);
  var exerciseCount = details.filter(function (item) { return item.id_ariketa != null; }).length;
  var meta = [formatDay(session), session.lekua || "", exerciseCount + t(" ariketa")].filter(Boolean);
  $("saved-session-title").textContent = session.helburu_taktikoa || t("Entrenamendua");
  $("saved-session-meta").textContent = meta.join(" · ");
  $("saved-session-goal").textContent = session.helburu_taktikoa || t("Helburu taktikorik gabe");
  $("saved-session-cycle").textContent = micro ? t("Mikrozikloa · ") + (t(micro.mota) || t("Mikrozikloa")) : t("Ez dago mikroziklo bati lotuta");
  $("saved-session-total").textContent = totalMinutes + " min";
  var previewBoards = [], renderedExerciseIndex = 0, lastGroup = null;
  var savedMarkup = details.map(function (detail, index) {
    if (detail.id_ariketa == null) {
      var separatorName = String(detail.taldea || "").trim();
      lastGroup = separatorName || null;
      return separatorName ? '<div class="training-session-group"><span>' + esc(sessionGroupLabel(separatorName)) + '</span></div>' : "";
    }
    var detailGroup = String(detail.taldea || "").trim();
    var heading = "";
    if (detailGroup && detailGroup !== lastGroup) {
      heading = '<div class="training-session-group"><span>' + esc(sessionGroupLabel(detailGroup)) + '</span></div>';
    }
    lastGroup = detailGroup || null;
    var step = ++renderedExerciseIndex;
    var exercise = exercises.find(function (item) { return Number(item.id_ariketa) === Number(detail.id_ariketa); });
    var board = exercise && parseBoardData(exercise.arbela_datuak);
    var hasAnimation = board && board.animazioa.length > 1;
    if (board) previewBoards.push({ index: index, data: board });
    var title = exercise ? exercise.izena : t("Ariketa ez dago eskuragarri");
    return heading + '<article class="training-exercise-card"><div class="training-exercise-head"><span class="training-step">' +
      step + '</span><div><h3>' + esc(title) + '</h3><div class="training-exercise-meta">' +
      (exercise && exercise.kategoria ? esc(exercise.kategoria) + " · " : "") +
      Number(detail.iraupena_minutuak || 0) + (esc(t(" min")) + "</div></div></div>") +
      (board ? '<canvas class="training-exercise-preview" width="800" height="500" data-training-preview="' + index + '" aria-label="' + esc(title) + esc(t(' ariketa-arbela')) + '"></canvas>' : "") +
      (exercise && exercise.deskribapena ? '<p class="training-exercise-description">' + esc(exercise.deskribapena) + '</p>' : "") +
      (detail.aldaerak ? ("<p class=\"training-exercise-notes\"><strong>" + esc(t("Oharrak:")) + "</strong> ") + esc(detail.aldaerak) + '</p>' : "") +
      (board ? '<div class="training-exercise-actions">' +
        (hasAnimation ? '<button class="btn secondary" type="button" data-play-training-animation="' + Number(detail.id_ariketa) + ("\" aria-label=\"" + esc(t("Ariketa txartelean animazioa ikusi")) + "\">" + esc(t("Animazioa ikusi")) + "</button>") : "") +
        '<button class="btn secondary" type="button" data-training-board="' + Number(detail.id_ariketa) + '" data-training-session="' + Number(sessionId) + ("\">" + esc(t("Arbela handitu")) + "</button></div>") : "") +
      '</article>';
  }).join("");
  $("saved-session-exercises").innerHTML = savedMarkup || ("<div class=\"card empty\">" + esc(t("Saio honek ez dauka lotutako ariketarik.")) + "</div>");
  previewBoards.forEach(function (preview) {
    var canvas = document.querySelector('[data-training-preview="' + preview.index + '"]');
    if (canvas) drawBoard(canvas, preview.data, null);
  });
  return true;
}

function renderSessions() {
  var details = records("saio_xehetasuna");
  $("sessions-list").innerHTML = sessions.length ? sessions.map(function (session) {
    var names = details.filter(function (item) {
      return Number(item.id_saio) === Number(session.id_saio);
    }).map(function (item) {
      var exercise = exercises.find(function (entry) {
        return Number(entry.id_ariketa) === Number(item.id_ariketa);
      });
      return exercise ? exercise.izena : "";
    }).filter(Boolean);
    return '<li class="item"><div class="item-main"><strong>' + esc(formatDay(session)) +
      '</strong><small>' + esc(session.lekua || "") +
      (session.helburu_taktikoa ? " · " + esc(session.helburu_taktikoa) : "") +
      (names.length ? " · " + esc(names.join(", ")) : "") +
      '</small></div><div class="session-actions"><button class="btn secondary" type="button" data-view-session="' +
      Number(session.id_saio) + ("\">" + esc(t("Ikusi")) + "</button><button class=\"btn secondary\" type=\"button\" data-attendance-session=\"") +
      Number(session.id_saio) + ("\">" + esc(t("Asistentzia")) + "</button></div></li>");
  }).join("") : ("<li class=\"empty\">" + esc(t("Oraindik ez da entrenamendurik gorde.")) + "</li>");
  var select = $("attendance-session"), prior = select.value;
  select.innerHTML = ("<option value=\"\">" + esc(t("Aukeratu entrenamendua")) + "</option>") + sessions.map(function (session) {
    return '<option value="' + Number(session.id_saio) + '">' + esc(formatDay(session)) +
      " · " + esc(session.lekua || "") + "</option>";
  }).join("");
  if (sessions.some(function (session) { return String(session.id_saio) === prior; })) select.value = prior;
  $("attendance-open").disabled = !select.value;
}

function renderMatches() {
  $("matches-list").innerHTML = matches.length ? matches.map(function (match) {
    return '<li class="item"><div class="item-main"><strong>' + esc(match.aurkaria || t("Aurkaria")) +
      " · " + Number(match.emaitza_geurea || 0) + " - " + Number(match.emaitza_aurkaria || 0) +
      '</strong><small>' + esc(formatDate(match)) + " · " + esc(t(match.lekua) || "") +
      '</small></div><span class="match-actions"><button class="btn secondary" type="button" data-match-stats="' +
      Number(match.id_partida) + ("\">" + esc(t("Estatistikak")) + "</button> <button class=\"btn secondary\" type=\"button\" data-match-stats=\"") +
      Number(match.id_partida) + ("\" data-match-stats-view=\"opponents\" aria-label=\"" + esc(t("Ikusi aurkariaren estatistikak")) + "\">" + esc(t("Aurkaria")) + "</button> <button class=\"btn secondary\" type=\"button\" data-edit-match=\"") +
      Number(match.id_partida) + ("\">" + esc(t("Editatu")) + "</button> <button class=\"btn danger\" type=\"button\" data-delete-match=\"") +
      Number(match.id_partida) + ("\">" + esc(t("Ezabatu")) + "</button></span></li>");
  }).join("") : ("<li class=\"empty\">" + esc(t("Oraindik ez da partidarik gorde.")) + "</li>");
  var statsMatch = $("stats-match"), priorStatsMatch = statsMatch.value;
  statsMatch.innerHTML = ("<option value=\"\">" + esc(t("Partida guztiak")) + "</option>") + matches.map(function (match) {
    return '<option value="' + Number(match.id_partida) + '">' + esc(formatDate(match) + " · " + (match.aurkaria || t("Aurkaria"))) + '</option>';
  }).join("");
  if (matches.some(function (match) { return String(match.id_partida) === priorStatsMatch; })) statsMatch.value = priorStatsMatch;
  var opponentSelect = $("stats-opponent"), priorOpponent = opponentSelect.value;
  var opponentNames = Array.from(new Set(matches.map(function (match) { return String(match.aurkaria || t("Aurkaria")); }))).sort();
  opponentSelect.innerHTML = ("<option value=\"\">" + esc(t("Aurkari guztiak")) + "</option>") + opponentNames.map(function (name) { return '<option value="' + esc(name) + '">' + esc(name) + '</option>'; }).join("");
  if (opponentNames.indexOf(priorOpponent) !== -1) opponentSelect.value = priorOpponent;
}

function renderMatchEditor(matchId, scroll) {
  var match = matches.find(function (item) { return Number(item.id_partida) === Number(matchId); });
  if (!match) {
    $("match-detail").classList.add("hidden");
    notify(t("Ezin izan da partida aurkitu. Birkargatu zerrenda."), "error");
    return;
  }
  var playerRows = records("partida_jokalariak").filter(function (row) {
    return Number(row.id_partida) === Number(matchId);
  });
  var sanctions = records("partidu_zigorrak").filter(function (row) {
    return Number(row.id_partida) === Number(matchId);
  });
  var fields = [[t("Gol"), "golak", 999], [t("Jaurtiketa"), "jaurtiketak", 999],
    [t("Horia"), "horia", 100], ["2 min", "two_min", 100],
    [t("Gorria"), "gorria", 100], [t("Urdina"), "urdina", 100]];
  $("match-detail").innerHTML =
    '<form id="match-edit-form" class="stack" data-match-edit-id="' + Number(matchId) + '">' +
    '<div class="toolbar"><div><h2>' + esc(match.aurkaria || t("Aurkaria")) +
    (esc(t(" · partida editatzen")) + "</h2><p class=\"muted\">") + esc(formatDate(match)) +
    " · " + esc(t(match.lekua) || "") + ("</p></div><button class=\"btn secondary\" type=\"button\" data-close-match-stats>" + esc(t("Itxi")) + "</button></div>") +
    ("<div class=\"grid2\"><label>" + esc(t("Gure emaitza")) + "<input type=\"number\" min=\"0\" max=\"999\" required data-match-score=\"home\" value=\"") +
    Number(match.emaitza_geurea || 0) + ("\"></label><label>" + esc(t("Aurkariaren emaitza")) + "<input type=\"number\" min=\"0\" max=\"999\" required data-match-score=\"away\" value=\"") +
    Number(match.emaitza_aurkaria || 0) + '"></label></div>' +
    ("<h3>" + esc(t("Jokalari bakoitzaren estatistikak")) + "</h3>") +
    (players.map(function (player) {
      var playerId = Number(player.id_jokalaria);
      var row = playerRows.find(function (item) { return Number(item.id_jokalaria) === playerId; });
      var playerSanctions = byPlayer(sanctions, playerId);
      var name = (player.dortsala != null ? "#" + player.dortsala + " " : "") + playerName(player);
      return '<div class="match-player"><label class="checkrow match-player-head"><input type="checkbox" data-edit-played="' +
        playerId + '"' + (row ? " checked" : "") + '><span>' + esc(name) +
        (esc(t(" · Partidara joan da")) + "</span></label><div class=\"player-stats\">") + fields.map(function (field) {
          var value = field[1] === "golak" || field[1] === "jaurtiketak"
            ? Number(row && row[field[1]] || 0)
            : playerSanctions.filter(function (item) {
              return item.mota === (field[1] === "two_min" ? "2min" : field[1]);
            }).length;
          return '<label>' + field[0] + '<input type="number" min="0" max="' + field[2] +
            '" required value="' + value + '" data-edit-stat="' + field[1] +
            '" data-edit-player="' + playerId + '"' + (row ? "" : " disabled") + '></label>';
        }).join("") + '</div></div>';
    }).join("") || ("<p class=\"empty\">" + esc(t("Ez dago jokalaririk.")) + "</p>")) +
    ("<p class=\"muted\">" + esc(t("Jaurtiketen kokapen zehatzak ez dira aldatuko.")) + "</p>") +
    ("<div class=\"grid2\"><button class=\"btn\" type=\"submit\">" + esc(t("Aldaketak gorde")) + "</button><button class=\"btn secondary\" type=\"button\" data-close-match-stats>" + esc(t("Utzi")) + "</button></div>") +
    '</form>';
  $("match-detail").classList.remove("hidden");
  if (scroll !== false) $("match-detail").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderDashboard() {
  if (!$('home-session-content')) return;
  var now = new Date();
  var dashboardDate = function (value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || "");
    return date.toLocaleDateString(I18n.locale(), { weekday: "long", year: "numeric", month: "long", day: "numeric" }) +
      " · " + date.toLocaleTimeString(I18n.locale(), { hour: "2-digit", minute: "2-digit" });
  };
  var byDateDesc = function (a, b) { return new Date(b.data_ordua) - new Date(a.data_ordua); };
  var latestSession = sessions.filter(function (item) {
    var date = new Date(item.data_ordua);
    return Number.isFinite(date.getTime()) && date <= now;
  }).sort(byDateDesc)[0];
  var pastMatches = matches.filter(function (item) {
    var date = new Date(item.data_ordua);
    return Number.isFinite(date.getTime()) && date <= now;
  }).sort(byDateDesc);
  var upcomingMatches = matches.filter(function (item) {
    var date = new Date(item.data_ordua);
    return Number.isFinite(date.getTime()) && date > now;
  }).sort(function (a, b) { return new Date(a.data_ordua) - new Date(b.data_ordua); });
  var latestMatch = pastMatches[0], nextMatch = upcomingMatches[0];
  var userName = user && user.izena && user.izena !== "Online" ? user.izena.trim() : "";
  $("home-title").textContent = t("Ongi etorri") + (userName ? ", " + userName : "");
  $("home-subtitle").textContent = t("Zure taldearen azken jarduerak eta hurrengo erronka.");
  $("home-session-content").innerHTML = latestSession
    ? '<h2>' + esc(latestSession.helburu_taktikoa || t("Entrenamendua")) + '</h2><p>' + esc(latestSession.lekua || t("Tokia zehaztu gabe")) + '</p><div class="home-card-date"><i></i>' + esc(dashboardDate(latestSession.data_ordua)) + '</div><button class="btn secondary" type="button" data-view-session="' + Number(latestSession.id_saio) + ("\">" + esc(t("Entrenamendua ikusi")) + "</button>")
    : ("<h2>" + esc(t("Ez dago aurreko entrenamendurik")) + "</h2><p>" + esc(t("Gordetako azken entrenamendua hemen azalduko da.")) + "</p><button class=\"btn secondary\" type=\"button\" data-open-section=\"v-sessions\">" + esc(t("Entrenamenduetara joan")) + "</button>");
  $("home-match-content").innerHTML = latestMatch
    ? '<h2>' + esc(latestMatch.aurkaria || t("Aurkaria")) + '</h2><p>' + esc(dashboardDate(latestMatch.data_ordua)) + '</p><div class="home-card-date"><i></i>' + Number(latestMatch.emaitza_geurea || 0) + ' – ' + Number(latestMatch.emaitza_aurkaria || 0) + '</div><button class="btn secondary" type="button" data-match-stats="' + Number(latestMatch.id_partida) + ("\">" + esc(t("Partidako estatistikak")) + "</button>")
    : ("<h2>" + esc(t("Ez dago aurreko partidarik")) + "</h2><p>" + esc(t("Gordetako azken partidaren emaitza eta estatistikak hemen azalduko dira.")) + "</p><button class=\"btn secondary\" type=\"button\" data-open-section=\"v-matches\">" + esc(t("Partidak ikusi")) + "</button>");
  $("home-next-match-content").innerHTML = nextMatch
    ? '<h2>' + esc(nextMatch.aurkaria || t("Aurkaria")) + '</h2><p>' + esc(nextMatch.lekua || t("Tokia zehaztu gabe")) + '</p><div class="home-card-date"><i></i>' + esc(dashboardDate(nextMatch.data_ordua)) + ("</div><button class=\"btn secondary\" type=\"button\" data-open-section=\"v-matches\">" + esc(t("Partidaren xehetasunak")) + "</button>")
    : ("<h2>" + esc(t("Ez dago hurrengo partidarik")) + "</h2><p>" + esc(t("Programatzen duzunean, data eta ordua hemen agertuko dira.")) + "</p><button class=\"btn secondary\" type=\"button\" data-open-section=\"v-matches\">" + esc(t("Partida berria gehitu")) + "</button>");
}

function matchEventRecords(match) {
  try {
    var raw = match.estatistika_aurreratuak;
    var data = typeof raw === "string" ? JSON.parse(raw) : raw;
    return data && Array.isArray(data.event_records) ? data.event_records.filter(function (event) {
      return event && typeof event === "object" && !Array.isArray(event);
    }) : [];
  } catch (error) { return []; }
}
function renderOpponentIndividuals(selectedMatches, query) {
  var groups = new Map();
  selectedMatches.forEach(function (match) {
    matchEventRecords(match).filter(function (event) { return event.taldea === "aurkaria"; }).forEach(function (event) {
      var opponent = event.aurkaria;
      if (!opponent || !scoreOpponentLabel(opponent) || !(scoreIsShot(event.type) || scoreIsSanction(event.type))) return;
      var teamName = String(match.aurkaria || t("Aurkaria"));
      var key = teamName.trim().toLocaleLowerCase() + "|" + scoreOpponentKey(opponent);
      if (!groups.has(key)) groups.set(key, { team: teamName, player: opponent, goals: 0, shots: 0, penaltyGoals: 0, penaltyShots: 0, sanctions: { horia: 0, "2min": 0, gorria: 0, urdina: 0 } });
      var row = groups.get(key);
      if (opponent.izena) row.player = opponent;
      if (scoreIsShot(event.type)) row.shots++;
      if (scoreIsGoal(event.type)) row.goals++;
      if (/^penalti_/.test(event.type)) { row.penaltyShots++; if (scoreIsGoal(event.type)) row.penaltyGoals++; }
      if (scoreIsSanction(event.type)) row.sanctions[event.type]++;
    });
  });
  var rows = Array.from(groups.values()).filter(function (row) {
    return (row.team + " " + scoreOpponentLabel(row.player)).toLocaleLowerCase().includes(query);
  }).sort(function (a, b) { return a.team.localeCompare(b.team) || (Number(a.player.zenbakia) || 0) - (Number(b.player.zenbakia) || 0); });
  $("stats-opponent-players").innerHTML = rows.length ? rows.map(function (row) {
    var details = row.goals + t(" gol / ") + row.shots + t(" jaurtiketa") + (row.shots ? " (%" + Math.round(row.goals / row.shots * 100) + ")" : "") +
      " \u00b7 7 m: " + row.penaltyGoals + "/" + row.penaltyShots;
    Object.keys(row.sanctions).forEach(function (type) { if (row.sanctions[type]) details += " \u00b7 " + scoreActionLabel(type) + ": " + row.sanctions[type]; });
    return '<li class="item"><div class="item-main"><strong>' + esc(scoreOpponentLabel(row.player)) + '</strong><small>' + esc(row.team) + ' \u00b7 ' + esc(details) + '</small></div></li>';
  }).join("") : ("<li class=\"empty\">" + esc(t("Ez dago aurkarien banakako estatistikarik iragazki hauekin.")) + "</li>");
}

function renderStats() {
  var period = $("stats-period").value, today = new Date(); today.setHours(23, 59, 59, 999);
  var cutoff = null;
  if (period === "month" || period === "3months") { cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - (period === "month" ? 1 : 3)); }
  if (period === "season") cutoff = new Date(today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1, 7, 1);
  var start = $("stats-start").value ? new Date($("stats-start").value + "T00:00:00") : null;
  var end = $("stats-end").value ? new Date($("stats-end").value + "T23:59:59") : null;
  var venue = $("stats-venue").value, opponent = $("stats-opponent").value;
  var selectedMatch = Number($("stats-match").value) || 0;
  var filteredMatches = matches.filter(function (m) {
    var d = new Date(m.data_ordua), place = String(m.lekua || "").toLocaleLowerCase();
    if (cutoff && d < cutoff || start && d < start || end && d > end) return false;
    if (venue === "home" && !/(etxe|home)/.test(place) || venue === "away" && !/(kanpo|away)/.test(place)) return false;
    if (opponent && String(m.aurkaria || t("Aurkaria")) !== opponent) return false;
    if (selectedMatch && Number(m.id_partida) !== selectedMatch) return false;
    return true;
  });
  var ids = new Set(filteredMatches.map(function (m) { return Number(m.id_partida); }));
  var playerRows = records("partida_jokalariak").filter(function (r) { return ids.has(Number(r.id_partida)); });
  var sanctions = records("partidu_zigorrak").filter(function (r) { return ids.has(Number(r.id_partida)); });
  var shots = records("partidu_jaurtiketak").filter(function (r) { return ids.has(Number(r.id_partida)); });
  var ownShots = shots.filter(function (s) { return !/aurkari|opponent/i.test(String(s.taldea || "")); });
  var awayShots = shots.filter(function (s) { return /aurkari|opponent/i.test(String(s.taldea || "")); });
  var opponentEvents = [];
  var opponentStatsShots = [];
  filteredMatches.forEach(function (match) {
    var events = matchEventRecords(match).filter(function (event) { return event.taldea === "aurkaria"; });
    opponentEvents = opponentEvents.concat(events);
    var eventShots = events.filter(function (event) { return scoreIsShot(event.type); }).map(function (event) {
      return Object.assign({}, event, { mota: event.type, id_partida: match.id_partida });
    });
    opponentStatsShots = opponentStatsShots.concat(eventShots.length ? eventShots : awayShots.filter(function (shot) { return Number(shot.id_partida) === Number(match.id_partida); }));
  });
  var mode = $("stats-mode").value;
  var mapShots = mode === "opponents" ? awayShots : ownShots;
  if (mode === "players" && $("stats-search").value.trim()) { var searched = players.filter(function (p) { return ((p.dortsala != null ? "#" + p.dortsala + " " : "") + playerName(p)).toLocaleLowerCase().includes($("stats-search").value.trim().toLocaleLowerCase()); }).map(function (p) { return Number(p.id_jokalaria); }); mapShots = ownShots.filter(function (s) { return searched.indexOf(Number(s.id_jokalaria)) !== -1; }); }
  var isGoal = function (s) { return /gol/.test(String(s.mota || "").toLocaleLowerCase()); };
  var isPenalty = function (s) { return /penalti/.test(String(s.mota || "").toLocaleLowerCase()); };
  var shotCount = function (arr) { return arr.length; }, goalCount = function (arr) { return arr.filter(isGoal).length; };
  var sum = function (arr, key) { return arr.reduce(function (n, x) { return n + Number(x[key] || 0); }, 0); };
  var totalGoals = sum(filteredMatches, "emaitza_geurea"), against = sum(filteredMatches, "emaitza_aurkaria");
  var wins = filteredMatches.filter(function (m) { return Number(m.emaitza_geurea || 0) > Number(m.emaitza_aurkaria || 0); }).length;
  var draws = filteredMatches.filter(function (m) { return Number(m.emaitza_geurea || 0) === Number(m.emaitza_aurkaria || 0); }).length;
  var penalties = (mode === "opponents" ? opponentStatsShots : mapShots).filter(isPenalty), penaltyGoals = goalCount(penalties);
  var metric = function (name, value, detail) { return '<div class="card"><strong>' + esc(value) + '</strong><div>' + esc(name) + '</div><small class="muted">' + esc(detail || "") + '</small></div>'; };
  $("stats-summary").innerHTML = mode === "opponents" ? [metric(t("Partidak"), filteredMatches.length, t("Aurkariak: ") + Object.keys(Object.fromEntries(filteredMatches.map(function (m) { return [m.aurkaria || t("Aurkaria"), true]; }))).length), metric(t("Aurkariaren golak"), against, (filteredMatches.length ? (against / filteredMatches.length).toFixed(1) : "0.0") + t(" partidako")), metric(t("Jaurtiketen eraginkortasuna"), opponentStatsShots.length ? Math.round(goalCount(opponentStatsShots) / opponentStatsShots.length * 100) + "%" : "—", goalCount(opponentStatsShots) + t(" gol / ") + opponentStatsShots.length + t(" jaurtiketa")), metric(t("Gure golak"), totalGoals, t("Aurkariaren aurkako emaitza")), metric(t("Penaltiak"), penalties.length, penaltyGoals + t(" gol · ") + (penalties.length ? Math.round(penaltyGoals / penalties.length * 100) : 0) + "%"), metric(t("Zigorrak"), opponentEvents.filter(function (event) { return scoreIsSanction(event.type); }).length, t("Partida hauetan jasota"))].join("") : [metric(t("Partidak"), filteredMatches.length, wins + t(" garaipen · ") + draws + t(" berdinketa · ") + (filteredMatches.length - wins - draws) + t(" porrot")), metric(t("Golak"), totalGoals, (filteredMatches.length ? (totalGoals / filteredMatches.length).toFixed(1) : "0.0") + t(" partidako")), metric(t("Jaurtiketen eraginkortasuna"), ownShots.length ? Math.round(goalCount(ownShots) / ownShots.length * 100) + "%" : "—", goalCount(ownShots) + t(" gol / ") + ownShots.length + t(" jaurtiketa")), metric(t("Aurkariaren golak"), against, (filteredMatches.length ? (against / filteredMatches.length).toFixed(1) : "0.0") + t(" partidako")), metric(t("Penaltiak"), penalties.length, penaltyGoals + t(" gol · ") + (penalties.length ? Math.round(penaltyGoals / penalties.length * 100) : 0) + "%"), metric(t("Zigorrak"), sanctions.length, sanctions.filter(function (s) { return s.mota === "2min"; }).length + t(" bi minutuko"))].join("");
  $("stats-heading").textContent = mode === "team" ? t("Taldearen laburpena") : mode === "players" ? t("Jokalari estatistikak") : t("Aurkari estatistikak");
  $("stats-team-panel").classList.toggle("hidden", mode !== "team");
  $("stats-player-panel").classList.toggle("hidden", mode !== "players");
  $("stats-opponent-panel").classList.toggle("hidden", mode !== "opponents");
  var query = ($("stats-search").value || "").trim().toLocaleLowerCase();
  playerStats = players.map(function (p) {
    var rows = playerRows.filter(function (r) { return Number(r.id_jokalaria) === Number(p.id_jokalaria); });
    var ps = sanctions.filter(function (r) { return Number(r.id_jokalaria) === Number(p.id_jokalaria); });
    var pshots = ownShots.filter(function (s) { return Number(s.id_jokalaria) === Number(p.id_jokalaria); });
    var totalG = sum(rows, "golak"), totalS = sum(rows, "jaurtiketak"), pg = goalCount(pshots.filter(isPenalty)), pshot = pshots.filter(isPenalty).length;
    var label = (p.dortsala != null ? "#" + p.dortsala + " " : "") + playerName(p);
    var matchCount = new Set(rows.map(function (r) { return Number(r.id_partida); })).size;
    return { label: label, goals: totalG, shots: totalS, normalGoals: Math.max(0, totalG - pg), normalShots: Math.max(0, totalS - pshot), penaltyGoals: pg, penaltyShots: pshot, appearances: matchCount, yellow: ps.filter(function (s) { return s.mota === "horia"; }).length, two: ps.filter(function (s) { return s.mota === "2min"; }).length, red: ps.filter(function (s) { return s.mota === "gorria"; }).length, blue: ps.filter(function (s) { return s.mota === "urdina"; }).length };
  }).filter(function (s) { return (s.goals || s.shots || s.yellow || s.two || s.red || s.blue) && s.label.toLocaleLowerCase().includes(query); });
  $("stats-list").innerHTML = playerStats.length ? playerStats.map(function (s) { var pct = s.shots ? Math.round(s.goals / s.shots * 100) : 0, normalPct = s.normalShots ? Math.round(s.normalGoals / s.normalShots * 100) : 0, penaltyPct = s.penaltyShots ? Math.round(s.penaltyGoals / s.penaltyShots * 100) : 0; return '<li class="item"><div class="item-main"><strong>' + esc(s.label) + '</strong><small>' + s.appearances + t(" partida · Guztira: ") + s.goals + '/' + s.shots + ' (%' + pct + t(") · Jaurtiketa arruntak: ") + s.normalGoals + '/' + s.normalShots + ' (%' + normalPct + t(") · Penaltiak: ") + s.penaltyGoals + '/' + s.penaltyShots + ' (%' + penaltyPct + ')</small></div><span class="muted">🟨 ' + s.yellow + ' · 2\' ' + s.two + ' · 🟥 ' + s.red + ' · 🔵 ' + s.blue + '</span></li>'; }).join("") : ("<li class=\"empty\">" + esc(t("Ez dago iragazki hauekin bat datorren jokalari daturik.")) + "</li>");
  $("stats-players-visual").innerHTML = playerStats.length ? playerStats.map(function (s) {
    var pct = s.shots ? Math.round(s.goals / s.shots * 100) : 0;
    var normalPct = s.normalShots ? Math.round(s.normalGoals / s.normalShots * 100) : 0;
    var penaltyPct = s.penaltyShots ? Math.round(s.penaltyGoals / s.penaltyShots * 100) : 0;
    return '<article class="player-visual-card"><div class="pv-head"><div class="pv-name"><strong>' + esc(s.label) + '</strong><small>' + s.appearances + (esc(t(" partida")) + "</small></div><div><div class=\"efficiency-ring\" style=\"--efficiency:") + pct + ("%\" role=\"img\" aria-label=\"" + esc(t("Eraginkortasuna %"))) + pct + '"><span>' + pct + ("%</span></div><div class=\"efficiency-label\">" + esc(t("eraginkortasuna")) + "</div></div></div><div class=\"pv-metrics\"><div class=\"pv-metric\"><strong>") + s.goals + ("</strong><small>" + esc(t("Golak")) + "</small></div><div class=\"pv-metric\"><strong>") + s.shots + ("</strong><small>" + esc(t("Jaurtiketak")) + "</small></div><div class=\"pv-metric\"><strong>") + s.appearances + ("</strong><small>" + esc(t("Partidak")) + "</small></div></div><div class=\"pv-section-title\">" + esc(t("Jaurtiketen banaketa")) + "</div><div class=\"pv-breakdown\"><strong>" + esc(t("Arruntak")) + "</strong><span>") + s.normalGoals + ' / ' + s.normalShots + ' · %' + normalPct + '</span><div class="pv-bar"><i style="width:' + normalPct + ("%\"></i></div></div><div class=\"pv-breakdown\"><strong>" + esc(t("Penaltiak")) + "</strong><span>") + s.penaltyGoals + ' / ' + s.penaltyShots + ' · %' + penaltyPct + '</span><div class="pv-bar"><i style="width:' + penaltyPct + '%"></i></div></div><div class="pv-sanctions"><span>🟨 ' + s.yellow + '</span><span>2\' ' + s.two + '</span><span>🟥 ' + s.red + '</span><span>🔵 ' + s.blue + '</span></div></article>';
  }).join("") : ("<div class=\"empty\">" + esc(t("Ez dago iragazki hauekin bat datorren jokalari estatistikarik.")) + "</div>");
  var rivalMap = {};
  filteredMatches.forEach(function (m) { var name = m.aurkaria || t("Aurkaria"), x = rivalMap[name] || (rivalMap[name] = { matches: 0, gf: 0, ga: 0 }); x.matches++; x.gf += Number(m.emaitza_geurea || 0); x.ga += Number(m.emaitza_aurkaria || 0); });
  $("stats-opponent-list").innerHTML = Object.keys(rivalMap).sort().map(function (name) { var x = rivalMap[name], rivalIds = new Set(filteredMatches.filter(function (m) { return String(m.aurkaria || t("Aurkaria")) === name; }).map(function (m) { return Number(m.id_partida); })), rs = opponentStatsShots.filter(function (s) { return rivalIds.has(Number(s.id_partida)); }); return '<li class="item"><div class="item-main"><strong>' + esc(name) + '</strong><small>' + x.matches + t(" partida · Emaitzak ") + x.gf + '-' + x.ga + t(" · Aurkariaren jaurtiketak: ") + (rs.length ? rs.length + ' (' + goalCount(rs) + t(" gol, %") + Math.round(goalCount(rs) / rs.length * 100) + ')' : t("daturik gabe")) + '</small></div></li>'; }).join("") || ("<li class=\"empty\">" + esc(t("Ez dago aurkari daturik.")) + "</li>");
  var buckets = [0, 0, 0, 0, 0, 0, 0], bucketGoals = [0, 0, 0, 0, 0, 0, 0], labels = ["0–9", "10–19", "20–29", "30–39", "40–49", "50–59", "60+"];
  mapShots.forEach(function (s) { var minute = Number(s.minutua || 0), i = Math.min(6, Math.floor(minute / 10)); buckets[i]++; if (isGoal(s)) bucketGoals[i]++; });
  $("stats-period-chart").innerHTML = labels.map(function (label, i) { return '<div class="card"><strong>' + label + (esc(t(" min")) + "</strong><small> · ") + bucketGoals[i] + t(" gol / ") + buckets[i] + t(" jaurtiketa") + (buckets[i] ? " · %" + Math.round(bucketGoals[i] / buckets[i] * 100) : "") + '</small><div style="height:8px;background:var(--line);border-radius:8px;margin-top:8px"><div style="width:' + (buckets[i] ? Math.max(3, bucketGoals[i] / buckets[i] * 100) : 0) + '%;height:100%;background:var(--blue);border-radius:8px"></div></div></div>'; }).join("");
  renderOpponentIndividuals(filteredMatches, query);
  var zoneList = function (list, fieldX, fieldY, data, mapId, type) { var counts = {}, points = []; data.forEach(function (s) { var x = Number(s[fieldX]), y = Number(s[fieldY]); if (!Number.isFinite(x) || !Number.isFinite(y)) return; var col = x < .35 ? t("Ezkerreko") : x < .65 ? t("Erdiko") : t("Eskuinako"), row = type === "origin" ? "" : (y < .333 ? t("Goikoa") : y < .667 ? t("Erdikoa") : t("Behekoa")), key = type === "origin" ? (y < .377 ? (x < .35 ? t("Ezkerreko extremoa") : x < .65 ? t("Pibotea") : t("Eskubiko extremoa")) : (x < .35 ? t("Ezkerreko laterala") : x < .65 ? t("Zentrala") : t("Eskubiko laterala"))) : row + " · " + col, z = counts[key] || (counts[key] = { n: 0, g: 0 }); z.n++; if (isGoal(s)) z.g++; points.push({ x: x, y: y, goal: isGoal(s) }); }); var keys = Object.keys(counts).sort(); $(list).innerHTML = keys.length ? keys.map(function (k) { var z = counts[k]; return '<li class="item"><strong>' + esc(k) + '</strong><span>' + z.g + '/' + z.n + t(" gol (") + Math.round(z.g / z.n * 100) + '%)</span></li>'; }).join("") : ("<li class=\"empty\">" + esc(t("Ez dago koordenatudun jaurtiketarik.")) + "</li>"); var svg = type === "origin" ? ("<svg viewBox=\"0 0 800 520\" role=\"img\" aria-label=\"" + esc(t("Jaurtiketen jatorria zelaiaren irudian")) + "\"><image href=\"./irudiak/Zelai-erdia.png\" x=\"0\" y=\"0\" width=\"800\" height=\"520\" preserveAspectRatio=\"none\" transform=\"rotate(180 400 260)\"/>") : ("<svg viewBox=\"0 0 360 210\" role=\"img\" aria-label=\"" + esc(t("Atearen helburu mapa")) + "\"><rect width=\"360\" height=\"210\" fill=\"#26324a\"/><path d=\"M10 10H350V200H10Z M123 10V200 M237 10V200 M10 73H350 M10 137H350\" fill=\"none\" stroke=\"#fff\" stroke-opacity=\".8\" stroke-width=\"2\"/>");
    var circles = points.map(function (p) { var px = type === "origin" ? Math.max(10, Math.min(790, p.x * 800)) : 18 + Math.max(0, Math.min(1, p.x)) * 324, py = type === "origin" ? Math.max(10, Math.min(510, p.y * 520)) : 18 + Math.max(0, Math.min(1, p.y)) * 174; return '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="' + (type === "origin" ? "12" : "5") + '" fill="' + (p.goal ? "#20d67a" : "#ff5263") + '" fill-opacity=".88" stroke="#fff" stroke-width="2"/>'; }).join("");
    $(mapId).innerHTML = svg + circles + '</svg>'; };
  zoneList("stats-origin-zones", "jatorri_x", "jatorri_y", mapShots, "stats-court-map", "origin"); zoneList("stats-goal-zones", "helburu_x", "helburu_y", mapShots, "stats-goal-map", "goal");
  $("stats-penalties").innerHTML = penalties.length ? '<li class="item"><strong>' + penalties.length + (esc(t(" penalti")) + "</strong><span>") + penaltyGoals + t(" gol · ") + (penalties.length - penaltyGoals) + t(" huts · %") + Math.round(penaltyGoals / penalties.length * 100) + (esc(t(" eraginkortasuna")) + "</span></li>") : ("<li class=\"empty\">" + esc(t("Ez dago penalti jaurtiketen erregistrorik.")) + "</li>");
}

function planPad(value) { return String(value).padStart(2, "0"); }

function planKey(date) {
  return date.getFullYear() + "-" + planPad(date.getMonth() + 1) + "-" + planPad(date.getDate());
}

function planInput(value) {
  var text = String(value == null ? "" : value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function planDayNumber(value) {
  var text = String(value == null ? "" : value).slice(0, 10);
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function planShort(date) {
  return planPad(date.getDate()) + "/" + planPad(date.getMonth() + 1);
}

function planMacroList() {
  return records("makrozikloak").slice().sort(function (a, b) {
    return Number(a.id_makro) - Number(b.id_makro);
  });
}

function planMacroSpans() {
  var macroList = planMacroList();
  var microList = records("mikrozikloak");
  return macroList.map(function (macro) {
    var start = planDayNumber(macro.hasiera_data), end = planDayNumber(macro.amaiera_data);
    if (!start || !end) {
      var own = microList.filter(function (micro) {
        return Number(micro.id_makro) === Number(macro.id_makro);
      });
      var starts = own.map(function (micro) { return planDayNumber(micro.hasiera_data); }).filter(Boolean);
      var ends = own.map(function (micro) { return planDayNumber(micro.amaiera_data); }).filter(Boolean);
      if (!start && starts.length) start = new Date(Math.min.apply(null, starts));
      if (!end && ends.length) end = new Date(Math.max.apply(null, ends));
    }
    return {
      id: Number(macro.id_makro), izena: macro.izena,
      color: MACRO_PALETTE[(Number(macro.id_makro) - 1) % MACRO_PALETTE.length], start: start, end: end
    };
  }).filter(function (span) { return span.start && span.end; });
}

function planMicroList() {
  var macroById = {};
  records("makrozikloak").forEach(function (macro) { macroById[Number(macro.id_makro)] = macro; });
  var counters = {};
  return records("mikrozikloak").slice().sort(function (a, b) {
    return String(a.hasiera_data).localeCompare(String(b.hasiera_data)) ||
      Number(a.id_mikroziklo) - Number(b.id_mikroziklo);
  }).map(function (micro) {
    var macroId = Number(micro.id_makro) || 0;
    var index = counters[macroId] || 0;
    counters[macroId] = index + 1;
    var mota = micro.mota || "Karga";
    return {
      id: Number(micro.id_mikroziklo), macroId: macroId,
      makroIzena: macroById[macroId] ? macroById[macroId].izena : t("Makroziklorik gabe"),
      aste: micro.aste_zenbakia, mota: mota,
      start: planDayNumber(micro.hasiera_data), end: planDayNumber(micro.amaiera_data),
      color: MICRO_TYPE_COLORS[mota] || MICRO_TYPE_COLORS.Egokitzapena
    };
  }).filter(function (micro) { return micro.start && micro.end; });
}

function planWeeks(base) {
  var first = new Date(base.getFullYear(), base.getMonth(), 1);
  var cursor = new Date(first);
  cursor.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  var last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  last.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  var weeks = [];
  while (cursor <= last) {
    var week = [];
    for (var i = 0; i < 7; i++) { week.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }
    weeks.push(week);
  }
  return weeks;
}

function planDayHtml(day, base, todayKey, spans, microList) {
  var key = planKey(day);
  var classes = "plan-day" + (day.getMonth() === base.getMonth() ? "" : " out") +
    (key === todayKey ? " today" : "");
  var html = '<div class="' + classes + '" data-plan-day="' + key + '">' +
    '<span class="plan-day-num">' + (key === todayKey ? t("Gaur · ") : "") + day.getDate() + "</span>";
  var dayMacros = spans.filter(function (span) {
    return planKey(span.start) <= key && key <= planKey(span.end);
  });
  dayMacros.slice(0, 2).forEach(function (span) {
    var label = (key === planKey(span.start) || day.getDay() === 1 || day.getDate() === 1) ? span.izena : "";
    html += '<button type="button" class="plan-macro' + (label ? "" : " empty") + '" style="background:' + span.color +
      '" data-plan-macro="' + span.id + '" title="' + esc(span.izena) + ("\" aria-label=\"" + esc(t("Editatu makrozikloa: "))) + esc(span.izena) + '">' + esc(label) + "</button>";
  });
  if (dayMacros.length > 2) html += '<span class="plan-more">+' + (dayMacros.length - 2) + (esc(t(" makro")) + "</span>");
  var dayMicros = microList.filter(function (micro) {
    return planKey(micro.start) <= key && key <= planKey(micro.end);
  });
  dayMicros.slice(0, 3).forEach(function (micro) {
    var text = micro.makroIzena + t(" | A") + (micro.aste == null ? "" : micro.aste) + " " + t(micro.mota);
    html += '<button type="button" class="plan-micro" style="background:' + micro.color +
      '" data-plan-micro="' + micro.id + '" title="' + esc(text) + '">' + esc(text) + "</button>";
  });
  if (dayMicros.length > 3) html += '<span class="plan-more">+' + (dayMicros.length - 3) + (esc(t(" gehiago")) + "</span>");
  var dayMatches = records("partidak").filter(function (match) {
    return String(match.data_ordua || "").slice(0, 10) === key;
  });
  dayMatches.slice(0, 2).forEach(function (match) {
    var played = key <= todayKey && (Number(match.emaitza_geurea || 0) || Number(match.emaitza_aurkaria || 0));
    var text = played
      ? match.aurkaria + " (" + Number(match.emaitza_geurea || 0) + "-" + Number(match.emaitza_aurkaria || 0) + ")"
      : match.aurkaria + t(" (jolasteko)");
    html += '<button type="button" class="plan-event match" data-match-stats="' + Number(match.id_partida) + ("\" title=\"" + esc(t("Partidako estatistikak ikusi: "))) + esc(text) + '">' + esc(text) + "</button>";
  });
  records("saioak").filter(function (session) {
    return String(session.data_ordua || "").slice(0, 10) === key;
  }).slice(0, 2).forEach(function (session) {
    var text = session.helburu_taktikoa || t("Entrenamendua");
    html += '<button type="button" class="plan-event session" data-view-session="' + Number(session.id_saio) + ("\" title=\"" + esc(t("Entrenamendua ikusi: "))) + esc(text) + '">' + esc(text) + "</button>";
  });
  records("txapelketak").filter(function (cup) {
    return String(cup.data_ordua || "").slice(0, 10) === key;
  }).slice(0, 2).forEach(function (cup) {
    var text = (cup.izena || t("Txapelketa")) + (cup.kategoria ? " [" + cup.kategoria + "]" : "");
    html += '<button type="button" class="plan-event cup" data-view-cup="' + Number(cup.id_txapelketa) + ("\" title=\"" + esc(t("Txapelketaren xehetasunak ikusi: "))) + esc(text) + '">' + esc(text) + "</button>";
  });
  return html + "</div>";
}

function renderPlanning() {
  var grid = $("plan-grid");
  if (!grid) return;
  $("plan-card").classList.toggle("plan-view-month", planView === "month");
  document.querySelectorAll("[data-plan-view]").forEach(function (button) {
    button.setAttribute("aria-pressed", String(button.dataset.planView === planView));
  });
  var base = planMonth;
  $("plan-month").textContent = t(PLAN_MONTHS[base.getMonth()]) + " " + base.getFullYear();
  var spans = planMacroSpans();
  var microList = planMicroList();
  var monthStart = new Date(base.getFullYear(), base.getMonth(), 1);
  var monthEnd = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  var legendItems = spans.filter(function (span) {
    return span.start <= monthEnd && span.end >= monthStart;
  }).sort(function (a, b) { return a.start - b.start; });
  var macroLegend = legendItems.length ? legendItems.map(function (span) {
    return '<span><i style="background:' + span.color + '"></i>' + esc(span.izena) +
      " (" + planShort(span.start) + " - " + planShort(span.end) + ")</span>";
  }).join("") : ("<span class=\"muted\">" + esc(t("Ez dago makroziklorik hilabete honetan.")) + "</span>");
  var microLegend = MICRO_TYPES.map(function (type) {
    return '<span class="plan-legend-type"><i style="background:' + MICRO_TYPE_COLORS[type] + ("\"></i>" + esc(t("Mikro · "))) + esc(t(type)) + '</span>';
  }).join("");
  $("plan-legend").innerHTML = macroLegend + microLegend;
  var todayKey = planKey(new Date());
  grid.innerHTML = planWeeks(base).map(function (week) {
    return week.map(function (day) {
      return planDayHtml(day, base, todayKey, spans, microList);
    }).join("");
  }).join("");
  var agenda = [];
  function addAgenda(dateValue, kind, title, detail, actionAttr, actionId) {
    var date = planDayNumber(dateValue);
    if (!date || date.getFullYear() !== base.getFullYear() || date.getMonth() !== base.getMonth()) return;
    agenda.push({ date: date, kind: kind, title: title, detail: detail || "", actionAttr: actionAttr || "", actionId: actionId || 0 });
  }
  records("saioak").forEach(function (item) { addAgenda(item.data_ordua, t("Entrenamendua"), item.helburu_taktikoa || t("Entrenamendua"), formatDay(item), "data-view-session", item.id_saio); });
  records("partidak").forEach(function (item) { addAgenda(item.data_ordua, t("Partida"), item.aurkaria || t("Aurkaria"), formatDate(item), "data-match-stats", item.id_partida); });
  records("txapelketak").forEach(function (item) { addAgenda(item.data_ordua, t("Txapelketa"), item.izena || t("Txapelketa"), [item.kategoria, item.lekua].filter(Boolean).join(" · "), "data-view-cup", item.id_txapelketa); });
  records("mikrozikloak").forEach(function (item) { addAgenda(item.hasiera_data, t("Mikrozikloaren hasiera"), t(item.mota) || t("Mikrozikloa"), t("Amaiera: ") + (item.amaiera_data || "—"), "data-plan-micro", item.id_mikroziklo); });
  records("makrozikloak").forEach(function (item) { addAgenda(item.hasiera_data, t("Makrozikloaren hasiera"), item.izena || t("Makrozikloa"), t("Amaiera: ") + (item.amaiera_data || "—"), "data-plan-macro", item.id_makro); });
  agenda.sort(function (a, b) { return a.date - b.date || a.kind.localeCompare(b.kind); });
  $("plan-agenda").innerHTML = agenda.length ? agenda.map(function (item) {
    var dateLabel = item.date.toLocaleDateString(I18n.locale(), { weekday: "short" });
    var itemAction = item.actionAttr ? ' data-agenda-action="' + item.actionAttr + '" data-agenda-id="' + Number(item.actionId) + '" role="button" tabindex="0"' : "";
    return '<li class="item"' + itemAction + '><span class="agenda-date">' + dateLabel + '<br>' + item.date.getDate() + '</span><div class="agenda-detail"><span class="agenda-kind">' + esc(item.kind) + '</span><strong>' + esc(item.title) + '</strong><small class="muted">' + esc(item.detail) + '</small></div>' + (item.actionAttr ? '<span class="agenda-open" aria-hidden="true">›</span>' : '') + '</li>';
  }).join("") : ("<li class=\"empty\">" + esc(t("Hilabete honetan ez dago jarduerarik.")) + "</li>");
}

function planTypeOptions(current) {
  var names = records("mikro_motak").map(function (row) { return row.izena; }).filter(Boolean);
  if (!names.length) names = MICRO_TYPES.slice();
  if (current && names.indexOf(current) === -1) names = names.concat([current]);
  return names.map(function (name) {
    return '<option value="' + esc(name) + '"' + (name === current ? " selected" : "") + ">" + esc(t(name)) + "</option>";
  }).join("");
}

function planDefaultStart() { return planKey(planMonth); }
function planDefaultEnd() {
  var end = new Date(planMonth);
  end.setDate(end.getDate() + 6);
  return planKey(end);
}

function openPlanForm(kind, id) {
  id = id == null ? null : Number(id);
  planFormContext = { kind: kind, id: id };
  var isMacro = kind === "macro";
  var record = null;
  if (id) {
    record = isMacro
      ? records("makrozikloak").find(function (item) { return Number(item.id_makro) === id; })
      : records("mikrozikloak").find(function (item) { return Number(item.id_mikroziklo) === id; });
  }
  $("plan-modal-title").textContent = t((record ? "Editatu " : "Sortu ") + (isMacro ? "makrozikloa" : "mikrozikloa"));
  var fields = "";
  if (isMacro) {
    fields += ("<label>" + esc(t("Izena")) + "<input name=\"izena\" required maxlength=\"120\" value=\"") +
      esc(record ? record.izena : "") + '"></label>';
    fields += ("<div class=\"grid2\"><label>" + esc(t("Hasiera")) + "<input name=\"hasiera_data\" type=\"date\" value=\"") +
      esc(record ? planInput(record.hasiera_data) : planDefaultStart()) +
      ("\"></label><label>" + esc(t("Amaiera")) + "<input name=\"amaiera_data\" type=\"date\" value=\"") +
      esc(record ? planInput(record.amaiera_data) : planDefaultEnd()) + '"></label></div>';
  } else {
    var options = ("<option value=\"\">" + esc(t("Makroziklorik gabe")) + "</option>") + planMacroList().map(function (macro) {
      return '<option value="' + Number(macro.id_makro) + '"' +
        (record && Number(record.id_makro) === Number(macro.id_makro) ? " selected" : "") +
        ">" + esc(macro.izena) + "</option>";
    }).join("");
    fields += ("<label>" + esc(t("Makrozikloa")) + "<select name=\"id_makro\">") + options + "</select></label>";
    fields += ("<div class=\"grid2\"><label>" + esc(t("Hasiera")) + "<input name=\"hasiera_data\" type=\"date\" required value=\"") +
      esc(record ? planInput(record.hasiera_data) : planDefaultStart()) +
      ("\"></label><label>" + esc(t("Amaiera")) + "<input name=\"amaiera_data\" type=\"date\" required value=\"") +
      esc(record ? planInput(record.amaiera_data) : planDefaultEnd()) + '"></label></div>';
    fields += ("<div class=\"grid2\"><label>" + esc(t("Mota")) + "<select name=\"mota\">") +
      planTypeOptions(record ? record.mota : "Karga") +
      ("</select></label><label>" + esc(t("Aste-zenbakia")) + "<input name=\"aste_zenbakia\" type=\"number\" min=\"1\" max=\"53\" value=\"") +
      esc(record && record.aste_zenbakia != null ? record.aste_zenbakia : "") + '"></label></div>';
    fields += ("<label>" + esc(t("Helburu nagusia")) + "<input name=\"helburu_nagusia\" maxlength=\"250\" value=\"") +
      esc(record ? record.helburu_nagusia : "") + '"></label>';
  }
  fields += ("<div class=\"modal-actions\"><button class=\"btn\" type=\"submit\">" + esc(t("Gorde")) + "</button>") +
    ("<button class=\"btn secondary\" type=\"button\" data-plan-cancel>" + esc(t("Ezeztatu")) + "</button>") +
    (record ? ("<button class=\"btn danger\" type=\"button\" data-plan-delete>" + esc(t("Ezabatu")) + "</button>") : "") + "</div>";
  $("plan-form").innerHTML = fields;
  $("plan-modal").classList.remove("hidden");
  var first = $("plan-form").querySelector("input,select");
  if (first) first.focus();
}

function closePlanForm() {
  planFormContext = null;
  $("plan-modal").classList.add("hidden");
  $("plan-form").innerHTML = "";
}

async function submitPlanForm() {
  if (!planFormContext) return;
  var isMacro = planFormContext.kind === "macro";
  var action = "pwa_" + (planFormContext.id ? "update_" : "create_") + (isMacro ? "macro" : "micro");
  var data = Object.fromEntries(new FormData($("plan-form")).entries());
  if (planFormContext.id) data.id = Number(planFormContext.id);
  if (!isMacro) {
    data.id_makro = numberOrNull(data.id_makro);
    data.aste_zenbakia = numberOrNull(data.aste_zenbakia);
  }
  await request(Object.assign({ action: action, team_id: teamId }, data));
}

async function deletePlanRecord() {
  if (!planFormContext || !planFormContext.id) return;
  var isMacro = planFormContext.kind === "macro";
  await request({
    action: isMacro ? "pwa_delete_macro" : "pwa_delete_micro",
    team_id: teamId, id: Number(planFormContext.id)
  });
}

function stepPlanMonth(offset) {
  planMonth = new Date(planMonth.getFullYear(), planMonth.getMonth() + offset, 1);
  renderPlanning();
}

function renderCycles() {
  macros = records("makrozikloak");
  micros = records("mikrozikloak");
  $("macros-list").innerHTML = macros.length ? macros.map(function (macro) {
    return '<li class="item"><div class="item-main"><strong>' + esc(macro.izena) +
      '</strong><small>' + esc(macro.hasiera_data || "") +
      (macro.amaiera_data ? " – " + esc(macro.amaiera_data) : "") + "</small></div></li>";
  }).join("") : ("<li class=\"empty\">" + esc(t("Ez dago makroziklorik.")) + "</li>");
  $("session-micro").innerHTML = ("<option value=\"\">" + esc(t("Mikroziklorik gabe")) + "</option>") + micros.map(function (micro) {
    return '<option value="' + Number(micro.id_mikroziklo) + '">' + esc(t(micro.mota) || t("Mikrozikloa")) +
      " · " + esc(micro.hasiera_data || "") + "</option>";
  }).join("");
  $("micros-list").innerHTML = micros.length ? micros.map(function (micro) {
    return '<li class="item"><div class="item-main"><strong>' + esc(t(micro.mota) || t("Mikrozikloa")) +
      (micro.aste_zenbakia ? " · " + esc(micro.aste_zenbakia) + t(". astea") : "") +
      '</strong><small>' + esc(micro.hasiera_data || "") + " – " + esc(micro.amaiera_data || "") +
      (micro.helburu_nagusia ? " · " + esc(micro.helburu_nagusia) : "") +
      "</small></div></li>";
  }).join("") : ("<li class=\"empty\">" + esc(t("Ez dago mikroziklorik.")) + "</li>");
  renderPlanning();
}

function renderAttendance(sessionId) {
  var rows = records("saio_bertaratzea").filter(function (row) {
    return Number(row.id_saio) === Number(sessionId);
  });
  players.forEach(function (player) {
    var id = String(player.id_jokalaria);
    var check = document.querySelector('[data-att-player="' + id + '"]');
    var late = document.querySelector('[data-late="' + id + '"]');
    var type = document.querySelector('[data-late-type="' + id + '"]');
    var saved = rows.find(function (row) { return Number(row.id_jokalaria) === Number(id); });
    check.checked = saved ? Number(saved.bertaratu) === 1 : true;
    late.value = saved ? Number(saved.atzerapena_min || 0) : 0;
    type.value = saved ? saved.atzerapena_mota || "" : "";
  });
}

function openAttendanceDialog(sessionId) {
  var id = Number(sessionId);
  if (!id) return notify(t("Aukeratu entrenamendua lehenik"), "error");
  $("attendance-session").value = String(id);
  renderAttendance(id);
  var dialog = $("attendance-dialog");
  if (!dialog.open) dialog.showModal();
}

async function refreshAll() {
  var result = await request({ action: "team_snapshot", team_id: teamId });
  tables = result.tables || {};
  players = records("jokalariak").slice().sort(function (a, b) {
    return Number(a.dortsala || 999) - Number(b.dortsala || 999) ||
      playerName(a).localeCompare(playerName(b));
  });
  exercises = records("ariketak").slice().sort(function (a, b) {
    return String(a.izena).localeCompare(String(b.izena));
  });
  sessions = records("saioak").slice().sort(function (a, b) {
    return String(b.data_ordua).localeCompare(String(a.data_ordua));
  });
  matches = records("partidak").slice().sort(function (a, b) {
    return String(b.data_ordua).localeCompare(String(a.data_ordua));
  });
  renderPlayers(); renderExercises(); renderSessions(); renderMatches(); renderStats(); renderCycles(); renderDashboard();
}

function selectSection(id) {
  if (id !== "v-scoreboard" && scoreMatchMode) scoreExitMatchMode();
  if (id !== "v-board") stopBoardAnimation();
  setMobileMenu(false);
  if (id !== "v-session-view") stopSessionAnimation();
  if (id !== "v-session-detail" && previewAnimation &&
    previewAnimation.canvas.closest("#saved-session-exercises")) stopExerciseAnimation();
  var primarySection = id === "v-home" ? "v-home" :
    (["v-sessions", "v-board", "v-session-view", "v-session-detail"].indexOf(id) !== -1 ? "v-sessions" :
    (["v-matches", "v-scoreboard"].indexOf(id) !== -1 ? "v-matches" :
      (["v-planning", "v-players", "v-stats"].indexOf(id) !== -1 ? id : "v-more")));
  document.querySelectorAll("nav [data-v]").forEach(function (button) {
    button.setAttribute("aria-selected", String(button.dataset.v === primarySection));
  });
  document.querySelectorAll("#team-app section").forEach(function (section) {
    section.classList.toggle("on", section.id === id);
  });
  if (id === "v-friends") loadFriends();
  window.scrollTo(0, 0);
  if (id === "v-stats") renderStats();
}

var scoreboard = { home: 0, away: 0, seconds: 0, period: 0, running: false, events: [], lastTick: 0 };
var scoreTimeEditState = null;
var scoreMatchMode = false, scoreModePanels = [], scoreModeScroll = 0, scoreNativeFullscreen = false, scoreWakeLock = null, scoreWakePending = false;
var scoreTimer = 0, scoreSaving = false, scoreShotType = "normal", scoreSanctionSide = "home", pendingScoreAction = null, shotTargetEvent = null;
function scoreStorageKey() { return "7metro-scoreboard-" + (teamId || "local"); }
function scoreRead() {
  scoreDiscardTimeEdit();
  clearInterval(scoreTimer);
  pendingScoreAction = null; scoreShotType = "normal"; scoreSanctionSide = "home";
  if ($("score-player-dialog").open) $("score-player-dialog").close();
  scoreClearShot();
  scoreboard = { home: 0, away: 0, seconds: 0, period: 0, running: false, events: [], lastTick: 0, savedMatchId: null };
  try {
    var saved = JSON.parse(localStorage.getItem(scoreStorageKey()) || "null");
    if (saved && typeof saved === "object") scoreboard = Object.assign(scoreboard, saved, { running: false, lastTick: 0 });
  } catch (error) { console.warn(t("Markagailua ezin izan da kargatu"), error); }
  var settings = scoreboard.settings || {};
  $("score-home-name").value = settings.homeName || (team && team.izena) || "7metro";
  $("score-away-name").value = settings.awayName || t("Aurkaria");
  $("score-mode").value = ["match", "manual", "countdown"].includes(settings.mode) ? settings.mode : "match";
  $("score-minutes").value = Math.min(180, Math.max(1, Number(settings.minutes) || 30));
  scoreSaving = false;
  renderShotPlayers();
  $("score-save-status").textContent = scoreboard.savedMatchId ? t("Partida gordeta dago.") : t("Oraindik ez da gorde.");
}
function scoreSave() {
  scoreboard.settings = { homeName: $("score-home-name").value.trim(), awayName: $("score-away-name").value.trim(),
    mode: $("score-mode").value, minutes: Math.min(180, Math.max(1, Number($("score-minutes").value) || 30)) };
  try { localStorage.setItem(scoreStorageKey(), JSON.stringify(scoreboard)); }
  catch (error) { notify(t("Markagailua ezin izan da gorde gailuan"), "error"); }
}
function scoreIsLocked() { return Boolean(scoreboard.savedMatchId || scoreSaving); }
function scoreIsSanction(type) { return ["horia", "2min", "gorria", "urdina"].includes(type); }
function scoreIsShot(type) { return ["gol", "jaurtiketa", "penalti_gol", "penalti_jaurtiketa"].includes(type); }
function scoreRenderSanctions() {
  document.querySelectorAll("[data-score-sanction]").forEach(function (button) {
    button.disabled = scoreIsLocked() || (scoreSanctionSide === "home" && !players.length);
    button.setAttribute("aria-label", (scoreSanctionSide === "away" ? t("Aurkaria: ") : t("Gure taldea: ")) + scoreActionLabel(button.dataset.scoreSanction));
  });
  document.querySelectorAll("[data-sanction-side]").forEach(function (button) {
    button.disabled = scoreIsLocked();
    button.setAttribute("aria-pressed", String(button.dataset.sanctionSide === scoreSanctionSide));
  });
  $("score-sanction-note").hidden = scoreSanctionSide === "away" || Boolean(players.length);
}
function scoreOpponentLabel(player) {
  if (!player) return t("Jokalaria zehaztu gabe");
  var number = String(player.zenbakia == null ? "" : player.zenbakia).trim();
  return [(number ? "#" + number : ""), player.izena || ""].filter(Boolean).join(" ");
}
function scoreOpponentKey(player) {
  var number = String(player.zenbakia == null ? "" : player.zenbakia).trim();
  return number ? "number:" + (/^\d+$/.test(number) ? String(Number(number)) : number) : "name:" + String(player.izena || "").trim().toLocaleLowerCase();
}
function scoreOpponents() {
  var result = [];
  (scoreboard.opponents || []).concat(scoreboard.events.filter(function (event) { return event.side === "away"; }).map(function (event) { return event.aurkaria; })).forEach(function (player) {
    if (!player || !(player.zenbakia || player.izena)) return;
    if (!result.some(function (existing) { return scoreOpponentKey(existing) === scoreOpponentKey(player); })) result.push(player);
  });
  return result;
}
function renderShotPlayers() {
  var select = $("shot-player"), selected = select.value, away = $("shot-team").value === "away";
  var rows = away ? scoreOpponents() : players;
  select.disabled = false;
  select.innerHTML = ("<option value=\"\">" + esc(t("Ez zehaztu")) + "</option>") + rows.map(function (player, index) {
    return '<option value="' + (away ? "opp:" + index : Number(player.id_jokalaria)) + '">' + esc(away ? scoreOpponentLabel(player) : playerName(player)) + '</option>';
  }).join("");
  select.value = selected;
  if (select.selectedIndex < 0) select.value = "";
}
function shotSelectedOpponent() {
  if ($("shot-team").value !== "away" || !/^opp:\d+$/.test($("shot-player").value)) return null;
  return scoreOpponents()[Number($("shot-player").value.slice(4))] || null;
}
function scoreIsGoal(type) { return type === "gol" || type === "penalti_gol"; }
function scoreActionLabel(type) {
  return { gol: t("Gola"), jaurtiketa: t("Jaurtiketa huts"), penalti_gol: t("7 m: gola"), penalti_jaurtiketa: t("7 m: huts"), zuzenketa: t("Emaitzaren zuzenketa"), horia: t("Txartel horia"), "2min": t("2 minutuko zigorra"), gorria: t("Txartel gorria"), urdina: t("Txartel urdina") }[type] || t("Ekintza");
}
function scoreEventText(event) {
  return event.time + " \u00b7 " + (event.side === "away" ? t("Aurkaria") : t("Gure taldea")) + " \u00b7 " + scoreActionLabel(event.type) +
    (event.player ? " \u00b7 " + event.player : "") + (event.shot_from && event.shot_to ? t(" · Kokapenarekin") : "");
}

function scoreFormat(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds) || 0));
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}
function scoreRender() {
  var locked = scoreIsLocked(), last = scoreboard.events[scoreboard.events.length - 1];
  $("score-home").textContent = scoreboard.home;
  $("score-away").textContent = scoreboard.away;
  $("score-home-label").textContent = $("score-home-name").value.trim() || t("Gure taldea");
  $("score-away-label").textContent = $("score-away-name").value.trim() || t("Aurkaria");
  $("score-clock").textContent = scoreFormat(scoreboard.seconds);
  $("score-start").textContent = scoreboard.running ? t("Pausatu denbora") : t("Hasi denbora");
  $("score-live-state").textContent = scoreboard.savedMatchId ? t("Partida gordeta") : scoreboard.running ? t("Martxan") : t("Pausatuta");
  $("score-live-panel").classList.toggle("is-running", scoreboard.running);
  $("score-period").textContent = (scoreboard.period + 1) + t(". zatia");
  $("score-undo").disabled = locked || !last;
  $("score-add-location").disabled = locked || !last || !scoreIsShot(last.type);
  $("score-last-event").textContent = last ? scoreEventText(last) : t("Oraindik ez dago ekintzarik.");
  $("score-add-location").textContent = last && last.shot_from ? t("Kokapena editatu") : t("Kokapena gehitu");
  $("score-event-count").textContent = scoreboard.events.length;
  $("score-events").innerHTML = scoreboard.events.length ? scoreboard.events.slice().reverse().map(function (event) {
    return '<li class="item"><div class="item-main"><strong>' + esc(event.score) + ' \u00b7 ' + esc(scoreActionLabel(event.type)) + '</strong><small>' + esc(scoreEventText(event)) + '</small></div></li>';
  }).join("") : ("<li class=\"empty\">" + esc(t("Oraindik ez da gertaerarik erregistratu.")) + "</li>");
  document.querySelectorAll("[data-quick-side], [data-score], [data-score-type]").forEach(function (button) { button.disabled = locked; });
  ["score-start", "score-clock-edit", "score-period-next", "score-home-name", "score-away-name", "score-mode", "score-minutes", "score-save-date", "score-save-venue"].forEach(function (id) { $(id).disabled = locked; });
  $("score-reset").disabled = scoreSaving;
  $("score-save-match").disabled = locked;
  $("score-opponent-stats").classList.toggle("hidden", !Number.isSafeInteger(scoreboard.savedMatchId) || scoreboard.savedMatchId < 1);
  $("score-save-match").textContent = scoreSaving ? t("Gordetzen...") : scoreboard.savedMatchId ? t("Partida gordeta") : t("Partida hau gorde");
  $("shot-record").disabled = locked || !(shotOrigin() && shotTo);
  scoreRenderShotType();
  scoreRenderSanctions();
}
function scoreRenderShotType() {
  document.querySelectorAll("[data-score-type]").forEach(function (button) {
    button.setAttribute("aria-pressed", String(button.dataset.scoreType === scoreShotType));
  });
  document.querySelectorAll("[data-quick-side]").forEach(function (button) {
    var goal = button.dataset.quickResult === "goal", penalty = scoreShotType === "penalty";
    var label = goal ? (penalty ? t("7 m: gola") : t("Gola")) : (penalty ? t("7 m: huts") : t("Jaurtiketa huts"));
    if (goal) button.querySelector("strong").textContent = label;
    else button.textContent = label;
    button.setAttribute("aria-label", (button.dataset.quickSide === "home" ? t("Gure taldea: ") : t("Aurkaria: ")) + label);
  });
}
var scoreLocationStep = "court", scoreLocationExact = false;
var shotFrom = null, shotTo = null, shotCourtImage = new Image();
shotCourtImage.src = "irudiak/Zelai-erdia.png";
shotCourtImage.onload = function () { drawShotCanvases(); };
function shotIsPenalty() {
  var type = shotTargetEvent ? shotTargetEvent.type : $("shot-result").value;
  return type === "penalti_gol" || type === "penalti_jaurtiketa";
}
function shotOrigin() {
  // Seven-metre mark in the rotated Zelai-erdia.png coordinate system.
  return shotIsPenalty() ? [0.5, 0.43] : shotFrom;
}
function drawShotCanvases() {
  var court = $("shot-court-canvas"), goal = $("shot-goal-canvas");
  if (!court || !goal) return;
  var penalty = shotIsPenalty();
  $("shot-result").dataset.penalty = String(penalty);
  $("shot-court-panel").hidden = penalty;
  $("score-shot-maps").classList.toggle("is-penalty", penalty);
  $("shot-goal-title").textContent = penalty ? t("Helmuga atean") : t("2. Helmuga atean");
  var ctx = court.getContext("2d"), w = court.width, h = court.height;
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = "#4a7c4f"; ctx.fillRect(0, 0, w, h);
  if (shotCourtImage.complete && shotCourtImage.naturalWidth) {
    ctx.save(); ctx.translate(w, h); ctx.rotate(Math.PI); ctx.drawImage(shotCourtImage, 0, 0, w, h); ctx.restore();
  } else {
    ctx.fillStyle = "#c8e6c9"; ctx.fillRect(4, 4, w - 8, h - 8);
    ctx.strokeStyle = "#2e7d32"; ctx.lineWidth = 6; ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.beginPath(); ctx.moveTo(4, h - 4); ctx.lineTo(w - 4, h - 4); ctx.stroke();
    ctx.strokeStyle = "#e53935"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(w / 2, 20, w * .3, 0, Math.PI); ctx.stroke();
    ctx.strokeStyle = "#1e88e5"; ctx.setLineDash([12, 10]); ctx.beginPath(); ctx.arc(w / 2, 20, w * .43, 0, Math.PI); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#333"; ctx.fillRect(w * .47, 10, w * .06, 8);
  }
  if (shotFrom) drawShotMarker(ctx, shotFrom, w, h);
  ctx = goal.getContext("2d"); w = goal.width; h = goal.height;
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = "#1a1a2e"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#d4a017"; ctx.lineWidth = 6; ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.strokeStyle = "#444"; ctx.lineWidth = 2;
  for (var x = 60; x < w - 12; x += 60) { ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, h - 8); ctx.stroke(); }
  for (var y = 55; y < h - 12; y += 55) { ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(w - 8, y); ctx.stroke(); }
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(12, h - 12); ctx.lineTo(12, 12); ctx.lineTo(w - 12, 12); ctx.lineTo(w - 12, h - 12); ctx.stroke();
  ctx.strokeStyle = "#888"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(16, h - 12); ctx.lineTo(w - 16, h - 12); ctx.stroke();
  if (shotTo) drawShotMarker(ctx, shotTo, w, h);
  var destinationHint = shotTo ? t("Ateko helmuga aukeratuta") : t("Aukeratu helmuga atean");
  $("shot-location-hint").textContent = penalty ? destinationHint :
    (shotFrom ? t("Kantxako jatorria aukeratuta") : t("Aukeratu jatorria kantxan")) + " \u00b7 " + destinationHint;
  $("shot-record").disabled = scoreIsLocked() || !(shotOrigin() && shotTo);
  renderQuickLocation();
}
function drawShotMarker(ctx, point, w, h) {
  var x = point[0] * w, y = point[1] * h;
  ctx.beginPath(); ctx.arc(x, y, Math.max(9, w * .018), 0, Math.PI * 2);
  ctx.fillStyle = "#ed3434"; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.stroke();
}
function quickLocationActive() { return $("score-location-dialog").classList.contains("quick-location"); }
function renderQuickLocation() {
  var quick = quickLocationActive(), penalty = shotIsPenalty();
  var side = $("shot-team").value === "away" ? t("Aurkaria") : t("Gure taldea");
  var player = $("shot-player").selectedOptions[0];
  $("shot-fields-summary").textContent = [side, scoreActionLabel($("shot-result").value), player && $("shot-player").value ? player.textContent : t("Jokalaria zehaztu gabe")].join(" \u00b7 ");
  if (!quick) { $("shot-court-panel").hidden = penalty; $("shot-goal-panel").hidden = false; return; }
  if (penalty) scoreLocationStep = "goal";
  else if (scoreLocationStep === "goal" && !shotOrigin()) scoreLocationStep = "court";
  $("score-location-dialog").classList.toggle("is-penalty", penalty);
  $("shot-court-panel").hidden = penalty || scoreLocationStep !== "court";
  $("shot-goal-panel").hidden = scoreLocationStep !== "goal";
  $("score-location-dialog").classList.toggle("is-exact", scoreLocationExact);
  document.querySelectorAll("[data-location-step]").forEach(function (button) {
    var court = button.dataset.locationStep === "court";
    button.classList.toggle("hidden", court && penalty);
    button.disabled = court ? penalty : !shotOrigin();
    button.setAttribute("aria-pressed", String(button.dataset.locationStep === scoreLocationStep));
    if (!court) button.textContent = penalty ? t("7 m: Atea") : t("2. Atea");
  });
  $("shot-exact-toggle").classList.toggle("hidden", scoreLocationStep !== "goal");
  $("shot-exact-toggle").setAttribute("aria-pressed", String(scoreLocationExact));
  $("shot-exact-toggle").textContent = scoreLocationExact ? t("9 zonak") : t("Puntu zehatza");
  $("shot-quick-instruction").textContent = scoreLocationStep === "court" ? t("Ukitu kantxan nondik jaurti duen") :
    scoreLocationExact ? t("Ukitu ateko puntua gordetzeko") : t("Ukitu ateko zona gordetzeko");
  document.querySelectorAll("[data-shot-zone]").forEach(function (button) {
    var index = Number(button.dataset.shotZone);
    var selected = shotTo && Math.min(2, Math.floor(shotTo[1] * 3)) * 3 + Math.min(2, Math.floor(shotTo[0] * 3)) === index;
    button.setAttribute("aria-pressed", String(Boolean(selected)));
    button.disabled = scoreIsLocked();
  });
}
function setupQuickLocation() {
  scoreLocationStep = shotIsPenalty() ? "goal" : "court";
  scoreLocationExact = false;
  $("score-location-dialog").classList.add("quick-location");
  $("shot-fields-details").open = !shotTargetEvent;
  drawShotCanvases();
  $("score-location-dialog").scrollTop = 0;
}
function commitQuickLocation() {
  if (quickLocationActive() && shotOrigin() && shotTo && !scoreIsLocked()) $("shot-record").click();
}
function bindShotCanvas(id, setter) {
  $(id).addEventListener("click", function (event) {
    if (event.button !== 0 || scoreIsLocked()) return;
    if (quickLocationActive() && id === "shot-goal-canvas" && !scoreLocationExact) return;
    var rect = event.currentTarget.getBoundingClientRect();
    setter([Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))]);
    if (quickLocationActive() && id === "shot-court-canvas") {
      scoreLocationStep = "goal";
      $("shot-fields-details").open = false;
      $("score-location-dialog").scrollTop = 0;
    }
    drawShotCanvases();
    if (id === "shot-goal-canvas") commitQuickLocation();
  });
}
function scoreSnapshot(side, type) {
  scoreUpdate();
  return { side: side, type: type, seconds: scoreboard.seconds, time: scoreFormat(scoreboard.seconds), period: scoreboard.period + 1 };
}
function scoreBeginAction(side, type) {
  if (scoreIsLocked()) return;
  if (scoreIsSanction(type) && side === "home" && !players.length) return notify(t("Gehitu jokalariak Taldea atalean zigorra esleitzeko"), "error");
  var action = scoreSnapshot(side, type), away = side === "away";
  $("score-player-unspecified").classList.toggle("hidden", scoreIsSanction(type));
  $("score-opponent-add").classList.toggle("hidden", !away);
  $("score-opponent-form").reset(); $("score-opponent-error").hidden = true;
  if (!away && !players.length) { scoreRecordAction(action, null); return; }
  pendingScoreAction = action;
  $("score-player-title").textContent = scoreActionLabel(type) + " \u00b7 " + (away ? t("Aurkariaren jokalaria") : t("Jokalaria"));
  $("score-player-time").textContent = action.time + " \u00b7 " + action.period + t(". zatia");
  var roster = away ? scoreOpponents() : players.slice().sort(function (a, b) { return (Number(a.dortsala) || 0) - (Number(b.dortsala) || 0); });
  $("score-opponent-add").open = away && !roster.length;
  $("score-player-grid").innerHTML = roster.map(function (player, index) {
    var number = away ? player.zenbakia : player.dortsala, label = away ? scoreOpponentLabel(player) : playerName(player);
    return '<button type="button" class="score-player-choice" ' + (away ? 'data-score-opponent="' + index : 'data-score-player="' + Number(player.id_jokalaria)) + '" aria-label="' + esc(label) + '"><strong>' + esc(number == null || number === "" ? "\u2014" : number) + '</strong><span>' + esc(away ? player.izena || t("Aurkaria") : playerName(player)) + '</span></button>';
  }).join("");
  $("score-player-dialog").showModal();
}
function scoreRecordAction(action, playerId, from, to, opponentPlayer) {
  if (scoreIsLocked()) return;
  var player = action.side === "home" && players.find(function (item) { return Number(item.id_jokalaria) === Number(playerId); });
  if (scoreIsSanction(action.type) && !(action.side === "away" ? opponentPlayer : player)) return;
  if (scoreIsGoal(action.type)) scoreboard[action.side]++;
  var name = $(action.side === "home" ? "score-home-name" : "score-away-name").value.trim();
  var opponent = action.side === "away" && opponentPlayer ? { zenbakia: opponentPlayer.zenbakia || "", izena: opponentPlayer.izena || "" } : null;
  var entry = Object.assign({}, action, { team: name || (action.side === "home" ? "Gure taldea" : "Aurkaria"),
    playerId: player ? Number(player.id_jokalaria) : null, player: player ? playerName(player) : opponent ? scoreOpponentLabel(opponent) : "", aurkaria: opponent, score: scoreboard.home + "-" + scoreboard.away });
  if (from && to) { entry.shot_from = from.slice(); entry.shot_to = to.slice(); }
  scoreboard.events.push(entry);
  if (scoreIsShot(action.type)) scoreShotType = "normal";
  renderShotPlayers(); scoreSave(); scoreRender();
}
function scoreClearShot() {
  shotTargetEvent = null; shotFrom = null; shotTo = null;
  $("shot-context").textContent = t("Jaurtiketa berria");
  $("shot-team").disabled = false; $("shot-result").disabled = false;
  renderShotPlayers();
  $("shot-cancel-edit").hidden = true;
  $("shot-record").textContent = t("Jaurtiketa erregistratu");
  drawShotCanvases();
}
function scoreUndo() {
  if (scoreIsLocked() || !scoreboard.events.length) return;
  var entry = scoreboard.events.pop();
  var side = entry.side || (entry.team === $("score-home-name").value.trim() ? "home" : "away");
  if (entry.type === "zuzenketa") scoreboard[side] = Math.max(0, scoreboard[side] - entry.delta);
  else if (scoreIsGoal(entry.type)) scoreboard[side] = Math.max(0, scoreboard[side] - 1);
  if (shotTargetEvent === entry) scoreClearShot();
  scoreSave(); scoreRender();
}
var friendsCache = { friends: [], incoming: [], outgoing: [] };
var friendExercises = [], friendTrainings = [], friendSharedExercises = [], friendSharedTrainings = [];
function setFriendOptions(id, rows, placeholder) {
  var select = $(id);
  var prior = select.value;
  select.innerHTML = '<option value="">' + esc(placeholder) + '</option>' + rows.map(function (row) {
    return '<option value="' + Number(row.user_id || row.id_ariketa || row.id_saio) + '">' +
      esc(row.username || row.izena || ((row.data_ordua || t("Entrenamendua")) + " · " + (row.helburu_taktikoa || ""))) + '</option>';
  }).join("");
  if (rows.some(function (row) { return String(row.user_id || row.id_ariketa || row.id_saio) === prior; })) select.value = prior;
}
function renderShareExerciseOptions() {
  var list = $("share-exercise-items");
  if (!list) return;
  list.innerHTML = friendExercises.length ? friendExercises.map(function (exercise) {
    return '<label class="checkrow"><input type="checkbox" data-share-exercise="' + Number(exercise.id_ariketa) + '"><span>' + esc(exercise.izena || t("Ariketa")) + '</span></label>';
  }).join("") : ("<div class=\"empty\">" + esc(t("Ez dago partekatzeko ariketarik.")) + "</div>");
  updateShareExerciseCount();
}
function selectedShareExerciseIds() {
  return Array.from(document.querySelectorAll('#share-exercise-items [data-share-exercise]:checked'))
    .map(function (input) { return Number(input.dataset.shareExercise); });
}
function updateShareExerciseCount() {
  var count = $("share-exercise-count");
  if (count) count.textContent = selectedShareExerciseIds().length + t(" hautatuta");
}
function renderFriends() {
  var sharedExercises = friendSharedExercises, sharedTrainings = friendSharedTrainings;
    $("friend-incoming").innerHTML = friendsCache.incoming.length ? friendsCache.incoming.map(function (item) {
      return '<li class="item"><div class="item-main"><strong>' + esc(item.username) + ("</strong><small>" + esc(t("Lagun-eskaera")) + "</small></div><button class=\"btn secondary\" data-friend-action=\"friend_accept\" data-id=\"") + Number(item.id) + ("\">" + esc(t("Onartu")) + "</button><button class=\"btn danger\" data-friend-action=\"friend_reject\" data-id=\"") + Number(item.id) + ("\">" + esc(t("Baztertu")) + "</button></li>");
    }).join("") : ("<li class=\"empty\">" + esc(t("Ez dago sarrerako eskaerarik.")) + "</li>");
    $("friends-list").innerHTML = friendsCache.friends.length ? friendsCache.friends.map(function (item) {
      return '<li class="item"><div class="item-main"><strong>' + esc(item.username) + ("</strong><small>" + esc(t("Lagun")) + "</small></div><button class=\"btn danger\" data-friend-action=\"friend_remove\" data-id=\"") + Number(item.id) + ("\">" + esc(t("Laguna kendu")) + "</button></li>");
    }).join("") : ("<li class=\"empty\">" + esc(t("Onartutako lagunik ez duzu oraindik.")) + "</li>");
    $("friend-outgoing").innerHTML = friendsCache.outgoing.length ? '<li class="notice">' + friendsCache.outgoing.map(function (item) { return esc(item.username) + t(" — eskaera bidalita"); }).join(" · ") + '</li>' : '';
    $("friend-shared-exercises").innerHTML = sharedExercises.length ? sharedExercises.map(function (item) {
      return '<li class="item"><div class="item-main"><strong>' + esc(item.izena) + '</strong><small>' + esc(item.shared_by_username || t("Lagun batek partekatua")) + (item.is_saved ? t(" · Nire ariketetan gordeta") : '') + '</small></div>' + (item.is_saved ? '' : '<button class="btn secondary" data-save-shared-exercise="' + Number(item.id_ariketa) + ("\">" + esc(t("Nire ariketetara gehitu")) + "</button>")) + '<button class="btn secondary" data-show-shared-exercise="' + Number(item.id_ariketa) + ("\">" + esc(t("Xehetasunak")) + "</button></li>");
    }).join("") : ("<li class=\"empty\">" + esc(t("Oraindik ez dizute ariketarik partekatu.")) + "</li>");
    $("friend-shared-trainings").innerHTML = sharedTrainings.length ? sharedTrainings.map(function (item) {
      var details = (item.details || []).map(function (detail) { return detail.exercise ? (detail.ordena || "") + ". " + detail.exercise.izena + " · " + (detail.iraupena_minutuak || 0) + " min" : detail.taldea || ""; }).filter(Boolean).join("\n");
      return '<li class="item"><div class="item-main"><strong>' + esc(item.helburu_taktikoa || t("Entrenamendua")) + '</strong><small>' + esc(formatDay(item) + " · " + (item.shared_by_username || t("Lagun batek partekatua"))) + '</small><small>' + esc(details || t("Ez dago ariketa xehetasunik")) + '</small></div></li>';
    }).join("") : ("<li class=\"empty\">" + esc(t("Oraindik ez dizute entrenamendurik partekatu.")) + "</li>");
    setFriendOptions("share-exercise-friend", friendsCache.friends, t("Aukeratu laguna"));
    setFriendOptions("share-training-friend", friendsCache.friends, t("Aukeratu laguna"));
    setFriendOptions("team-invite-friend", friendsCache.friends, t("Aukeratu gonbidatzeko laguna"));
    renderShareExerciseOptions();
    setFriendOptions("share-training-item", friendTrainings, t("Aukeratu entrenamendua"));
}
async function loadFriends() {
  [$("friend-incoming"), $("friends-list"), $("friend-outgoing"), $("friend-shared-exercises"), $("friend-shared-trainings")].forEach(function (el) { el.innerHTML = ("<li class=\"empty\">" + esc(t("Kargatzen…")) + "</li>"); });
  try {
    var results = await Promise.all([
      request({ action: "friends_list" }), request({ action: "my_exercises" }),
      request({ action: "my_trainings" }), request({ action: "shared_exercises" }),
      request({ action: "shared_trainings" })
    ]);
    friendsCache = results[0];
    friendExercises = (results[1].exercises || []).filter(function (item) { return !item._is_shared; });
    friendTrainings = results[2].trainings || [];
    var sharedExercises = results[3].exercises || [], sharedTrainings = results[4].trainings || [];
    friendSharedExercises = sharedExercises;
    friendSharedTrainings = sharedTrainings;
    renderFriends();
  } catch (error) {
    [$("friend-incoming"), $("friends-list")].forEach(function (el) { el.innerHTML = '<li class="notice error">' + esc(error.message) + '</li>'; });
    notify(error.message, "error");
  }
}
$("friend-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  try {
    await request({ action: "friend_add", username: $("friend-username").value.trim().toLowerCase() });
    $("friend-username").value = ""; notify(t("Lagun-eskaera bidali da"), "success"); await loadFriends();
  } catch (error) { notify(error.message, "error"); }
});
$("friends-refresh").addEventListener("click", function () { loadFriends(); });
$("friend-share-exercise").addEventListener("submit", async function (event) {
  event.preventDefault();
  var exerciseIds = selectedShareExerciseIds();
  if (!exerciseIds.length) return notify(t("Hautatu gutxienez ariketa bat"), "error");
  if (exerciseIds.length > 100) return notify(t("Gehienez 100 ariketa parteka ditzakezu aldi bakoitzean"), "error");
  try {
    var result = await request({ action: "exercise_share_many", friend_id: Number($("share-exercise-friend").value), exercise_ids: exerciseIds });
    var shared = Number(result.shared_count) || 0, existing = Number(result.already_shared_count) || 0;
    notify(shared ? shared + t(" ariketa partekatu dira") + (existing ? "; " + existing + t(" aurretik partekatuta zeuden") : "") : t("Aukeratutako ariketak lagun horrekin partekatuta zeuden jada"), "success");
    await loadFriends();
  } catch (error) { notify(error.message, "error"); }
});
$("share-exercise-items").addEventListener("change", updateShareExerciseCount);
$("share-exercise-select-all").addEventListener("click", function () {
  var boxes = Array.from(document.querySelectorAll('#share-exercise-items [data-share-exercise]'));
  boxes.forEach(function (box, index) { box.checked = index < 100; });
  updateShareExerciseCount();
  if (boxes.length > 100) notify(t("Lehenengo 100 ariketak hautatu dira; partekatu gainerakoak beste bidalketa batean"), "error");
});
$("share-exercise-clear").addEventListener("click", function () {
  document.querySelectorAll('#share-exercise-items [data-share-exercise]').forEach(function (box) { box.checked = false; });
  updateShareExerciseCount();
});
$("friend-share-training").addEventListener("submit", async function (event) {
  event.preventDefault();
  try {
    await request({ action: "training_share", friend_id: Number($("share-training-friend").value), training_id: Number($("share-training-item").value) });
    notify(t("Entrenamendua lagunarekin partekatu da"), "success"); await loadFriends();
  } catch (error) { notify(error.message, "error"); }
});
document.addEventListener("click", async function (event) {
  var target = event.target.closest("[data-friend-action], [data-save-shared-exercise], [data-show-shared-exercise]");
  if (!target) return;
  try {
    if (target.dataset.friendAction) {
      await request({ action: target.dataset.friendAction, request_id: Number(target.dataset.id) });
      notify(target.dataset.friendAction === "friend_accept" ? t("Lagun-eskaera onartu da") : t("Eskaera eguneratu da"), "success");
    } else if (target.dataset.saveSharedExercise) {
      await request({ action: "exercise_save", exercise_id: Number(target.dataset.saveSharedExercise) });
      notify(t("Ariketa zure zerrendara gehitu da"), "success");
    } else {
      var exercise = friendSharedExercises.find(function (item) { return Number(item.id_ariketa) === Number(target.dataset.showSharedExercise); });
      if (exercise) alert([exercise.izena, exercise.shared_by_username ? t("Nork partekatu du: ") + exercise.shared_by_username : "", exercise.deskribapena || "", exercise.jokalari_kopurua ? t("Jokalari kopurua: ") + exercise.jokalari_kopurua : "", exercise.bideo_url || ""].filter(Boolean).join("\n\n"));
      return;
    }
    await loadFriends();
  } catch (error) { notify(error.message, "error"); }
});
function scoreUpdate() {
  if (!scoreboard.running) return;
  var now = Date.now(), elapsed = Math.floor((now - scoreboard.lastTick) / 1000);
  if (elapsed < 1) return;
  var mode = $("score-mode").value, duration = Math.max(1, Number($("score-minutes").value) || 30) * 60;
  scoreboard.seconds = Math.max(0, scoreboard.seconds + (mode === "countdown" ? -elapsed : elapsed));
  scoreboard.lastTick += elapsed * 1000;
  if ((mode === "countdown" && scoreboard.seconds === 0) || (mode === "match" && scoreboard.seconds >= duration)) {
    if (mode === "match") scoreboard.seconds = duration;
    scoreboard.running = false; clearInterval(scoreTimer);
    notify(t("Zatia amaitu da"), "success");
  }
  scoreSave(); scoreRender();
}
function renderShotGoalZones() {
  $("shot-goal-zones").innerHTML = [t("Goian"), t("Erdian"), t("Behean")].map(function (row, y) {
  return [t("Ezkerra"), t("Erdia"), t("Eskuina")].map(function (column, x) {
    return '<button class="shot-goal-zone" type="button" data-shot-zone="' + (y * 3 + x) + '" aria-pressed="false" aria-label="' + row + ': ' + column + '"><span>' + row + '</span><strong>' + column + '</strong></button>';
  }).join("");
}).join("");
}
renderShotGoalZones();
$("shot-goal-zones").addEventListener("click", function (event) {
  var button = event.target.closest("[data-shot-zone]");
  if (!button || !quickLocationActive() || scoreIsLocked() || !shotOrigin()) return;
  var index = Number(button.dataset.shotZone);
  shotTo = [(index % 3 + 0.5) / 3, (Math.floor(index / 3) + 0.5) / 3];
  drawShotCanvases(); commitQuickLocation();
});
document.querySelectorAll("[data-location-step]").forEach(function (button) {
  button.addEventListener("click", function () { scoreLocationStep = this.dataset.locationStep; renderQuickLocation(); });
});
$("shot-exact-toggle").addEventListener("click", function () { scoreLocationExact = !scoreLocationExact; renderQuickLocation(); });
bindShotCanvas("shot-court-canvas", function (point) { shotFrom = point; });
bindShotCanvas("shot-goal-canvas", function (point) { shotTo = point; });
$("shot-player").addEventListener("change", drawShotCanvases);
$("shot-result").addEventListener("change", function () {
  if (this.dataset.penalty !== String(shotIsPenalty())) shotFrom = null;
  drawShotCanvases();
});
$("shot-team").addEventListener("change", function () {
  $("shot-player").value = "";
  renderShotPlayers();
  renderQuickLocation();
});
$("shot-record").addEventListener("click", function () {
  var origin = shotOrigin();
  if (scoreIsLocked() || !origin || !shotTo) return;
  if (shotTargetEvent) {
    if (!scoreboard.events.includes(shotTargetEvent)) { scoreClearShot(); return; }
    shotTargetEvent.shot_from = origin.slice(); shotTargetEvent.shot_to = shotTo.slice();
    var player = shotTargetEvent.side === "home" && players.find(function (item) { return Number(item.id_jokalaria) === Number($("shot-player").value); });
    shotTargetEvent.playerId = player ? Number(player.id_jokalaria) : null;
    var opponent = shotSelectedOpponent();
    shotTargetEvent.aurkaria = opponent ? Object.assign({}, opponent) : null;
    shotTargetEvent.player = player ? playerName(player) : opponent ? scoreOpponentLabel(opponent) : "";
    scoreSave(); scoreRender();
  } else {
    scoreRecordAction(scoreSnapshot($("shot-team").value, $("shot-result").value), $("shot-player").value, origin, shotTo, shotSelectedOpponent());
  }
  scoreClearShot(); $("score-shot-panel").open = false;
  if ($("score-location-dialog").open) $("score-location-dialog").close();
});
$("shot-cancel-edit").addEventListener("click", scoreClearShot);
$("score-add-location").addEventListener("click", function () {
  var entry = scoreboard.events[scoreboard.events.length - 1];
  if (scoreIsLocked() || !entry || !scoreIsShot(entry.type)) return;
  shotTargetEvent = entry;
  shotFrom = entry.shot_from ? entry.shot_from.slice() : null;
  shotTo = entry.shot_to ? entry.shot_to.slice() : null;
  $("shot-team").value = entry.side || "home"; $("shot-team").disabled = true;
  $("shot-result").value = entry.type; $("shot-result").disabled = true;
  renderShotPlayers();
  var opponentIndex = entry.aurkaria ? scoreOpponents().findIndex(function (player) { return scoreOpponentKey(player) === scoreOpponentKey(entry.aurkaria); }) : -1;
  $("shot-player").value = entry.side === "away" ? (opponentIndex >= 0 ? "opp:" + opponentIndex : "") : entry.playerId ? String(entry.playerId) : "";
  $("shot-context").textContent = t("Kokapena gehitu: ") + scoreEventText(entry);
  $("shot-record").textContent = t("Kokapena gorde"); $("shot-cancel-edit").hidden = false;
  $("score-shot-panel").open = true;
  drawShotCanvases();
  if (scoreMatchMode) { setupQuickLocation(); $("score-location-dialog").showModal(); }
  else $("score-shot-panel").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
});
document.querySelectorAll("[data-quick-side]").forEach(function (button) {
  button.addEventListener("click", function () {
    var goal = this.dataset.quickResult === "goal";
    var type = scoreShotType === "penalty" ? (goal ? "penalti_gol" : "penalti_jaurtiketa") : (goal ? "gol" : "jaurtiketa");
    scoreBeginAction(this.dataset.quickSide, type);
  });
});
document.querySelectorAll("[data-score-type]").forEach(function (button) {
  button.addEventListener("click", function () { scoreShotType = this.dataset.scoreType; scoreRenderShotType(); });
});
$("score-player-dialog").addEventListener("click", function (event) {
  var button = event.target.closest("[data-score-player], [data-score-opponent]");
  if (!button || !pendingScoreAction) return;
  var opponent = button.hasAttribute("data-score-opponent") ? scoreOpponents()[Number(button.dataset.scoreOpponent)] : null;
  scoreRecordAction(pendingScoreAction, button.dataset.scorePlayer, null, null, opponent);
  this.close();
});
$("score-player-unspecified").addEventListener("click", function () {
  if (pendingScoreAction && scoreIsSanction(pendingScoreAction.type)) return;
  if (pendingScoreAction) scoreRecordAction(pendingScoreAction, null);
  $("score-player-dialog").close();
});
$("score-player-cancel").addEventListener("click", function () { $("score-player-dialog").close(); });
$("score-player-dialog").addEventListener("close", function () { pendingScoreAction = null; });
document.querySelectorAll("[data-score-sanction]").forEach(function (button) {
  button.addEventListener("click", function () { scoreBeginAction(scoreSanctionSide, this.dataset.scoreSanction); });
});
document.querySelectorAll("[data-sanction-side]").forEach(function (button) {
  button.addEventListener("click", function () { scoreSanctionSide = this.dataset.sanctionSide; scoreRenderSanctions(); });
});
$("score-opponent-form").addEventListener("input", function () { $("score-opponent-error").hidden = true; });
$("score-opponent-form").addEventListener("submit", function (event) {
  event.preventDefault();
  if (!pendingScoreAction || pendingScoreAction.side !== "away" || scoreIsLocked()) return;
  var number = $("score-opponent-number").value.trim(), name = $("score-opponent-name").value.trim();
  if (!number && !name) { $("score-opponent-error").textContent = t("Idatzi dortsala edo izena."); $("score-opponent-error").hidden = false; return; }
  if (number && (!/^\d{1,3}$/.test(number) || Number(number) > 999)) return;
  var player = { zenbakia: number ? String(Number(number)) : "", izena: name };
  var roster = scoreOpponents(), existing = roster.find(function (item) { return scoreOpponentKey(item) === scoreOpponentKey(player); });
  if (existing) { if (name) existing.izena = name; player = existing; }
  else roster.push(player);
  scoreboard.opponents = roster;
  scoreRecordAction(pendingScoreAction, null, null, null, player);
  $("score-player-dialog").close();
});
$("score-undo").addEventListener("click", scoreUndo);
drawShotCanvases();
scoreRead(); scoreRender();
if (!$("score-save-date").value) $("score-save-date").value = localDateTime();
document.querySelectorAll("[data-score]").forEach(function (button) {
  button.addEventListener("click", function () {
    if (scoreIsLocked()) return;
    var side = this.dataset.score, delta = Number(this.dataset.delta);
    if (scoreboard[side] + delta < 0) return;
    var action = scoreSnapshot(side, "zuzenketa");
    scoreboard[side] += delta;
    scoreboard.events.push(Object.assign(action, { delta: delta, team: $(side === "home" ? "score-home-name" : "score-away-name").value,
      score: scoreboard.home + "-" + scoreboard.away }));
    scoreSave(); scoreRender();
  });
});
function scoreTimeLimit() {
  return $("score-mode").value === "manual" ? 999 * 60 + 59 : Math.max(1, Number($("score-minutes").value) || 30) * 60;
}
function scoreTimeDraft() {
  var minutes = $("score-time-minutes").value, seconds = $("score-time-seconds").value;
  if (minutes === "" || seconds === "" || !Number.isInteger(Number(minutes)) || !Number.isInteger(Number(seconds)) || Number(minutes) < 0 || Number(seconds) < 0 || Number(seconds) > 59) return null;
  return Number(minutes) * 60 + Number(seconds);
}
function scoreTimeCanRun(seconds) {
  if ($("score-mode").value === "manual") return true;
  return $("score-mode").value === "countdown" ? seconds > 0 : seconds < scoreTimeLimit();
}
function scoreRenderTimeDraft() {
  var draft = scoreTimeDraft(), canRun = draft !== null && draft <= scoreTimeLimit() && scoreTimeCanRun(draft);
  $("score-time-resume").disabled = !canRun;
  $("score-time-status").textContent = t("Kronoa pausatuta dago.") + (draft !== null && draft <= scoreTimeLimit() && !scoreTimeCanRun(draft) ? t(" Zatiaren amaiera.") : "");
}
function scoreSetTimeDraft(seconds) {
  $("score-time-minutes").value = String(Math.floor(seconds / 60));
  $("score-time-seconds").value = String(seconds % 60);
  $("score-time-error").hidden = true;
  scoreRenderTimeDraft();
}
function scoreResumeClock() {
  scoreboard.running = true; scoreboard.lastTick = Date.now();
  clearInterval(scoreTimer); scoreTimer = setInterval(scoreUpdate, 250);
}
function scoreDiscardTimeEdit() {
  scoreTimeEditState = null;
  if ($("score-time-dialog").open) $("score-time-dialog").close();
  $("score-clock-edit").setAttribute("aria-expanded", "false");
}
$("score-clock-edit").addEventListener("click", function () {
  if (scoreIsLocked()) return;
  scoreUpdate();
  scoreTimeEditState = { board: scoreboard, wasRunning: scoreboard.running, applied: false };
  scoreboard.running = false; clearInterval(scoreTimer);
  $("score-time-minutes").max = String(Math.floor(scoreTimeLimit() / 60));
  $("score-time-resume").checked = scoreTimeEditState.wasRunning;
  scoreSetTimeDraft(Math.min(scoreTimeLimit(), scoreboard.seconds));
  scoreSave(); scoreRender();
  this.setAttribute("aria-expanded", "true");
  $("score-time-dialog").showModal();
});
document.querySelectorAll("[data-score-time-delta]").forEach(function (button) {
  button.addEventListener("click", function () {
    if (scoreIsLocked() || !scoreTimeEditState) return;
    var draft = scoreTimeDraft();
    scoreSetTimeDraft(Math.max(0, Math.min(scoreTimeLimit(), (draft === null ? scoreboard.seconds : draft) + Number(this.dataset.scoreTimeDelta))));
  });
});
$("score-time-form").addEventListener("input", function () { $("score-time-error").hidden = true; scoreRenderTimeDraft(); });
$("score-time-form").addEventListener("submit", function (event) {
  event.preventDefault();
  if (scoreIsLocked() || !scoreTimeEditState || scoreTimeEditState.board !== scoreboard) return;
  var draft = scoreTimeDraft();
  if (draft === null || draft > scoreTimeLimit()) {
    $("score-time-error").textContent = t("Idatzi 0:00 eta {time} arteko denbora.", { time: scoreFormat(scoreTimeLimit()) });
    $("score-time-error").hidden = false;
    return;
  }
  scoreboard.seconds = draft;
  scoreboard.running = false; scoreboard.lastTick = 0; clearInterval(scoreTimer);
  if ($("score-time-resume").checked && scoreTimeCanRun(draft)) scoreResumeClock();
  scoreTimeEditState.applied = true;
  scoreSave(); scoreRender(); scoreFinishTimeEdit(); $("score-time-dialog").close();
});
function scoreFinishTimeEdit() {
  var edit = scoreTimeEditState; scoreTimeEditState = null;
  $("score-clock-edit").setAttribute("aria-expanded", "false");
  if (edit && !edit.applied && edit.board === scoreboard && !scoreIsLocked()) {
    if (edit.wasRunning) scoreResumeClock();
    scoreSave(); scoreRender();
  }
}
function scoreCancelTimeEdit() { scoreFinishTimeEdit(); $("score-time-dialog").close(); }
$("score-time-cancel").addEventListener("click", scoreCancelTimeEdit);
$("score-time-dialog").addEventListener("cancel", function (event) { event.preventDefault(); scoreCancelTimeEdit(); });
$("score-time-dialog").addEventListener("close", function () { if (!this.open) scoreFinishTimeEdit(); });
$("score-start").addEventListener("click", function () {
  if (scoreIsLocked()) return;
  scoreUpdate();
  if (scoreboard.running) { scoreboard.running = false; clearInterval(scoreTimer); }
  else {
    var duration = Math.max(1, Number($("score-minutes").value) || 30) * 60;
    if ($("score-mode").value === "match" && scoreboard.seconds >= duration) return notify(t("Zatia amaitu da. Sakatu Hurrengo zatia."), "success");
    if (!scoreboard.seconds && $("score-mode").value === "countdown") scoreboard.seconds = duration;
    scoreboard.running = true; scoreboard.lastTick = Date.now(); clearInterval(scoreTimer); scoreTimer = setInterval(scoreUpdate, 250);
  }
  scoreSave(); scoreRender();
});
$("score-period-next").addEventListener("click", function () {
  if (scoreIsLocked()) return;
  if (!confirm(t("Hurrengo zatia hasi? Zati honetako denbora zerora itzuliko da."))) return;
  scoreboard.running = false; clearInterval(scoreTimer); scoreboard.period += 1;
  scoreboard.seconds = $("score-mode").value === "countdown" ? Math.max(1, Number($("score-minutes").value) || 30) * 60 : 0;
  scoreSave(); scoreRender();
});
$("score-reset").addEventListener("click", function () {
  if (scoreSaving) return;
  if ((scoreboard.events.length || scoreboard.home || scoreboard.away || scoreboard.seconds) && !confirm(t("Partida berri bat hasi? Uneko markagailua eta gertaerak gailutik kenduko dira. Aurretik gordetako partida historian mantenduko da."))) return;
  clearInterval(scoreTimer); scoreClearShot(); scoreShotType = "normal";
  scoreboard = { home: 0, away: 0, seconds: 0, period: 0, running: false, events: [], lastTick: 0, savedMatchId: null };
  scoreSave(); scoreRender(); $("score-save-status").textContent = t("Oraindik ez da gorde.");
  $("score-save-date").value = localDateTime();
});
$("score-mode").addEventListener("change", function () { scoreboard.running = false; clearInterval(scoreTimer); scoreboard.seconds = 0; scoreSave(); scoreRender(); });
$("score-minutes").addEventListener("change", function () {
  this.value = Math.min(180, Math.max(1, Number(this.value) || 30));
  scoreSave(); scoreRender();
});
["score-home-name", "score-away-name"].forEach(function (id) { $(id).addEventListener("change", function () { scoreSave(); scoreRender(); }); });
function scoreMoveModePanel(id, host) {
  var element = $(id), placeholder = document.createComment("Match view: " + id);
  element.before(placeholder);
  scoreModePanels.push({ element: element, placeholder: placeholder });
  host.appendChild(element);
}
async function scoreKeepAwake() {
  if (!scoreMatchMode || document.visibilityState !== "visible" || !navigator.wakeLock || scoreWakeLock || scoreWakePending) return;
  scoreWakePending = true;
  try {
    var lock = await navigator.wakeLock.request("screen");
    if (!scoreMatchMode || document.visibilityState !== "visible") { await lock.release(); return; }
    scoreWakeLock = lock;
    lock.addEventListener("release", function () { if (scoreWakeLock === lock) scoreWakeLock = null; });
  } catch (error) { /* The match view also works without a screen wake lock. */ }
  finally { scoreWakePending = false; }
}
async function scoreEnterMatchMode() {
  if (scoreMatchMode) return;
  scoreMatchMode = true; scoreModeScroll = window.scrollY;
  setMobileMenu(false);
  $("v-scoreboard").classList.add("score-match-mode");
  document.body.classList.add("score-match-active");
  ["score-history", "score-settings", "score-save-panel"].forEach(function (id) { scoreMoveModePanel(id, $("score-tools-content")); });
  scoreMoveModePanel("score-shot-panel", $("score-location-content"));
  $("score-fullscreen").setAttribute("aria-pressed", "true");
  $("score-fullscreen").setAttribute("aria-label", t("Partida modutik irten"));
  $("score-fullscreen").querySelector(".score-fullscreen-label").textContent = t("Irten");
  $("v-scoreboard").scrollTop = 0;
  // iPhone and browsers without Fullscreen API use the same viewport layout.
  try {
    if ($("v-scoreboard").requestFullscreen && document.fullscreenEnabled) {
      // Track the request before its events: entry and exit may share one frame.
      scoreNativeFullscreen = true;
      await $("v-scoreboard").requestFullscreen({ navigationUI: "hide" });
      if (!scoreMatchMode && document.fullscreenElement === $("v-scoreboard")) await document.exitFullscreen();
    }
  } catch (error) { scoreNativeFullscreen = false; /* Keep the viewport match view when native fullscreen is unavailable. */ }
  if (scoreMatchMode) scoreKeepAwake();
}
async function scoreExitMatchMode() {
  if (!scoreMatchMode) return;
  scoreMatchMode = false; scoreNativeFullscreen = false;
  ["score-player-dialog", "score-tools-dialog", "score-location-dialog", "score-time-dialog"].forEach(function (id) { if ($(id).open) $(id).close(); });
  scoreModePanels.forEach(function (panel) { panel.placeholder.replaceWith(panel.element); });
  scoreModePanels = [];
  $("v-scoreboard").classList.remove("score-match-mode");
  document.body.classList.remove("score-match-active");
  $("score-fullscreen").setAttribute("aria-pressed", "false");
  $("score-fullscreen").setAttribute("aria-label", t("Pantaila osoko partida modua ireki"));
  $("score-fullscreen").querySelector(".score-fullscreen-label").textContent = t("Partida modua");
  if (scoreWakeLock) { var lock = scoreWakeLock; scoreWakeLock = null; lock.release().catch(function () {}); }
  window.scrollTo(0, scoreModeScroll);
  $("score-fullscreen").focus({ preventScroll: true });
  if (document.fullscreenElement === $("v-scoreboard")) {
    try { await document.exitFullscreen(); } catch (error) { /* Layout and match state have already been restored. */ }
  }
}
$("score-fullscreen").addEventListener("click", function () {
  if (scoreMatchMode) scoreExitMatchMode(); else scoreEnterMatchMode();
});
$("score-match-tools").addEventListener("click", function () { $("score-tools-dialog").showModal(); });
document.querySelectorAll("[data-close-score-dialog]").forEach(function (button) {
  button.addEventListener("click", function () { $(this.dataset.closeScoreDialog).close(); });
});
$("score-mode-new-shot").addEventListener("click", function () {
  $("score-tools-dialog").close();
  scoreClearShot();
  $("shot-team").value = "home"; $("shot-result").value = "gol"; $("shot-player").value = "";
  renderShotPlayers(); drawShotCanvases();
  $("score-shot-panel").open = true;
  setupQuickLocation();
  $("score-location-dialog").showModal();
});
$("score-location-dialog").addEventListener("close", function () {
  this.classList.remove("quick-location", "is-exact", "is-penalty");
  $("shot-fields-details").open = true;
  scoreClearShot(); $("score-shot-panel").open = false;
});
document.addEventListener("fullscreenchange", function () {
  if (document.fullscreenElement === $("v-scoreboard")) {
    if (scoreMatchMode) scoreNativeFullscreen = true;
    else document.exitFullscreen().catch(function () {});
    return;
  }
  if (scoreNativeFullscreen && scoreMatchMode) scoreExitMatchMode();
  else scoreNativeFullscreen = false;
});
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape" && scoreMatchMode && !document.querySelector("dialog[open]")) {
    event.preventDefault(); scoreExitMatchMode();
  }
});
document.addEventListener("visibilitychange", function () { if (scoreMatchMode && document.visibilityState === "visible") scoreKeepAwake(); });

function setMobileMenu(open) {
  var nav = $("nav"), toggle = $("mobile-menu-toggle"), backdrop = $("mobile-menu-backdrop");
  if (!nav || !toggle || !backdrop) return;
  var mobile = window.matchMedia("(max-width: 767px)").matches;
  var isOpen = Boolean(open && mobile && !nav.classList.contains("hidden"));
  nav.classList.toggle("menu-open", isOpen);
  backdrop.classList.toggle("hidden", !isOpen);
  document.body.classList.toggle("mobile-menu-active", isOpen);
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.setAttribute("aria-label", isOpen ? t("Menua itxi") : t("Menua ireki"));
  nav.setAttribute("aria-hidden", String(mobile && !isOpen));
  nav.inert = mobile && !isOpen;
}
$("mobile-menu-toggle").addEventListener("click", function () {
  setMobileMenu($("mobile-menu-toggle").getAttribute("aria-expanded") !== "true");
});
$("mobile-menu-backdrop").addEventListener("click", function () { setMobileMenu(false); });
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape" && $("mobile-menu-toggle").getAttribute("aria-expanded") === "true") {
    setMobileMenu(false); $("mobile-menu-toggle").focus();
  }
});
var desktopMenuQuery = window.matchMedia("(min-width: 768px)");
function handleMenuViewportChange(event) {
  setMobileMenu(false);
  if (!$("nav").classList.contains("hidden")) {
    $("nav").setAttribute("aria-hidden", String(event.matches ? "false" : "true"));
    $("nav").inert = !event.matches;
  }
}
if (desktopMenuQuery.addEventListener) desktopMenuQuery.addEventListener("change", handleMenuViewportChange);
else if (desktopMenuQuery.addListener) desktopMenuQuery.addListener(handleMenuViewportChange);
document.querySelectorAll("nav [data-v]").forEach(function (button) {
  button.addEventListener("click", function () { selectSection(button.dataset.v); });
});
var sessionsSection = $("v-sessions"), sessionCreate = sessionsSection.querySelector("details.card");
var sessionToolbar = $("sessions-list").previousElementSibling, sessionsList = $("sessions-list");
sessionsSection.insertBefore(sessionToolbar, sessionCreate);
sessionsSection.insertBefore(sessionsList, sessionCreate);
var matchesSection = $("v-matches"), matchCreate = matchesSection.querySelector("details.card");
var matchToolbar = $("matches-list").previousElementSibling, matchesList = $("matches-list");
matchesSection.insertBefore(matchToolbar, matchCreate);
matchesSection.insertBefore(matchesList, matchCreate);
matchesSection.insertBefore($("match-detail"), matchCreate);
document.querySelectorAll("[data-open-section]").forEach(function (button) {
  button.addEventListener("click", function () { selectSection(button.dataset.openSection); });
});
document.querySelectorAll("[data-plan-view]").forEach(function (button) {
  button.addEventListener("click", function () { planView = button.dataset.planView; renderPlanning(); });
});
$("plan-agenda").addEventListener("click", function (event) {
  var item = event.target.closest("[data-agenda-action]");
  if (!item) return;
  var action = item.dataset.agendaAction, id = Number(item.dataset.agendaId);
  if (action === "data-plan-micro" || action === "data-plan-macro") {
    openPlanForm(action === "data-plan-micro" ? "micro" : "macro", id);
    return;
  }
  var destination = document.querySelector("[" + action + '="' + id + '"]');
  if (destination) destination.click();
});
$("plan-agenda").addEventListener("keydown", function (event) {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-agenda-action]")) {
    event.preventDefault();
    event.target.click();
  }
});
$("players-search").addEventListener("input", renderPlayers);
$("players-status").addEventListener("change", renderPlayers);
$("exercise-list-category").addEventListener("change", renderExercises);
$("stats-match").addEventListener("change", renderStats);
["stats-period", "stats-venue", "stats-opponent", "stats-mode", "stats-start", "stats-end"].forEach(function (id) { $(id).addEventListener("change", renderStats); });
$("stats-search").addEventListener("input", renderStats);
$("stats-view-visual").addEventListener("click", function () { $("stats-players-visual").classList.remove("hidden"); $("stats-list").classList.add("hidden"); this.setAttribute("aria-pressed", "true"); $("stats-view-list").setAttribute("aria-pressed", "false"); });
$("stats-view-list").addEventListener("click", function () { $("stats-players-visual").classList.add("hidden"); $("stats-list").classList.remove("hidden"); this.setAttribute("aria-pressed", "true"); $("stats-view-visual").setAttribute("aria-pressed", "false"); });
$("stats-clear").addEventListener("click", function () { ["stats-match", "stats-opponent"].forEach(function (id) { $(id).value = ""; }); ["stats-period", "stats-venue", "stats-mode"].forEach(function (id) { $(id).value = id === "stats-mode" ? "team" : "all"; }); $("stats-start").value = ""; $("stats-end").value = ""; $("stats-search").value = ""; renderStats(); });
$("stats-print").addEventListener("click", function () { window.print(); });
$("open-board").addEventListener("click", function () { selectSection("v-board"); });

$("login-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var button = this.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    var result = await request({
      p_usuario: $("username").value.trim().toLowerCase(),
      p_pasahitza: $("password").value
    }, true);
    if (!result.token || !result.user) throw new Error(t("Supabasek ez du saio baliodunik itzuli"));
    token = result.token; user = result.user;
    saveLocal("7metro-supabase-token", token);
    saveLocal("7metro-username", user.izena);
    $("password").value = "";
    notify(t("Online kontura konektatuta"), "success");
    await loadTeams(true);
  } catch (error) {
    token = "";
    localStorage.removeItem("7metro-supabase-token");
    notify(error.message, "error");
  } finally { button.disabled = false; }
});

$("create-account").addEventListener("click", async function () {
  $("new-username").value = $("username").value.trim();
  $("new-password").value = $("password").value;
  $("account-create-dialog").showModal();
});

$("account-create-close").addEventListener("click", function () {
  $("account-create-dialog").close();
});

$("account-create-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var username = $("new-username").value.trim().toLowerCase();
  var password = $("new-password").value;
  var button = this.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await request({ action: "register", p_usuario: username, p_pasahitza: password }, true);
    var result = await request({ p_usuario: username, p_pasahitza: password }, true);
    if (!result.token || !result.user) throw new Error(t("Kontua sortu da, baina ezin izan da saioa hasi"));
    token = result.token;
    user = result.user;
    saveLocal("7metro-supabase-token", token);
    saveLocal("7metro-username", user.izena);
    $("password").value = "";
    $("new-password").value = "";
    $("account-create-dialog").close();
    notify(t("Kontua sortu da eta saioa hasi duzu"), "success");
    await loadTeams(true);
  } catch (error) {
    notify(error.message, "error");
  } finally { button.disabled = false; }
});

$("open-team").addEventListener("click", async function () {
  var button = this;
  button.disabled = true;
  try { await openTeam($("team-select").value); }
  catch (error) { notify(error.message, "error"); }
  finally { button.disabled = false; }
});

$("team-select").addEventListener("change", updateTeamManagementControls);
$("rename-team").addEventListener("click", function () {
  var selected = selectedTeamForManagement();
  if (!selected || selected._role !== "owner") return notify(t("Taldearen jabeak bakarrik alda dezake izena"), "error");
  $("team-rename-name").value = selected.izena || "";
  $("team-rename-dialog").showModal();
});
$("team-rename-close").addEventListener("click", function () { $("team-rename-dialog").close(); });
$("team-rename-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var selected = selectedTeamForManagement(), name = $("team-rename-name").value.trim();
  if (!selected || selected._role !== "owner") return notify(t("Taldearen jabeak bakarrik alda dezake izena"), "error");
  if (name.length < 2 || name.length > 100) return notify(t("Izenak 2 eta 100 karaktere artean izan behar ditu"), "error");
  var button = this.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    var result = await request({ action: "team_rename", team_id: Number(selected.id_taldea), name: name });
    var updated = result.team || Object.assign({}, selected, { izena: name });
    teams = teams.map(function (item) { return Number(item.id_taldea) === Number(updated.id_taldea) ? Object.assign({}, updated, { _role: "owner" }) : item; });
    var selectedId = String(updated.id_taldea);
    $("team-select").innerHTML = teams.map(function (item) {
      return '<option value="' + Number(item.id_taldea) + '">' + esc(item.izena) + (item._role === "owner" ? t(" · Jabea") : t(" · Kidea")) + "</option>";
    }).join("");
    $("team-select").value = selectedId;
    if (Number(teamId) === Number(updated.id_taldea)) {
      team = updated;
      $("account").textContent = (user ? user.izena + " · " : "") + updated.izena;
    }
    $("team-rename-dialog").close();
    notify(t("Taldearen izena aldatu da"), "success");
  } catch (error) { notify(error.message, "error"); }
  finally { button.disabled = false; }
});
$("delete-team").addEventListener("click", async function () {
  var selected = selectedTeamForManagement();
  if (!selected || selected._role !== "owner") return notify(t("Taldearen jabeak bakarrik ezaba dezake taldea"), "error");
  var confirmation = t("Ziur zaude '") + selected.izena + t("' taldea ezabatu nahi duzula? Ekintza honek taldeko jokalariak, entrenamenduak, partidak eta plangintza ere ezabatuko ditu.");
  if (!window.confirm(confirmation)) return;
  var button = this;
  button.disabled = true;
  try {
    await request({ action: "team_delete", team_id: Number(selected.id_taldea) });
    if (Number(teamId) === Number(selected.id_taldea)) {
      team = null; teamId = 0; localStorage.removeItem("7metro-team-id");
    }
    await loadTeams(false);
    notify(t("Taldea eta haren datuak ezabatu dira"), "success");
  } catch (error) { notify(error.message, "error"); }
  finally { button.disabled = false; }
});

$("team-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var form = this, button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    var result = await request({ action: "team_create", name: new FormData(form).get("name") });
    team = result.team;
    teams.push(team);
    await openTeam(team.id_taldea);
    form.reset();
    notify(t("Taldea sortu da"), "success");
  } catch (error) { notify(error.message, "error"); }
  finally { button.disabled = false; }
});

$("player-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var form = this, button = form.querySelector('button[type="submit"]');
  var data = Object.fromEntries(new FormData(form).entries());
  ["dortsala", "altuera_cm", "pisua_kg"].forEach(function (key) { data[key] = numberOrNull(data[key]); });
  button.disabled = true;
  try {
    await request(Object.assign({ action: "pwa_create_player", team_id: teamId }, data));
    form.reset(); await refreshAll(); notify(t("Jokalaria gehitu da"), "success");
  } catch (error) { notify(error.message, "error"); }
  finally { button.disabled = false; }
});

$("exercise-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var form = this, button = form.querySelector('button[type="submit"]');
  var data = Object.fromEntries(new FormData(form).entries());
  data.kategoriak = new FormData(form).getAll("kategoriak");
  data.kategoria = data.kategoriak[0] || "";
  data.jokalari_kopurua = numberOrNull(data.jokalari_kopurua);
  stopBoardAnimation();
  boardState.fondo = $("board-background").value;
  prepareBoardForSave();
  data.arbela_datuak = JSON.stringify(boardState);
  button.disabled = true;
  try {
    await request(Object.assign({ action: "pwa_create_exercise", team_id: teamId }, data));
    form.reset();
    $("exercise-category").querySelectorAll("input").forEach(function (input) { input.checked = false; });
    resetBoard(); await refreshAll(); notify(t("Ariketa gehitu da"), "success");
  } catch (error) { notify(error.message, "error"); }
  finally { button.disabled = false; }
});

$("exercise-category-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var form = this, button = form.querySelector('button[type="submit"]');
  var name = $("new-exercise-category").value.trim();
  if (!name) return;
  button.disabled = true;
  try {
    await request({ action: "pwa_create_category", team_id: teamId, izena: name });
    form.reset();
    await refreshAll();
    $("exercise-category").querySelectorAll("input").forEach(function (input) {
      if (normalizeCategoryName(input.value) === normalizeCategoryName(name)) input.checked = true;
    });
    notify('"' + name + t("\" kategoria sortu da"), "success");
  } catch (error) { notify(error.message, "error"); }
  finally { button.disabled = false; }
});

document.querySelectorAll("[data-board-tool]").forEach(function (button) {
  button.addEventListener("click", function () {
    boardTool = button.dataset.boardTool;
    document.querySelectorAll("[data-board-tool]").forEach(function (item) {
      item.setAttribute("aria-pressed", String(item === button));
    });
    $("exercise-board").style.cursor = boardTool === "move" ? "grab" : "crosshair";
  });
});
$("board-background").addEventListener("change", function () {
  boardState.fondo = this.value;
  redrawBoard();
});
$("exercise-board").addEventListener("pointerdown", boardPointerDown);
$("exercise-board").addEventListener("pointermove", boardPointerMove);
$("exercise-board").addEventListener("pointerup", boardPointerUp);
$("exercise-board").addEventListener("pointercancel", function () { boardPointer = null; redrawBoard(); });
$("board-delete").addEventListener("click", function () {
  if (!boardSelection) return notify(t("Aukeratu ezabatu nahi duzun elementua"), "error");
  if (boardSelection.kind === "token") delete boardState.posizioak[boardSelection.tag];
  else boardState.marrazkiak.splice(boardSelection.index, 1);
  boardSelection = null;
  redrawBoard();
});
$("board-clear").addEventListener("click", function () {
  if (!Object.keys(boardState.posizioak).length && !boardState.marrazkiak.length && !boardState.animazioa.length) return;
  if (!confirm(t("Arbel guztia garbitu nahi duzu?"))) return;
  resetBoard();
});
$("board-frame-add").addEventListener("click", function () {
  stopBoardAnimation();
  boardState.animazioa.push(captureBoardFrame());
  boardFrameIndex = boardState.animazioa.length - 1;
  document.querySelector('[data-board-tool="move"]').click();
  updateBoardAnimationControls();
  notify((boardFrameIndex + 1) + t(". pausoa gehitu da. Mugitu elementuak hurrengo pausorako."), "success");
});
$("board-frames").addEventListener("change", function () {
  stopBoardAnimation();
  boardFrameIndex = Number(this.value);
  if (boardFrameIndex >= 0) {
    var state = animationFrameState(boardState.animazioa[boardFrameIndex], boardState.fondo);
    boardState.posizioak = JSON.parse(JSON.stringify(state.posizioak));
    boardState.marrazkiak = JSON.parse(JSON.stringify(state.marrazkiak));
    boardSelection = null;
  }
  updateBoardAnimationControls();
  redrawBoard();
});
$("board-frame-update").addEventListener("click", function () {
  stopBoardAnimation();
  if (boardFrameIndex < 0) return;
  boardState.animazioa[boardFrameIndex] = captureBoardFrame();
  updateBoardAnimationControls();
  notify(t("Pausoa eguneratu da"), "success");
});
$("board-frame-delete").addEventListener("click", function () {
  stopBoardAnimation();
  if (boardFrameIndex < 0) return;
  boardState.animazioa.splice(boardFrameIndex, 1);
  boardFrameIndex = -1;
  updateBoardAnimationControls();
});
$("board-animation-play").addEventListener("click", playBoardAnimation);
updateBoardAnimationControls();
loadBoardBackgrounds();
redrawBoard();


document.querySelectorAll("[data-plan-new]").forEach(function (button) {
  button.addEventListener("click", function () { openPlanForm(button.dataset.planNew, null); });
});

$("plan-prev").addEventListener("click", function () { stepPlanMonth(-1); });
$("plan-next").addEventListener("click", function () { stepPlanMonth(1); });
$("plan-today").addEventListener("click", function () {
  planMonth = new Date();
  planMonth.setDate(1);
  renderPlanning();
});

$("plan-grid").addEventListener("click", function (event) {
  var micro = event.target.closest("[data-plan-micro]");
  if (micro) { openPlanForm("micro", micro.dataset.planMicro); return; }
  var macro = event.target.closest("[data-plan-macro]");
  if (macro) openPlanForm("macro", macro.dataset.planMacro);
});

$("plan-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var button = $("plan-form").querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    await submitPlanForm();
    var message = planFormContext && planFormContext.kind === "macro"
      ? t("Makrozikloa gorde da") : t("Mikrozikloa gorde da");
    closePlanForm();
    await refreshAll();
    notify(message, "success");
  } catch (error) { notify(error.message, "error"); }
  finally { if (button) button.disabled = false; }
});

$("plan-modal").addEventListener("click", async function (event) {
  if (event.target === $("plan-modal") || event.target.closest("[data-plan-cancel]")) {
    closePlanForm();
    return;
  }
  var remove = event.target.closest("[data-plan-delete]");
  if (remove) {
    var isMacro = planFormContext && planFormContext.kind === "macro";
    if (!confirm(isMacro ? t("Makrozikloa ezabatu nahi duzu?") : t("Mikrozikloa ezabatu nahi duzu?"))) return;
    remove.disabled = true;
    try {
      await deletePlanRecord();
      closePlanForm();
      await refreshAll();
      notify(t("Erregistroa ezabatu da"), "success");
    } catch (error) { notify(error.message, "error"); }
    finally { remove.disabled = false; }
  }
});
$("calendar-cup-modal").addEventListener("click", function (event) {
  if (event.target === this) this.classList.add("hidden");
});

$("session-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var form = this, button = form.querySelector('button[type="submit"]');
  var exerciseList = sessionSelection.map(function (entry) {
    if (entry.is_separator) return { is_separator: true, taldea: entry.taldea };
    return { id_ariketa: Number(entry.id_ariketa), iraupena_minutuak: Number(entry.iraupena_minutuak), taldea: entry.taldea || null, aldaerak: entry.aldaerak || null };
  });
  button.disabled = true;
  try {
    await request({
      action: "pwa_create_session", team_id: teamId,
      data_ordua: $("session-date").value, lekua: $("session-place").value,
      helburu_taktikoa: $("session-goal").value,
      id_mikroziklo: numberOrNull($("session-micro").value),
      exercises: exerciseList
    });
    sessionSelection = [];
    activeSessionGroup = null;
    form.reset(); $("session-date").value = localDateTime();
    await refreshAll(); notify(t("Entrenamendua gorde da"), "success");
  } catch (error) { notify(error.message, "error"); }
  finally { button.disabled = false; }
});

$("session-library").addEventListener("click", function (event) {
  var add = event.target.closest("[data-session-add]");
  if (add) { addSessionExercise(add.dataset.sessionAdd); return; }
  var view = event.target.closest("[data-session-view]");
  if (view) openSessionExercisePreview(view.dataset.sessionView);
});

$("session-preview-play").addEventListener("click", function () {
  var canvas = $("session-preview-canvas"), id = Number(this.dataset.exerciseId);
  if (previewAnimation && previewAnimation.button === this) stopExerciseAnimation();
  else playExerciseAnimation(id, canvas, this);
});
$("session-preview-close").addEventListener("click", function () {
  $("session-preview-dialog").close();
});
$("session-preview-dialog").addEventListener("click", function (event) {
  if (event.target === this) this.close();
});
$("session-preview-dialog").addEventListener("close", function () {
  if (previewAnimation && previewAnimation.canvas === $("session-preview-canvas")) stopExerciseAnimation();
});

$("session-selected").addEventListener("click", function (event) {
  var removeGroup = event.target.closest("[data-session-remove-group]");
  if (removeGroup) { removeSessionGroup(removeGroup.dataset.sessionRemoveGroup); return; }
  var remove = event.target.closest("[data-session-remove]");
  if (remove) removeSessionExercise(remove.dataset.sessionRemove);
});

$("session-selected").addEventListener("input", function (event) {
  var notes = event.target.closest("[data-session-notes]");
  if (!notes) return;
  var entry = sessionSelection.find(function (item) {
    return !item.is_separator && Number(item.id_ariketa) === Number(notes.dataset.sessionNotes);
  });
  if (entry) entry.aldaerak = notes.value;
});

$("session-selected").addEventListener("pointerdown", function (event) {
  var handle = event.target.closest("[data-session-drag-handle]");
  if (!handle || (event.button !== undefined && event.button !== 0)) return;
  var row = handle.closest("[data-session-drop-exercise]");
  if (!row) return;
  sessionDragState = { id: Number(row.dataset.sessionDropExercise), pointerId: event.pointerId,
    startX: event.clientX, startY: event.clientY, active: false, target: null };
  try { handle.setPointerCapture(event.pointerId); } catch (error) { /* pointer capture is optional */ }
});

$("session-selected").addEventListener("pointermove", function (event) {
  if (!sessionDragState || event.pointerId !== sessionDragState.pointerId) return;
  if (!sessionDragState.active && Math.hypot(event.clientX - sessionDragState.startX, event.clientY - sessionDragState.startY) < 7) return;
  sessionDragState.active = true;
  var source = this.querySelector('[data-session-drop-exercise="' + sessionDragState.id + '"]');
  if (source) source.classList.add("is-dragging");
  this.querySelectorAll(".session-drop-before,.session-drop-after").forEach(function (item) {
    item.classList.remove("session-drop-before", "session-drop-after");
  });
  var hovered = document.elementFromPoint(event.clientX, event.clientY);
  var target = hovered && hovered.closest("[data-session-drop-exercise], [data-session-drop-group]");
  if (!target || !this.contains(target)) { sessionDragState.target = null; return; }
  if (target.dataset.sessionDropExercise && Number(target.dataset.sessionDropExercise) === sessionDragState.id) {
    sessionDragState.target = null; return;
  }
  if (target.dataset.sessionDropGroup) {
    target.classList.add("session-drop-after");
    sessionDragState.target = { type: "group", id: target.dataset.sessionDropGroup };
    return;
  }
  var rect = target.getBoundingClientRect();
  var after = event.clientY > rect.top + rect.height / 2;
  target.classList.add(after ? "session-drop-after" : "session-drop-before");
  sessionDragState.target = { type: "exercise", id: Number(target.dataset.sessionDropExercise), after: after };
});

function finishSessionDrag(event) {
  if (!sessionDragState || event.pointerId !== sessionDragState.pointerId) return;
  var drag = sessionDragState;
  sessionDragState = null;
  if (drag.active && drag.target) dropSessionExercise(drag.id, drag.target);
  else {
    $("session-selected").querySelectorAll(".session-drop-before,.session-drop-after,.is-dragging").forEach(function (item) {
      item.classList.remove("session-drop-before", "session-drop-after", "is-dragging");
    });
  }
}

$("session-selected").addEventListener("pointerup", finishSessionDrag);
$("session-selected").addEventListener("pointercancel", function (event) {
  if (!sessionDragState || event.pointerId !== sessionDragState.pointerId) return;
  sessionDragState = null;
  this.querySelectorAll(".session-drop-before,.session-drop-after,.is-dragging").forEach(function (item) {
    item.classList.remove("session-drop-before", "session-drop-after", "is-dragging");
  });
});

$("session-group-preset").addEventListener("change", function () {
  $("session-group-custom").classList.toggle("hidden", this.value !== "__custom");
  if (this.value === "__custom") $("session-group-custom").focus();
});

$("session-add-group").addEventListener("click", function () {
  var preset = $("session-group-preset").value;
  var name = preset === "__custom" ? $("session-group-custom").value : preset;
  addSessionGroup(name);
  if (preset === "__custom" && String(name || "").trim()) $("session-group-custom").value = "";
});

$("session-clear-group").addEventListener("click", function () {
  activeSessionGroup = null;
  renderSessionPicker();
});

$("session-selected").addEventListener("change", function (event) {
  if (event.target.matches("[data-session-minutes]")) {
    setSessionMinutes(event.target.dataset.sessionMinutes, event.target.value);
    event.target.value = sessionSelection.find(function (entry) {
      return Number(entry.id_ariketa) === Number(event.target.dataset.sessionMinutes);
    }).iraupena_minutuak;
  }
});

$("session-selected").addEventListener("keydown", function (event) {
  if (event.key === "Enter" && event.target.matches("[data-session-minutes]")) {
    event.preventDefault();
    event.target.blur();
  }
});

$("session-category").addEventListener("change", function () {
  sessionCategoryFilter = this.value;
  renderSessionPicker();
});

$("session-total-minutes").addEventListener("input", updateSessionTimeBar);

$("session-prev").addEventListener("click", function () {
  if (sessionView.index > 0) { sessionView.index--; renderSessionBoard(); }
});

$("session-next").addEventListener("click", function () {
  if (sessionView.index < sessionView.ids.length - 1) { sessionView.index++; renderSessionBoard(); }
});

$("session-play").addEventListener("click", function () {
  if (sessionView.raf) stopSessionAnimation(); else playSessionAnimation();
});

$("session-back").addEventListener("click", function () {
  stopSessionAnimation();
  selectSection(sessionViewReturn);
});

$("match-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var form = this, button = form.querySelector('button[type="submit"]');
  var score = [$("match-score-home").value, $("match-score-away").value].map(function (value) {
    return value.trim() === "" ? 0 : Number(value);
  });
  if (score.some(function (value) { return !Number.isInteger(value) || value < 0 || value > 999; })) {
    return notify(t("Golak 0 eta 999 arteko zenbaki osoak izan behar dira"), "error");
  }
  var stats = players.map(function (player) {
    var row = { id_jokalaria: Number(player.id_jokalaria) };
    form.querySelectorAll('[data-player="' + player.id_jokalaria + '"]').forEach(function (input) {
      row[input.dataset.stat] = Number(input.value);
    });
    row.jaurtiketak = Math.max(row.jaurtiketak || 0, row.golak || 0);
    var shotsInput = form.querySelector('[data-stat="jaurtiketak"][data-player="' + player.id_jokalaria + '"]');
    if (shotsInput) shotsInput.value = String(row.jaurtiketak);
    return row;
  });
  button.disabled = true;
  try {
    await request({
      action: "pwa_create_match", team_id: teamId,
      data_ordua: $("match-date").value, aurkaria: $("match-opponent").value.trim(),
      lekua: $("match-place").value, emaitza_geurea: score[0],
      emaitza_aurkaria: score[1], stats: stats
    });
    form.reset(); $("match-date").value = localDateTime();
    await refreshAll(); notify(t("Partida gorde da"), "success");
  } catch (error) { notify(error.message, "error"); }
  finally { button.disabled = false; }
});

$("match-detail").addEventListener("submit", async function (event) {
  var form = event.target;
  if (!form.matches("#match-edit-form")) return;
  event.preventDefault();
  var button = form.querySelector('button[type="submit"]');
  var score = ["home", "away"].map(function (side) {
    return Number(form.querySelector('[data-match-score="' + side + '"]').value);
  });
  if (score.some(function (value) { return !Number.isInteger(value) || value < 0 || value > 999; })) {
    return notify(t("Emaitza 0 eta 999 arteko zenbaki osoz osatu behar da"), "error");
  }
  var stats = players.map(function (player) {
    var row = { id_jokalaria: Number(player.id_jokalaria) };
    var played = form.querySelector('[data-edit-played="' + player.id_jokalaria + '"]');
    row.jokatu = Boolean(played && played.checked);
    form.querySelectorAll('[data-edit-player="' + player.id_jokalaria + '"]').forEach(function (input) {
      row[input.dataset.editStat] = input.disabled ? 0 : Number(input.value);
    });
    if (row.jokatu) {
      row.jaurtiketak = Math.max(row.jaurtiketak || 0, row.golak || 0);
      var shotsInput = form.querySelector('[data-edit-stat="jaurtiketak"][data-edit-player="' + player.id_jokalaria + '"]');
      if (shotsInput) shotsInput.value = String(row.jaurtiketak);
    }
    return row;
  });
  button.disabled = true;
  try {
    await request({
      action: "pwa_update_match", team_id: teamId,
      id: Number(form.dataset.matchEditId),
      emaitza_geurea: score[0], emaitza_aurkaria: score[1], stats: stats
    });
    await refreshAll();
    $("match-detail").classList.add("hidden");
    notify(t("Partidaren emaitza eta estatistikak eguneratu dira"), "success");
  } catch (error) { notify(error.message, "error"); }
  finally { button.disabled = false; }
});

$("match-detail").addEventListener("change", function (event) {
  var checkbox = event.target;
  if (!checkbox.matches("[data-edit-played]")) return;
  var playerId = checkbox.dataset.editPlayed;
  this.querySelectorAll('[data-edit-player="' + playerId + '"]').forEach(function (input) {
    input.disabled = !checkbox.checked;
  });
});

$("score-save-match").addEventListener("click", async function () {
  var button = this;
  if (scoreIsLocked()) return notify(t("Markagailu hau gordeta dago. Berrabiarazi beste partida bat gordetzeko."), "error");
  if (!token || !teamId) return notify(t("Hasi saioa eta aukeratu taldea partida gordetzeko"), "error");
  var opponent = $("score-away-name").value.trim();
  var date = $("score-save-date").value;
  if (!date || !opponent) {
    $("score-save-status").textContent = t("Errorea: bete data eta aurkariaren izena.");
    return notify(t("Data eta aurkariaren izena bete behar dira"), "error");
  }
  var homeName = $("score-home-name").value.trim() || "7metro";
  var statsByPlayer = {};
  scoreboard.events.forEach(function (entry) {
    var side = entry.side || (entry.team === homeName ? "home" : "away");
    var playerId = Number(entry.playerId) || 0;
    if (side !== "home" || !playerId) return;
    var row = statsByPlayer[playerId] || (statsByPlayer[playerId] = { id_jokalaria: playerId, golak: 0, jaurtiketak: 0 });
    if (scoreIsSanction(entry.type)) {
      var field = entry.type === "2min" ? "two_min" : entry.type;
      row[field] = (row[field] || 0) + 1;
    }
    if (entry.type === "gol" || entry.type === "penalti_gol") row.golak++;
    if (["gol", "jaurtiketa", "penalti_gol", "penalti_jaurtiketa"].indexOf(entry.type) !== -1) row.jaurtiketak++;
  });
  var periodMinutes = Math.max(1, Number($("score-minutes").value) || 30);
  var periodSeconds = periodMinutes * 60;
  var savedShots = scoreboard.events.filter(function (entry) { return entry.shot_from && entry.shot_to; }).map(function (entry) {
    var elapsed = $("score-mode").value === "countdown" ? periodSeconds - Number(entry.seconds || 0) : Number(entry.seconds || 0);
    return {
      id_jokalaria: entry.side === "away" ? null : Number(entry.playerId) || null,
      minutua: Math.max(0, (Math.max(1, Number(entry.period) || 1) - 1) * periodMinutes + Math.floor(Math.max(0, elapsed) / 60)),
      mota: entry.type, taldea: entry.side === "away" ? "aurkaria" : "geurea",
      jatorri_x: entry.shot_from[0], jatorri_y: entry.shot_from[1],
      helburu_x: entry.shot_to[0], helburu_y: entry.shot_to[1]
    };
  });
  var eventRecords = scoreboard.events.filter(function (entry) { return scoreIsShot(entry.type) || scoreIsSanction(entry.type); }).map(function (entry) {
    var elapsed = $("score-mode").value === "countdown" ? periodSeconds - Number(entry.seconds || 0) : Number(entry.seconds || 0);
    return { type: entry.type, taldea: entry.side === "away" ? "aurkaria" : "geurea",
      player_id: entry.side === "away" ? null : Number(entry.playerId) || null, player_label: entry.player || "",
      minute: Math.max(0, (Math.max(1, Number(entry.period) || 1) - 1) * periodMinutes + Math.floor(Math.max(0, elapsed) / 60)),
      aurkaria: entry.side === "away" ? entry.aurkaria || null : null,
      shot_from: entry.shot_from || null, shot_to: entry.shot_to || null };
  });
  scoreSaving = true; scoreRender();
  var result;
  try {
    result = await request({
      action: "pwa_create_match", team_id: teamId, data_ordua: date, aurkaria: opponent,
      lekua: $("score-save-venue").value, emaitza_geurea: scoreboard.home,
      emaitza_aurkaria: scoreboard.away, stats: Object.keys(statsByPlayer).map(function (id) { return statsByPlayer[id]; }),
      shots: savedShots, event_records: eventRecords
    });
  } catch (error) {
    $("score-save-status").textContent = t("Errorea: ") + error.message;
    notify(error.message, "error");
    scoreSaving = false; scoreRender();
    return;
  }
  scoreboard.savedMatchId = Number(result.id) || true;
  scoreboard.savedMatchStats = Object.keys(statsByPlayer).map(function (id) { return statsByPlayer[id]; });
  scoreboard.savedMatchShots = savedShots;
  scoreboard.savedMatchSnapshot = {
    id_partida: Number(result.id), data_ordua: date, aurkaria: opponent, lekua: $("score-save-venue").value,
    emaitza_geurea: scoreboard.home, emaitza_aurkaria: scoreboard.away,
    estatistika_aurreratuak: JSON.stringify({ event_records: eventRecords })
  };
  scoreboard.running = false; clearInterval(scoreTimer); scoreSaving = false;
  scoreSave(); scoreRender();
  $("score-save-status").textContent = t("Gordeta · ") + opponent + " · " + scoreboard.home + "–" + scoreboard.away;
  button.textContent = t("Partida gordeta");
  notify(t("Partida markagailutik gorde da"), "success");
  try { await refreshAll(); }
  catch (error) { notify(t("Partida gordeta dago, baina historiala ezin izan da birkargatu: ") + error.message, "error"); }
});

async function openMatchStats(matchId, view) {
  var selected = matches.find(function (match) { return Number(match.id_partida) === Number(matchId); });
  if (!selected && scoreboard.savedMatchSnapshot && Number(scoreboard.savedMatchSnapshot.id_partida) === Number(matchId)) {
    selected = scoreboard.savedMatchSnapshot;
    matches.push(selected);
    // The create request succeeded even if the subsequent snapshot refresh failed.
    var id = Number(selected.id_partida);
    tables.partida_jokalariak = records("partida_jokalariak").filter(function (row) { return Number(row.id_partida) !== id; }).concat((scoreboard.savedMatchStats || []).map(function (row) { return Object.assign({}, row, { id_partida: id }); }));
    tables.partidu_jaurtiketak = records("partidu_jaurtiketak").filter(function (row) { return Number(row.id_partida) !== id; }).concat((scoreboard.savedMatchShots || []).map(function (row) { return Object.assign({}, row, { id_partida: id }); }));
    var sanctions = [];
    (scoreboard.savedMatchStats || []).forEach(function (row) {
      ["horia", "two_min", "gorria", "urdina"].forEach(function (field) {
        for (var index = 0; index < Number(row[field] || 0); index++) sanctions.push({ id_partida: id, id_jokalaria: row.id_jokalaria, mota: field === "two_min" ? "2min" : field });
      });
    });
    tables.partidu_zigorrak = records("partidu_zigorrak").filter(function (row) { return Number(row.id_partida) !== id; }).concat(sanctions);
    renderMatches();
  }
  if (!selected) { notify(t("Ezin izan da partida aurkitu. Birkargatu zerrenda."), "error"); return; }
  if (scoreMatchMode) await scoreExitMatchMode();
  $("stats-match").value = String(matchId);
  $("stats-mode").value = view === "opponents" ? "opponents" : "players";
  $("stats-period").value = "all"; $("stats-venue").value = "all";
  $("stats-opponent").value = ""; $("stats-start").value = ""; $("stats-end").value = ""; $("stats-search").value = "";
  selectSection("v-stats");
}
$("score-opponent-stats").addEventListener("click", async function () {
  this.disabled = true;
  try { await openMatchStats(scoreboard.savedMatchId, "opponents"); }
  finally { this.disabled = false; }
});

$("attendance-session").addEventListener("change", function () {
  $("attendance-open").disabled = !this.value;
  if (this.value) openAttendanceDialog(this.value);
});

$("attendance-open").addEventListener("click", function () {
  openAttendanceDialog($("attendance-session").value);
});
$("attendance-close").addEventListener("click", function () { $("attendance-dialog").close(); });
$("attendance-dialog").addEventListener("click", function (event) {
  if (event.target === this) this.close();
});

$("save-attendance").addEventListener("click", async function () {
  var sessionId = Number($("attendance-session").value);
  if (!sessionId) return notify(t("Aukeratu entrenamendua lehenik"), "error");
  var button = this, checks = Array.from(document.querySelectorAll("[data-att-player]"));
  button.disabled = true;
  try {
    for (var check of checks) {
      var id = check.dataset.attPlayer;
      await request({
        action: "pwa_save_attendance", team_id: teamId, id_saio: sessionId,
        id_jokalaria: Number(id), bertaratu: check.checked ? 1 : 0,
        atzerapena_min: Number(document.querySelector('[data-late="' + id + '"]').value) || 0,
        atzerapena_mota: document.querySelector('[data-late-type="' + id + '"]').value
      });
    }
    await refreshAll(); renderAttendance(sessionId); $("attendance-dialog").close(); notify(t("Asistentzia gorde da"), "success");
  } catch (error) { notify(error.message, "error"); }
  finally { button.disabled = false; }
});

document.addEventListener("click", async function (event) {
  var target = event.target.closest("button");
  if (!target) return;
  if (target.hasAttribute("data-team-invitation")) {
    target.disabled = true;
    try {
      await request({ action: "team_invitation_answer", invitation_id: Number(target.dataset.id), accept: target.dataset.teamInvitation === "accept" });
      if (target.dataset.teamInvitation === "accept") {
        notify(t("Taldean sartu zara"), "success");
        await loadTeams(false);
      } else {
        notify(t("Gonbidapena baztertu da"), "success");
        await loadTeamInvitations();
      }
    } catch (error) { target.disabled = false; notify(error.message, "error"); }
    return;
  }
  if (target.hasAttribute("data-play-exercise")) {
    var exerciseId = Number(target.dataset.playExercise);
    if (previewAnimation && previewAnimation.button === target) stopExerciseAnimation();
    else playExerciseAnimation(exerciseId);
    return;
  }
  if (target.hasAttribute("data-play-training-animation")) {
    if (previewAnimation && previewAnimation.button === target) {
      stopExerciseAnimation();
    } else {
      var exerciseCard = target.closest(".training-exercise-card");
      var exerciseCanvas = exerciseCard && exerciseCard.querySelector(".training-exercise-preview");
      playExerciseAnimation(Number(target.dataset.playTrainingAnimation), exerciseCanvas, target);
    }
    return;
  }
  if (target.hasAttribute("data-refresh")) {
    target.disabled = true;
    try { await refreshAll(); notify(t("Datuak eguneratu dira"), "success"); }
    catch (error) { notify(error.message, "error"); }
    finally { target.disabled = false; }
  }
  var deletion = null, message = "", successMessage = t("Erregistroa ezabatu da");
  if (target.hasAttribute("data-delete-player")) {
    deletion = { action: "pwa_delete_player", id: Number(target.dataset.deletePlayer) };
    message = t("Jokalari hau ezabatu nahi duzu?");
  } else if (target.hasAttribute("data-delete-exercise")) {
    deletion = { action: "pwa_delete_exercise", id: Number(target.dataset.deleteExercise) };
    message = t("Ariketa hau ezabatu nahi duzu?");
  } else if (target.hasAttribute("data-delete-exercise-category")) {
    deletion = { action: "pwa_delete_category", izena: target.dataset.deleteExerciseCategory };
    message = '"' + target.dataset.deleteExerciseCategory + t("\" izeneko kategoria-erregistro guztiak ezabatu? Kategoria hori ariketetatik kenduko da; beste kategoriak mantenduko dira.");
    successMessage = t("Kategoria ezabatu da");
  } else if (target.hasAttribute("data-delete-match")) {
    deletion = { action: "pwa_delete_match", id: Number(target.dataset.deleteMatch) };
    message = t("Partida hau eta haren estatistikak ezabatu nahi dituzu?");
  }
  if (deletion && confirm(message)) {
    try {
      await request(Object.assign(deletion, { team_id: teamId }));
      $("match-detail").classList.add("hidden");
      await refreshAll(); notify(successMessage, "success");
    } catch (error) { notify(error.message, "error"); }
  }
  if (target.hasAttribute("data-edit-match")) {
    selectSection("v-matches");
    renderMatchEditor(Number(target.dataset.editMatch));
    return;
  }
  if (target.hasAttribute("data-match-stats")) {
    await openMatchStats(Number(target.dataset.matchStats), target.dataset.matchStatsView);
    return;
  }
  if (target.hasAttribute("data-close-match-stats")) {
    $("match-detail").classList.add("hidden");
  }
  if (target.hasAttribute("data-view-cup")) {
    var cupId = Number(target.dataset.viewCup);
    var cup = records("txapelketak").find(function (item) { return Number(item.id_txapelketa) === cupId; });
    if (!cup) { notify(t("Ezin izan da txapelketa aurkitu. Birkargatu egutegia."), "error"); return; }
    $("calendar-cup-title").textContent = cup.izena || t("Txapelketa");
    $("calendar-cup-meta").textContent = [formatDate(cup), cup.kategoria, cup.lekua].filter(Boolean).join(" · ");
    $("calendar-cup-modal").classList.remove("hidden");
  }
  if (target.hasAttribute("data-close-calendar-cup")) $("calendar-cup-modal").classList.add("hidden");
  if (target.hasAttribute("data-view-session")) {
    if (renderSavedSession(target.dataset.viewSession)) selectSection("v-session-detail");
    else notify(t("Ezin izan da entrenamendua aurkitu. Birkargatu zerrenda."), "error");
  }
  if (target.hasAttribute("data-back-sessions")) selectSection("v-sessions");
  if (target.hasAttribute("data-training-board")) {
    var trainingSessionId = Number(target.dataset.trainingSession);
    var trainingExerciseIds = records("saio_xehetasuna").filter(function (item) {
      return Number(item.id_saio) === trainingSessionId;
    }).sort(function (a, b) { return Number(a.ordena || 0) - Number(b.ordena || 0); })
      .map(function (item) { return Number(item.id_ariketa); });
    openSessionBoard(target.dataset.trainingBoard, trainingExerciseIds, "v-session-detail");
  }
  if (target.hasAttribute("data-attendance-session")) {
    selectSection("v-sessions");
    $("attendance-session").value = target.dataset.attendanceSession;
    $("attendance-open").disabled = false;
    openAttendanceDialog(target.dataset.attendanceSession);
  }
});

$("change-team").addEventListener("click", function () {
  loadTeams(false).catch(function (error) { notify(error.message, "error"); });
});

$("team-invite-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var friend = friendsCache.friends.find(function (item) {
    return String(item.user_id) === $("team-invite-friend").value;
  });
  if (!friend) return notify(t("Aukeratu gonbidatzeko lagun bat"), "error");
  try {
    await request({ action: "team_invite", team_id: teamId, username: String(friend.username || "").trim().toLowerCase() });
    $("team-invite-friend").value = "";
    notify(t("Taldeko gonbidapena bidali da"), "success");
  } catch (error) { notify(error.message, "error"); }
});

$("logout").addEventListener("click", async function () {
  var logoutError = null;
  try { await request({ action: "pwa_logout" }); }
  catch (error) { logoutError = error; }
  token = ""; user = null; team = null; teamId = 0;
  localStorage.removeItem("7metro-supabase-token");
  localStorage.removeItem("7metro-username");
  localStorage.removeItem("7metro-team-id");
  showLogin();
  if (logoutError) notify(logoutError.message, "error");
  else notify(t("Online saioa itxi da"), "success");
});

document.querySelectorAll("[data-theme-choice]").forEach(function (button) {
  button.addEventListener("click", function () {
    setColorTheme(button.dataset.themeChoice, true);
  });
});

document.querySelectorAll('input[type="datetime-local"]').forEach(function (input) {
  input.value = localDateTime();
});

window.addEventListener("beforeinstallprompt", function (event) {
  event.preventDefault(); installPrompt = event; $("install").hidden = false;
});
$("install").addEventListener("click", async function () {
  if (!installPrompt) return;
  await installPrompt.prompt(); installPrompt = null; $("install").hidden = true;
});
var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
$("install-status").textContent = standalone ? t("Instalatuta erabiltzen ari zara") : t("Arakatzailetik erabiltzen ari zara");
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function (error) {
      console.error(t("Service worker-a ezin izan da erregistratu"), error);
    });
  });
}

(async function () {
  if (!token) return;
  try {
    await loadTeams(true);
  } catch (error) {
    showLogin(); notify(error.message, "error");
  }
})();

// Help buttons also work inside collapsed section summaries without toggling them.
document.addEventListener("click", function (event) {
  var button = event.target.closest(".info-toggle");
  if (!button) return;
  event.preventDefault();
  var description = $(button.getAttribute("aria-controls"));
  if (!description) return;
  description.hidden = !description.hidden;
  var details = button.closest("details");
  if (details && !description.hidden) details.open = true;
  button.setAttribute("aria-expanded", String(!description.hidden));
});

$("team-management").addEventListener("toggle", function () {
  if (!this.open) return;
  loadTeamInvitations();
  loadFriends();
});
$("team-invitations-refresh").addEventListener("click", loadTeamInvitations);

$("session-create").addEventListener("click", function () {
  var panel = $("session-create-panel");
  panel.open = true;
  this.setAttribute("aria-expanded", "true");
  $("session-form").focus({ preventScroll: true });
  panel.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
});
$("session-create-panel").addEventListener("toggle", function () {
  $("session-create").setAttribute("aria-expanded", String(this.open));
});

$("match-create").addEventListener("click", function () {
  var panel = $("match-create-panel");
  panel.open = true;
  this.setAttribute("aria-expanded", "true");
  $("match-form").focus({ preventScroll: true });
  panel.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
});
$("match-create-panel").addEventListener("toggle", function () {
  $("match-create").setAttribute("aria-expanded", String(this.open));
});

$("board-curve").addEventListener("input", function () {
  var amount = Number(this.value);
  stopBoardAnimation();
  boardCurve = amount;
  var shape = boardSelection && boardSelection.kind === "drawing" && boardState.marrazkiak[boardSelection.index];
  if (shape && shape.type === "line") curveBoardLine(shape, boardCurve);
  redrawBoard();
});
$("board-curve-reset").addEventListener("click", function () {
  $("board-curve").value = "0";
  $("board-curve").dispatchEvent(new Event("input"));
});
