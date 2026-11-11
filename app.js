"use strict";

var DEFAULT_API_URL = "https://txkjflrtoziscqcytpbc.supabase.co";
var DEFAULT_API_KEY = "sb_publishable_R2yjFvK-Z7ezWbXVi2KqmA_dzox4-pd";
var $ = function (id) { return document.getElementById(id); };
var readStore = function (key) {
  try { return localStorage.getItem(key) || ""; }
  catch (error) { console.error("Ezin izan da tokiko biltegia irakurri", error); return ""; }
};
// Supabase connection details are deployment configuration, not account
// settings. Keep them internal so users cannot alter the app endpoint.
var apiBase = DEFAULT_API_URL;
var apiKey = DEFAULT_API_KEY;
try {
  localStorage.removeItem("7metro-supabase-url");
  localStorage.removeItem("7metro-supabase-key");
} catch (error) { console.error("Ezin izan da konexio-ezarpen zaharrak garbitu", error); }
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
  box.textContent = message;
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
    console.error("Ezin izan da tokiko datua gorde", error);
    throw new Error("Ezin izan dira saio-datuak gorde nabigatzailean");
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
    catch (error) { console.error("Ezin izan da itxura gordeta utzi", error); }
  }
}

setColorTheme(readStore("7metro-theme") || "dark", false);

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function endpoint() {
  var parsed;
  try { parsed = new URL(apiBase); }
  catch (error) { throw new Error("Supabase proiektuaren URL-a ez da baliozkoa"); }
  if (parsed.protocol !== "https:") throw new Error("Supabase proiektuaren URL-ak HTTPS erabili behar du");
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
    throw new Error("Ezin da Supabasera konektatu. Egiaztatu Interneteko konexioa eta proiektuaren URL-a.");
  }
  var result;
  try { result = await response.json(); }
  catch (error) {
    if (response.ok) throw new Error("Supabasek JSON erantzun baliogabea bidali du");
    result = {};
  }
  if (response.status === 401 && token && !anonymous) {
    token = "";
    user = null;
    localStorage.removeItem("7metro-supabase-token");
    localStorage.removeItem("7metro-username");
    showLogin();
    throw new Error("Online saioa iraungi da; hasi saioa berriro");
  }
  if (!response.ok) {
    if (payload.action === "pwa_create_match" && /usuario o contrase(?:ñ|Ã±)a no v[aá]lidos/i.test(String(result.error || ""))) {
      throw new Error("Supabaseko metro-api zaharkituta dago eta ez du markagailutik gordetzea onartzen. Backendaren eguneraketa argitaratu behar da.");
    }
    throw new Error(result.error || ("Supabase errorea (" + response.status + ")"));
  }
  return result;
}

function showLogin() {
  token = "";
  setMobileMenu(false);
  $("mobile-menu-toggle").hidden = true;
  $("workspace").classList.add("hidden");
  $("nav").classList.add("hidden");
  $("account").textContent = "";
  $("v-login").classList.add("on");
}

function showTeamPicker() {
  setMobileMenu(false);
  $("mobile-menu-toggle").hidden = true;
  $("workspace").classList.remove("hidden");
  $("team-picker").classList.remove("hidden");
  $("team-app").classList.add("hidden");
  $("nav").classList.add("hidden");
  $("v-login").classList.remove("on");
  $("account").textContent = user ? user.izena : "";
  $("team-select").innerHTML = teams.map(function (item) {
    return '<option value="' + Number(item.id_taldea) + '">' + esc(item.izena) + (item._role === "owner" ? " · Jabea" : " · Kidea") + "</option>";
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

async function loadTeamInvitations() {
  var lists = document.querySelectorAll("[data-team-invitations]");
  var list = { set innerHTML(value) { lists.forEach(function (element) { element.innerHTML = value; }); } };
  list.innerHTML = '<li class="empty">Gonbidapenak kargatzen…</li>';
  try {
    var result = await request({ action: "team_invitations" });
    var invitations = result.invitations || [];
    list.innerHTML = invitations.length ? invitations.map(function (item) {
      var teamName = item.taldeak && item.taldeak.izena || "Taldea";
      return '<li class="item"><div class="item-main"><strong>' + esc(teamName) + '</strong><small>Taldean sartzeko gonbidapena</small></div><button class="btn secondary" type="button" data-team-invitation="accept" data-id="' + Number(item.id) + '">Onartu</button><button class="btn danger" type="button" data-team-invitation="reject" data-id="' + Number(item.id) + '">Baztertu</button></li>';
    }).join("") : '<li class="empty">Ez duzu talde-gonbidapenik.</li>';
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
  if (!selected) throw new Error("Aukeratutako taldea ez da aurkitu");
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
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).toLocaleDateString("eu-ES");
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
    console.error("Ezin izan dira arbelaren datuak irakurri", error);
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
        console.error("Ezin izan da programako kantxaren irudia kargatu: " + entry[1], error);
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
    notify("Ezin dira mota honetako elementu gehiago gehitu", "error");
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
    var text = prompt("Idatzi arbelan agertuko den testua:");
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
  $("board-frames").innerHTML = '<option value="-1">Uneko arbela</option>' + frames.map(function (_, index) {
    return '<option value="' + index + '">' + (index + 1) + '. pausoa</option>';
  }).join("");
  $("board-frames").value = String(boardFrameIndex);
  $("board-frame-update").disabled = boardFrameIndex < 0;
  $("board-frame-delete").disabled = boardFrameIndex < 0;
  $("board-animation-play").disabled = frames.length < 2;
  $("board-animation-status").textContent = frames.length + " pauso gordeta. Animazioa sortzeko gutxienez 2 behar dira.";
}

function stopBoardAnimation() {
  cancelAnimationFrame(boardAnimationRaf);
  boardAnimationRaf = 0;
  $("board-animation-play").textContent = "Animazioa ikusi";
  redrawBoard();
}

function playBoardAnimation() {
  if (boardAnimationRaf) { stopBoardAnimation(); return; }
  if (boardState.animazioa.length < 2) return;
  boardPointer = null;
  var started;
  $("board-animation-play").textContent = "Gelditu";
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
      animation.button.textContent = "Animazioa ikusi";
      animation.button.setAttribute("aria-label", "Animazioa ikusi");
    }
    if (animation.board) drawBoard(canvas, finalState || animation.board, null);
  }
  previewAnimation = null;
  previewAnimationFrame = 0;
  document.querySelectorAll("[data-play-exercise]").forEach(function (button) {
    button.textContent = "Animazioa ikusi";
    button.setAttribute("aria-label", "Animazioa ikusi");
  });
}

function playExerciseAnimation(id, targetCanvas, targetButton) {
  var exercise = exercises.find(function (item) { return Number(item.id_ariketa) === Number(id); });
  var board = exercise && parseBoardData(exercise.arbela_datuak);
  var canvas = targetCanvas || document.querySelector('[data-board-preview="' + Number(id) + '"]');
  if (!board || board.animazioa.length < 2 || !canvas) {
    notify("Ariketa honek ez du erreproduzitzeko animaziorik", "error");
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
    button.textContent = "Gelditu";
    button.setAttribute("aria-label", "Animazioa gelditu");
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
  button.textContent = "Animazioa ikusi";
  button.setAttribute("aria-label", "Animazioa ikusi");
  if (sessionView.ids.length) drawSessionBoard();
}

function renderSessionBoard() {
  stopSessionAnimation();
  var current = currentSessionBoard();
  $("session-view-title").textContent = current.exercise ? current.exercise.izena : "Saioa osatzen";
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
  if (!exercise || !board) return notify("Ariketa honek ez dauka arbelarik gordeta", "error");
  stopExerciseAnimation();
  var canvas = $("session-preview-canvas"), play = $("session-preview-play");
  canvas.width = 800;
  canvas.height = 500;
  drawBoard(canvas, board, null);
  $("session-preview-title").textContent = exercise.izena;
  $("session-preview-caption").textContent = exercise.deskribapena || exercise.kategoria || "Ariketaren aurrebista";
  play.dataset.exerciseId = String(id);
  play.textContent = "Animazioa ikusi";
  play.setAttribute("aria-label", "Animazioa ikusi: " + exercise.izena);
  play.classList.toggle("hidden", board.animazioa.length < 2);
  var dialog = $("session-preview-dialog");
  if (!dialog.open) dialog.showModal();
}

function playSessionAnimation() {
  var current = currentSessionBoard();
  var board = current.board, canvas = $("session-board");
  if (!board || board.animazioa.length < 2) {
    notify("Ariketa honek ez du erreproduzitzeko animaziorik", "error");
    return;
  }
  stopSessionAnimation();
  var button = $("session-play");
  button.textContent = "Gelditu";
  button.setAttribute("aria-label", "Animazioa gelditu");
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
  ["score-player", "shot-player"].forEach(function (id) {
    var select = $(id);
    if (!select) return;
    var selected = select.value;
    select.innerHTML = '<option value="">' + (id === "shot-player" ? "Jokalaria aukeratu" : "Ez zehaztu") + "</option>" + players.map(function (player) {
      return '<option value="' + Number(player.id_jokalaria) + '">' + esc(playerName(player)) + "</option>";
    }).join("");
    select.value = selected;
  });
  drawShotCanvases();
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
      ? '<div class="player-attendance" aria-label="Asistentzia: %' + attendancePercent + ', ' + attendancePresent + ' ' + attendanceTotal + ' saiotik">' +
        '<span class="player-attendance-label">Asistentzia</span><strong>%' + attendancePercent + '</strong>' +
        '<span class="player-attendance-bar" aria-hidden="true"><i style="width:' + attendancePercent + '%"></i></span>' +
        '<small>' + attendancePresent + '/' + attendanceTotal + ' saio</small></div>'
      : '<div class="player-attendance player-attendance-empty"><span class="player-attendance-label">Asistentzia</span><small>Erregistrorik ez</small></div>';
    return '<li class="item"><div class="item-main"><strong>' +
      (player.dortsala != null ? "#" + esc(player.dortsala) + " " : "") + esc(playerName(player)) +
      '</strong><small>' + esc(player.posizioa || "Posiziorik gabe") + " · " +
      esc(player.egoera || "") + '</small>' + attendanceMarkup + '</div><button class="btn danger" type="button" data-delete-player="' +
      Number(player.id_jokalaria) + '">Ezabatu</button></li>';
  }).join("") : '<li class="empty">' + (players.length ? "Ez da jokalaririk aurkitu iragazki horiekin." : "Ez dago jokalaririk. Gehitu lehenengo jokalaria.") + '</li>';

  var fields = [["Gol", "golak"], ["Jaurtiketa", "jaurtiketak"], ["Horia", "horia"],
    ["2 min", "two_min"], ["Gorria", "gorria"], ["Urdina", "urdina"]];
  $("match-players").innerHTML = players.length ? players.map(function (player) {
    var id = Number(player.id_jokalaria), name = esc(playerName(player));
    return '<div class="match-player"><div class="match-player-head">' +
      (player.dortsala != null ? "#" + esc(player.dortsala) + " " : "") + name +
      '</div><div class="player-stats">' + fields.map(function (field) {
        return '<label>' + field[0] + '<input type="number" min="0" max="999" value="0" aria-label="' +
          name + " " + field[0] + '" data-stat="' + field[1] + '" data-player="' + id + '"></label>';
      }).join("") + "</div></div>";
  }).join("") : '<p class="empty">Gehitu jokalariak partidako estatistikak jasotzeko.</p>';

  $("attendance-list").innerHTML = players.length ? players.map(function (player) {
    var id = Number(player.id_jokalaria), name = esc(playerName(player));
    return '<div class="attendance-row"><label class="checkrow"><input type="checkbox" data-att-player="' +
      id + '" checked><span>' + (player.dortsala != null ? "#" + esc(player.dortsala) + " " : "") +
      name + '</span></label><label>Berandu (min)<input type="number" min="0" max="999" value="0" data-late="' +
      id + '"></label><label>Atzerapen mota<select data-late-type="' + id +
      '"><option value="">Ez dago</option><option>Justifikatua</option><option>Justifikatu gabea</option></select></label></div>';
  }).join("") : '<p class="empty">Ez dago jokalaririk.</p>';
}

function sessionExerciseById(id) {
  return exercises.find(function (item) { return Number(item.id_ariketa) === Number(id); });
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
      warn.textContent = "Denbora gaindituta: " + (used - total) + " min gehiago. Gehitu ditzakezu, baina egiaztatu denbora.";
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
    filter.innerHTML = '<option value="">Kategoria guztiak</option>';
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
      '<button class="btn secondary" type="button" data-session-view="' + id + '">Arbela</button>' +
      '<button class="btn" type="button" data-session-add="' + id + '">Gehitu</button></li>';
  }).join("") : '<li class="empty">' + (sessionCategoryFilter
    ? "Ez dago ariketarik kategoria honetan." : "Ez dago ariketarik liburutegian.") + "</li>";
  var groupLabel = $("session-current-group");
  if (groupLabel) groupLabel.textContent = "Hurrengo ariketak: " + (activeSessionGroup ? activeSessionGroup.name : "Tarterik gabe");
  $("session-selected").innerHTML = sessionSelection.length ? sessionSelection.map(function (entry) {
    if (entry.is_separator) return '<li class="session-group-row" data-session-drop-group="' + esc(entry.group_id) + '"><strong>' + esc(entry.taldea) +
      '</strong><button class="slot-remove" type="button" data-session-remove-group="' + esc(entry.group_id) + '" aria-label="Kendu tartea">×</button></li>';
    var exercise = sessionExerciseById(entry.id_ariketa), id = Number(entry.id_ariketa);
    if (!exercise) return "";
    return '<li class="session-slot" data-session-drop-exercise="' + id + '"><button class="session-drag-handle" type="button" data-session-drag-handle aria-label="Arrastatu ordena aldatzeko: ' + esc(exercise.izena) + '" title="Arrastatu ordena aldatzeko">&#8942;&#8942;</button><span class="slot-name">' + esc(exercise.izena) +
      '</span><input type="number" min="0" max="999" value="' + Number(entry.iraupena_minutuak) +
      '" data-session-minutes="' + id + '" aria-label="Minutuak: ' + esc(exercise.izena) + '">' +
      '<label class="session-exercise-notes-field">Oharrak<textarea class="session-exercise-notes" rows="2" maxlength="3000" data-session-notes="' + id + '" aria-label="Oharrak: ' + esc(exercise.izena) + '" placeholder="Idatzi ariketa honetarako oharrak">' + esc(entry.aldaerak || "") + '</textarea></label>' +
      '<button class="slot-remove" type="button" data-session-remove="' + id +
      '" aria-label="Kendu ariketa">✕</button></li>';
  }).join("") : '<li class="empty">Gehitu ariketak ezkerraldetik.</li>';
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
  if (!name) { notify("Idatzi tartearen izena", "error"); return; }
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
  if (name) notify('"' + name + '" tartea kendu da', "success");
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
      Number(exercise.id_ariketa) + '" aria-label="Arbelaren aurrebista: ' + esc(exercise.izena) + '"></canvas>' : '<span class="exercise-board-placeholder" aria-hidden="true"></span>') +
      '<div class="exercise-actions">' + (hasAnimation
        ? '<button class="btn secondary" type="button" data-play-exercise="' + Number(exercise.id_ariketa) +
          '" aria-label="Animazioa ikusi">Animazioa ikusi</button>' : "") +
      '<button class="btn danger" type="button" data-delete-exercise="' +
      Number(exercise.id_ariketa) + '">Ezabatu</button></div></li>';
  }).join("") : '<li class="empty">' + (categoryFilter ? 'Ez dago ariketarik kategoria honetan.' : 'Ariketa-liburutegia hutsik dago.') + '</li>';
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
    }).join("") : '<span class="muted">Oraindik ez dago kategoriarik.</span>';
  }
  var listFilter = $("exercise-list-category");
  if (listFilter) {
    var selectedFilter = listFilter.value;
    listFilter.innerHTML = '<option value="">Kategoria guztiak</option>' + names.map(function (name) {
      return '<option value="' + esc(name) + '">' + esc(name) + '</option>';
    }).join("");
    listFilter.value = names.find(function (name) {
      return normalizeCategoryName(name) === normalizeCategoryName(selectedFilter);
    }) || "";
  }
  var list = $("exercise-category-list");
  if (list) list.innerHTML = categories.length ? categories.map(function (category) {
    return '<li class="item"><div class="item-main"><strong>' + esc(category.izena) + '</strong></div>' +
      '<button class="btn danger" type="button" data-delete-exercise-category="' + esc(category.izena) + '">Ezabatu</button></li>';
  }).join("") : '<li class="empty">Oraindik ez dago kategoriarik. Sortu kategoria liburutegian erabiltzeko.</li>';
}

function renderSavedSession(sessionId) {
  var session = sessions.find(function (item) { return Number(item.id_saio) === Number(sessionId); });
  if (!session) return false;
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
  var meta = [formatDay(session), session.lekua || "", exerciseCount + " ariketa"].filter(Boolean);
  $("saved-session-title").textContent = session.helburu_taktikoa || "Entrenamendua";
  $("saved-session-meta").textContent = meta.join(" · ");
  $("saved-session-goal").textContent = session.helburu_taktikoa || "Helburu taktikorik gabe";
  $("saved-session-cycle").textContent = micro ? "Mikrozikloa · " + (micro.mota || "Mikrozikloa") : "Ez dago mikroziklo bati lotuta";
  $("saved-session-total").textContent = totalMinutes + " min";
  var previewBoards = [], renderedExerciseIndex = 0, lastGroup = null;
  var savedMarkup = details.map(function (detail, index) {
    if (detail.id_ariketa == null) {
      var separatorName = String(detail.taldea || "").trim();
      lastGroup = separatorName || null;
      return separatorName ? '<div class="training-session-group"><span>' + esc(separatorName) + '</span></div>' : "";
    }
    var detailGroup = String(detail.taldea || "").trim();
    var heading = "";
    if (detailGroup && detailGroup !== lastGroup) {
      heading = '<div class="training-session-group"><span>' + esc(detailGroup) + '</span></div>';
    }
    lastGroup = detailGroup || null;
    var step = ++renderedExerciseIndex;
    var exercise = exercises.find(function (item) { return Number(item.id_ariketa) === Number(detail.id_ariketa); });
    var board = exercise && parseBoardData(exercise.arbela_datuak);
    var hasAnimation = board && board.animazioa.length > 1;
    if (board) previewBoards.push({ index: index, data: board });
    var title = exercise ? exercise.izena : "Ariketa ez dago eskuragarri";
    return heading + '<article class="training-exercise-card"><div class="training-exercise-head"><span class="training-step">' +
      step + '</span><div><h3>' + esc(title) + '</h3><div class="training-exercise-meta">' +
      (exercise && exercise.kategoria ? esc(exercise.kategoria) + " · " : "") +
      Number(detail.iraupena_minutuak || 0) + ' min</div></div></div>' +
      (board ? '<canvas class="training-exercise-preview" width="800" height="500" data-training-preview="' + index + '" aria-label="' + esc(title) + ' ariketa-arbela"></canvas>' : "") +
      (exercise && exercise.deskribapena ? '<p class="training-exercise-description">' + esc(exercise.deskribapena) + '</p>' : "") +
      (detail.aldaerak ? '<p class="training-exercise-notes"><strong>Oharrak:</strong> ' + esc(detail.aldaerak) + '</p>' : "") +
      (board ? '<div class="training-exercise-actions">' +
        (hasAnimation ? '<button class="btn secondary" type="button" data-play-training-animation="' + Number(detail.id_ariketa) + '" aria-label="Ariketa txartelean animazioa ikusi">Animazioa ikusi</button>' : "") +
        '<button class="btn secondary" type="button" data-training-board="' + Number(detail.id_ariketa) + '" data-training-session="' + Number(sessionId) + '">Arbela handitu</button></div>' : "") +
      '</article>';
  }).join("");
  $("saved-session-exercises").innerHTML = savedMarkup || '<div class="card empty">Saio honek ez dauka lotutako ariketarik.</div>';
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
      Number(session.id_saio) + '">Ikusi</button><button class="btn secondary" type="button" data-attendance-session="' +
      Number(session.id_saio) + '">Asistentzia</button></div></li>';
  }).join("") : '<li class="empty">Oraindik ez da entrenamendurik gorde.</li>';
  var select = $("attendance-session"), prior = select.value;
  select.innerHTML = '<option value="">Aukeratu entrenamendua</option>' + sessions.map(function (session) {
    return '<option value="' + Number(session.id_saio) + '">' + esc(formatDay(session)) +
      " · " + esc(session.lekua || "") + "</option>";
  }).join("");
  if (sessions.some(function (session) { return String(session.id_saio) === prior; })) select.value = prior;
  $("attendance-open").disabled = !select.value;
}

function renderMatches() {
  $("matches-list").innerHTML = matches.length ? matches.map(function (match) {
    return '<li class="item"><div class="item-main"><strong>' + esc(match.aurkaria || "Aurkaria") +
      " · " + Number(match.emaitza_geurea || 0) + " - " + Number(match.emaitza_aurkaria || 0) +
      '</strong><small>' + esc(formatDate(match)) + " · " + esc(match.lekua || "") +
      '</small></div><span class="match-actions"><button class="btn secondary" type="button" data-match-stats="' +
      Number(match.id_partida) + '">Estatistikak</button> <button class="btn secondary" type="button" data-edit-match="' +
      Number(match.id_partida) + '">Editatu</button> <button class="btn danger" type="button" data-delete-match="' +
      Number(match.id_partida) + '">Ezabatu</button></span></li>';
  }).join("") : '<li class="empty">Oraindik ez da partidarik gorde.</li>';
  var statsMatch = $("stats-match"), priorStatsMatch = statsMatch.value;
  statsMatch.innerHTML = '<option value="">Partida guztiak</option>' + matches.map(function (match) {
    return '<option value="' + Number(match.id_partida) + '">' + esc(formatDate(match) + " · " + (match.aurkaria || "Aurkaria")) + '</option>';
  }).join("");
  if (matches.some(function (match) { return String(match.id_partida) === priorStatsMatch; })) statsMatch.value = priorStatsMatch;
  var opponentSelect = $("stats-opponent"), priorOpponent = opponentSelect.value;
  var opponentNames = Array.from(new Set(matches.map(function (match) { return String(match.aurkaria || "Aurkaria"); }))).sort();
  opponentSelect.innerHTML = '<option value="">Aurkari guztiak</option>' + opponentNames.map(function (name) { return '<option value="' + esc(name) + '">' + esc(name) + '</option>'; }).join("");
  if (opponentNames.indexOf(priorOpponent) !== -1) opponentSelect.value = priorOpponent;
}

function renderMatchEditor(matchId) {
  var match = matches.find(function (item) { return Number(item.id_partida) === Number(matchId); });
  if (!match) {
    $("match-detail").classList.add("hidden");
    notify("Ezin izan da partida aurkitu. Freskatu zerrenda.", "error");
    return;
  }
  var playerRows = records("partida_jokalariak").filter(function (row) {
    return Number(row.id_partida) === Number(matchId);
  });
  var sanctions = records("partidu_zigorrak").filter(function (row) {
    return Number(row.id_partida) === Number(matchId);
  });
  var fields = [["Gol", "golak", 999], ["Jaurtiketa", "jaurtiketak", 999],
    ["Horia", "horia", 100], ["2 min", "two_min", 100],
    ["Gorria", "gorria", 100], ["Urdina", "urdina", 100]];
  $("match-detail").innerHTML =
    '<form id="match-edit-form" class="stack" data-match-edit-id="' + Number(matchId) + '">' +
    '<div class="toolbar"><div><h2>' + esc(match.aurkaria || "Aurkaria") +
    ' · partida editatzen</h2><p class="muted">' + esc(formatDate(match)) +
    " · " + esc(match.lekua || "") + '</p></div><button class="btn secondary" type="button" data-close-match-stats>Itxi</button></div>' +
    '<div class="grid2"><label>Gure emaitza<input type="number" min="0" max="999" required data-match-score="home" value="' +
    Number(match.emaitza_geurea || 0) + '"></label><label>Aurkariaren emaitza<input type="number" min="0" max="999" required data-match-score="away" value="' +
    Number(match.emaitza_aurkaria || 0) + '"></label></div>' +
    '<h3>Jokalari bakoitzaren estatistikak</h3>' +
    (players.map(function (player) {
      var playerId = Number(player.id_jokalaria);
      var row = playerRows.find(function (item) { return Number(item.id_jokalaria) === playerId; });
      var playerSanctions = byPlayer(sanctions, playerId);
      var name = (player.dortsala != null ? "#" + player.dortsala + " " : "") + playerName(player);
      return '<div class="match-player"><label class="checkrow match-player-head"><input type="checkbox" data-edit-played="' +
        playerId + '"' + (row ? " checked" : "") + '><span>' + esc(name) +
        ' · Partidara joan da</span></label><div class="player-stats">' + fields.map(function (field) {
          var value = field[1] === "golak" || field[1] === "jaurtiketak"
            ? Number(row && row[field[1]] || 0)
            : playerSanctions.filter(function (item) {
              return item.mota === (field[1] === "two_min" ? "2min" : field[1]);
            }).length;
          return '<label>' + field[0] + '<input type="number" min="0" max="' + field[2] +
            '" required value="' + value + '" data-edit-stat="' + field[1] +
            '" data-edit-player="' + playerId + '"' + (row ? "" : " disabled") + '></label>';
        }).join("") + '</div></div>';
    }).join("") || '<p class="empty">Ez dago jokalaririk.</p>') +
    '<p class="muted">Jaurtiketen kokapen zehatzak ez dira aldatuko.</p>' +
    '<div class="grid2"><button class="btn" type="submit">Aldaketak gorde</button><button class="btn secondary" type="button" data-close-match-stats>Utzi</button></div>' +
    '</form>';
  $("match-detail").classList.remove("hidden");
  $("match-detail").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderDashboard() {
  if (!$('home-session-content')) return;
  var now = new Date();
  var dashboardDate = function (value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || "");
    var weekdays = ["igandea", "astelehena", "asteartea", "asteazkena", "osteguna", "ostirala", "larunbata"];
    var months = ["urtarrilaren", "otsailaren", "martxoaren", "apirilaren", "maiatzaren", "ekainaren", "uztailaren", "abuztuaren", "irailaren", "urriaren", "azaroaren", "abenduaren"];
    var time = String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
    return weekdays[date.getDay()] + ", " + date.getFullYear() + "ko " + months[date.getMonth()] + " " + date.getDate() + "a · " + time;
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
  $("home-title").textContent = "Ongi etorri" + (userName ? ", " + userName : "");
  $("home-subtitle").textContent = "Zure taldearen azken jarduerak eta hurrengo erronka.";
  $("home-session-content").innerHTML = latestSession
    ? '<h2>' + esc(latestSession.helburu_taktikoa || "Entrenamendua") + '</h2><p>' + esc(latestSession.lekua || "Tokia zehaztu gabe") + '</p><div class="home-card-date"><i></i>' + esc(dashboardDate(latestSession.data_ordua)) + '</div><button class="btn secondary" type="button" data-view-session="' + Number(latestSession.id_saio) + '">Entrenamendua ikusi</button>'
    : '<h2>Ez dago aurreko entrenamendurik</h2><p>Gordetako azken entrenamendua hemen azalduko da.</p><button class="btn secondary" type="button" data-open-section="v-sessions">Entrenamenduetara joan</button>';
  $("home-match-content").innerHTML = latestMatch
    ? '<h2>' + esc(latestMatch.aurkaria || "Aurkaria") + '</h2><p>' + esc(dashboardDate(latestMatch.data_ordua)) + '</p><div class="home-card-date"><i></i>' + Number(latestMatch.emaitza_geurea || 0) + ' – ' + Number(latestMatch.emaitza_aurkaria || 0) + '</div><button class="btn secondary" type="button" data-match-stats="' + Number(latestMatch.id_partida) + '">Partidako estatistikak</button>'
    : '<h2>Ez dago aurreko partidarik</h2><p>Gordetako azken partidaren emaitza eta estatistikak hemen azalduko dira.</p><button class="btn secondary" type="button" data-open-section="v-matches">Partidak ikusi</button>';
  $("home-next-match-content").innerHTML = nextMatch
    ? '<h2>' + esc(nextMatch.aurkaria || "Aurkaria") + '</h2><p>' + esc(nextMatch.lekua || "Tokia zehaztu gabe") + '</p><div class="home-card-date"><i></i>' + esc(dashboardDate(nextMatch.data_ordua)) + '</div><button class="btn secondary" type="button" data-open-section="v-matches">Partidaren xehetasunak</button>'
    : '<h2>Ez dago hurrengo partidarik</h2><p>Programatzen duzunean, data eta ordua hemen agertuko dira.</p><button class="btn secondary" type="button" data-open-section="v-matches">Partida berria gehitu</button>';
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
    if (opponent && String(m.aurkaria || "Aurkaria") !== opponent) return false;
    if (selectedMatch && Number(m.id_partida) !== selectedMatch) return false;
    return true;
  });
  var ids = new Set(filteredMatches.map(function (m) { return Number(m.id_partida); }));
  var playerRows = records("partida_jokalariak").filter(function (r) { return ids.has(Number(r.id_partida)); });
  var sanctions = records("partidu_zigorrak").filter(function (r) { return ids.has(Number(r.id_partida)); });
  var shots = records("partidu_jaurtiketak").filter(function (r) { return ids.has(Number(r.id_partida)); });
  var ownShots = shots.filter(function (s) { return !/aurkari|opponent/i.test(String(s.taldea || "")); });
  var awayShots = shots.filter(function (s) { return /aurkari|opponent/i.test(String(s.taldea || "")); });
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
  var penalties = mapShots.filter(isPenalty), penaltyGoals = goalCount(penalties);
  var metric = function (name, value, detail) { return '<div class="card"><strong>' + esc(value) + '</strong><div>' + esc(name) + '</div><small class="muted">' + esc(detail || "") + '</small></div>'; };
  $("stats-summary").innerHTML = mode === "opponents" ? [metric("Partidak", filteredMatches.length, "Aurkariak: " + Object.keys(Object.fromEntries(filteredMatches.map(function (m) { return [m.aurkaria || "Aurkaria", true]; }))).length), metric("Aurkariaren golak", against, (filteredMatches.length ? (against / filteredMatches.length).toFixed(1) : "0.0") + " partidako"), metric("Jaurtiketen eraginkortasuna", awayShots.length ? Math.round(goalCount(awayShots) / awayShots.length * 100) + "%" : "—", goalCount(awayShots) + " gol / " + awayShots.length + " jaurtiketa"), metric("Gure golak", totalGoals, "Aurkariaren aurkako emaitza"), metric("Penaltiak", penalties.length, penaltyGoals + " gol · " + (penalties.length ? Math.round(penaltyGoals / penalties.length * 100) : 0) + "%"), metric("Zigorrak", sanctions.length, "Partida hauetan jasota")].join("") : [metric("Partidak", filteredMatches.length, wins + " garaipen · " + draws + " berdinketa · " + (filteredMatches.length - wins - draws) + " porrot"), metric("Golak", totalGoals, (filteredMatches.length ? (totalGoals / filteredMatches.length).toFixed(1) : "0.0") + " partidako"), metric("Jaurtiketen eraginkortasuna", ownShots.length ? Math.round(goalCount(ownShots) / ownShots.length * 100) + "%" : "—", goalCount(ownShots) + " gol / " + ownShots.length + " jaurtiketa"), metric("Aurkariaren golak", against, (filteredMatches.length ? (against / filteredMatches.length).toFixed(1) : "0.0") + " partidako"), metric("Penaltiak", penalties.length, penaltyGoals + " gol · " + (penalties.length ? Math.round(penaltyGoals / penalties.length * 100) : 0) + "%"), metric("Zigorrak", sanctions.length, sanctions.filter(function (s) { return s.mota === "2min"; }).length + " bi minutuko")].join("");
  $("stats-heading").textContent = mode === "team" ? "Taldearen laburpena" : mode === "players" ? "Jokalari estatistikak" : "Aurkari estatistikak";
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
  $("stats-list").innerHTML = playerStats.length ? playerStats.map(function (s) { var pct = s.shots ? Math.round(s.goals / s.shots * 100) : 0, normalPct = s.normalShots ? Math.round(s.normalGoals / s.normalShots * 100) : 0, penaltyPct = s.penaltyShots ? Math.round(s.penaltyGoals / s.penaltyShots * 100) : 0; return '<li class="item"><div class="item-main"><strong>' + esc(s.label) + '</strong><small>' + s.appearances + ' partida · Guztira: ' + s.goals + '/' + s.shots + ' (%' + pct + ') · Jaurtiketa arruntak: ' + s.normalGoals + '/' + s.normalShots + ' (%' + normalPct + ') · Penaltiak: ' + s.penaltyGoals + '/' + s.penaltyShots + ' (%' + penaltyPct + ')</small></div><span class="muted">🟨 ' + s.yellow + ' · 2\' ' + s.two + ' · 🟥 ' + s.red + ' · 🔵 ' + s.blue + '</span></li>'; }).join("") : '<li class="empty">Ez dago iragazki hauekin bat datorren jokalari daturik.</li>';
  $("stats-players-visual").innerHTML = playerStats.length ? playerStats.map(function (s) {
    var pct = s.shots ? Math.round(s.goals / s.shots * 100) : 0;
    var normalPct = s.normalShots ? Math.round(s.normalGoals / s.normalShots * 100) : 0;
    var penaltyPct = s.penaltyShots ? Math.round(s.penaltyGoals / s.penaltyShots * 100) : 0;
    return '<article class="player-visual-card"><div class="pv-head"><div class="pv-name"><strong>' + esc(s.label) + '</strong><small>' + s.appearances + ' partida</small></div><div><div class="efficiency-ring" style="--efficiency:' + pct + '%" role="img" aria-label="Eraginkortasuna %' + pct + '"><span>' + pct + '%</span></div><div class="efficiency-label">eraginkortasuna</div></div></div><div class="pv-metrics"><div class="pv-metric"><strong>' + s.goals + '</strong><small>Golak</small></div><div class="pv-metric"><strong>' + s.shots + '</strong><small>Jaurtiketak</small></div><div class="pv-metric"><strong>' + s.appearances + '</strong><small>Partidak</small></div></div><div class="pv-section-title">Jaurtiketen banaketa</div><div class="pv-breakdown"><strong>Arruntak</strong><span>' + s.normalGoals + ' / ' + s.normalShots + ' · %' + normalPct + '</span><div class="pv-bar"><i style="width:' + normalPct + '%"></i></div></div><div class="pv-breakdown"><strong>Penaltiak</strong><span>' + s.penaltyGoals + ' / ' + s.penaltyShots + ' · %' + penaltyPct + '</span><div class="pv-bar"><i style="width:' + penaltyPct + '%"></i></div></div><div class="pv-sanctions"><span>🟨 ' + s.yellow + '</span><span>2\' ' + s.two + '</span><span>🟥 ' + s.red + '</span><span>🔵 ' + s.blue + '</span></div></article>';
  }).join("") : '<div class="empty">Ez dago iragazki hauekin bat datorren jokalari estatistikarik.</div>';
  var rivalMap = {};
  filteredMatches.forEach(function (m) { var name = m.aurkaria || "Aurkaria", x = rivalMap[name] || (rivalMap[name] = { matches: 0, gf: 0, ga: 0 }); x.matches++; x.gf += Number(m.emaitza_geurea || 0); x.ga += Number(m.emaitza_aurkaria || 0); });
  $("stats-opponent-list").innerHTML = Object.keys(rivalMap).sort().map(function (name) { var x = rivalMap[name], rivalIds = new Set(filteredMatches.filter(function (m) { return String(m.aurkaria || "Aurkaria") === name; }).map(function (m) { return Number(m.id_partida); })), rs = awayShots.filter(function (s) { return rivalIds.has(Number(s.id_partida)); }); return '<li class="item"><div class="item-main"><strong>' + esc(name) + '</strong><small>' + x.matches + ' partida · Emaitzak ' + x.gf + '-' + x.ga + ' · Aurkariaren jaurtiketak: ' + (rs.length ? rs.length + ' (' + goalCount(rs) + ' gol, %' + Math.round(goalCount(rs) / rs.length * 100) + ')' : 'daturik gabe') + '</small></div></li>'; }).join("") || '<li class="empty">Ez dago aurkari daturik.</li>';
  var buckets = [0, 0, 0, 0, 0, 0, 0], bucketGoals = [0, 0, 0, 0, 0, 0, 0], labels = ["0–9", "10–19", "20–29", "30–39", "40–49", "50–59", "60+"];
  mapShots.forEach(function (s) { var minute = Number(s.minutua || 0), i = Math.min(6, Math.floor(minute / 10)); buckets[i]++; if (isGoal(s)) bucketGoals[i]++; });
  $("stats-period-chart").innerHTML = labels.map(function (label, i) { return '<div class="card"><strong>' + label + " min</strong><small> · " + bucketGoals[i] + " gol / " + buckets[i] + " jaurtiketa" + (buckets[i] ? " · %" + Math.round(bucketGoals[i] / buckets[i] * 100) : "") + '</small><div style="height:8px;background:var(--line);border-radius:8px;margin-top:8px"><div style="width:' + (buckets[i] ? Math.max(3, bucketGoals[i] / buckets[i] * 100) : 0) + '%;height:100%;background:var(--blue);border-radius:8px"></div></div></div>'; }).join("");
  var zoneList = function (list, fieldX, fieldY, data, mapId, type) { var counts = {}, points = []; data.forEach(function (s) { var x = Number(s[fieldX]), y = Number(s[fieldY]); if (!Number.isFinite(x) || !Number.isFinite(y)) return; var col = x < .35 ? "Ezkerreko" : x < .65 ? "Erdiko" : "Eskuinako", row = type === "origin" ? "" : (y < .333 ? "Goikoa" : y < .667 ? "Erdikoa" : "Behekoa"), key = type === "origin" ? (y < .377 ? (x < .35 ? "Ezkerreko extremoa" : x < .65 ? "Pibotea" : "Eskubiko extremoa") : (x < .35 ? "Ezkerreko laterala" : x < .65 ? "Zentrala" : "Eskubiko laterala")) : row + " · " + col, z = counts[key] || (counts[key] = { n: 0, g: 0 }); z.n++; if (isGoal(s)) z.g++; points.push({ x: x, y: y, goal: isGoal(s) }); }); var keys = Object.keys(counts).sort(); $(list).innerHTML = keys.length ? keys.map(function (k) { var z = counts[k]; return '<li class="item"><strong>' + esc(k) + '</strong><span>' + z.g + '/' + z.n + ' gol (' + Math.round(z.g / z.n * 100) + '%)</span></li>'; }).join("") : '<li class="empty">Ez dago koordenatudun jaurtiketarik.</li>'; var svg = type === "origin" ? '<svg viewBox="0 0 800 520" role="img" aria-label="Jaurtiketen jatorria zelaiaren irudian"><image href="./irudiak/Zelai-erdia.png" x="0" y="0" width="800" height="520" preserveAspectRatio="none" transform="rotate(180 400 260)"/>' : '<svg viewBox="0 0 360 210" role="img" aria-label="Atearen helburu mapa"><rect width="360" height="210" fill="#26324a"/><path d="M10 10H350V200H10Z M123 10V200 M237 10V200 M10 73H350 M10 137H350" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="2"/>';
    var circles = points.map(function (p) { var px = type === "origin" ? Math.max(10, Math.min(790, p.x * 800)) : 18 + Math.max(0, Math.min(1, p.x)) * 324, py = type === "origin" ? Math.max(10, Math.min(510, p.y * 520)) : 18 + Math.max(0, Math.min(1, p.y)) * 174; return '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="' + (type === "origin" ? "12" : "5") + '" fill="' + (p.goal ? "#20d67a" : "#ff5263") + '" fill-opacity=".88" stroke="#fff" stroke-width="2"/>'; }).join("");
    $(mapId).innerHTML = svg + circles + '</svg>'; };
  zoneList("stats-origin-zones", "jatorri_x", "jatorri_y", mapShots, "stats-court-map", "origin"); zoneList("stats-goal-zones", "helburu_x", "helburu_y", mapShots, "stats-goal-map", "goal");
  $("stats-penalties").innerHTML = penalties.length ? '<li class="item"><strong>' + penalties.length + ' penalti</strong><span>' + penaltyGoals + ' gol · ' + (penalties.length - penaltyGoals) + ' huts · %' + Math.round(penaltyGoals / penalties.length * 100) + ' eraginkortasuna</span></li>' : '<li class="empty">Ez dago penalti jaurtiketen erregistrorik.</li>';
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
      makroIzena: macroById[macroId] ? macroById[macroId].izena : "Makroziklorik gabe",
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
    '<span class="plan-day-num">' + (key === todayKey ? "Gaur · " : "") + day.getDate() + "</span>";
  var dayMacros = spans.filter(function (span) {
    return planKey(span.start) <= key && key <= planKey(span.end);
  });
  dayMacros.slice(0, 2).forEach(function (span) {
    var label = (key === planKey(span.start) || day.getDay() === 1 || day.getDate() === 1) ? span.izena : "";
    html += '<button type="button" class="plan-macro' + (label ? "" : " empty") + '" style="background:' + span.color +
      '" data-plan-macro="' + span.id + '" title="' + esc(span.izena) + '" aria-label="Editatu makrozikloa: ' + esc(span.izena) + '">' + esc(label) + "</button>";
  });
  if (dayMacros.length > 2) html += '<span class="plan-more">+' + (dayMacros.length - 2) + " makro</span>";
  var dayMicros = microList.filter(function (micro) {
    return planKey(micro.start) <= key && key <= planKey(micro.end);
  });
  dayMicros.slice(0, 3).forEach(function (micro) {
    var text = micro.makroIzena + " | A" + (micro.aste == null ? "" : micro.aste) + " " + micro.mota;
    html += '<button type="button" class="plan-micro" style="background:' + micro.color +
      '" data-plan-micro="' + micro.id + '" title="' + esc(text) + '">' + esc(text) + "</button>";
  });
  if (dayMicros.length > 3) html += '<span class="plan-more">+' + (dayMicros.length - 3) + " gehiago</span>";
  var dayMatches = records("partidak").filter(function (match) {
    return String(match.data_ordua || "").slice(0, 10) === key;
  });
  dayMatches.slice(0, 2).forEach(function (match) {
    var played = key <= todayKey && (Number(match.emaitza_geurea || 0) || Number(match.emaitza_aurkaria || 0));
    var text = played
      ? match.aurkaria + " (" + Number(match.emaitza_geurea || 0) + "-" + Number(match.emaitza_aurkaria || 0) + ")"
      : match.aurkaria + " (jolasteko)";
    html += '<button type="button" class="plan-event match" data-match-stats="' + Number(match.id_partida) + '" title="Partidako estatistikak ikusi: ' + esc(text) + '">' + esc(text) + "</button>";
  });
  records("saioak").filter(function (session) {
    return String(session.data_ordua || "").slice(0, 10) === key;
  }).slice(0, 2).forEach(function (session) {
    var text = session.helburu_taktikoa || "Entrenamendua";
    html += '<button type="button" class="plan-event session" data-view-session="' + Number(session.id_saio) + '" title="Entrenamendua ikusi: ' + esc(text) + '">' + esc(text) + "</button>";
  });
  records("txapelketak").filter(function (cup) {
    return String(cup.data_ordua || "").slice(0, 10) === key;
  }).slice(0, 2).forEach(function (cup) {
    var text = (cup.izena || "Txapelketa") + (cup.kategoria ? " [" + cup.kategoria + "]" : "");
    html += '<button type="button" class="plan-event cup" data-view-cup="' + Number(cup.id_txapelketa) + '" title="Txapelketaren xehetasunak ikusi: ' + esc(text) + '">' + esc(text) + "</button>";
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
  $("plan-month").textContent = PLAN_MONTHS[base.getMonth()] + " " + base.getFullYear();
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
  }).join("") : '<span class="muted">Ez dago makroziklorik hilabete honetan.</span>';
  var microLegend = MICRO_TYPES.map(function (type) {
    return '<span class="plan-legend-type"><i style="background:' + MICRO_TYPE_COLORS[type] + '"></i>Mikro · ' + esc(type) + '</span>';
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
  records("saioak").forEach(function (item) { addAgenda(item.data_ordua, "Entrenamendua", item.helburu_taktikoa || "Entrenamendua", formatDay(item), "data-view-session", item.id_saio); });
  records("partidak").forEach(function (item) { addAgenda(item.data_ordua, "Partida", item.aurkaria || "Aurkaria", formatDate(item), "data-match-stats", item.id_partida); });
  records("txapelketak").forEach(function (item) { addAgenda(item.data_ordua, "Txapelketa", item.izena || "Txapelketa", [item.kategoria, item.lekua].filter(Boolean).join(" · "), "data-view-cup", item.id_txapelketa); });
  records("mikrozikloak").forEach(function (item) { addAgenda(item.hasiera_data, "Mikrozikloaren hasiera", item.mota || "Mikrozikloa", "Amaiera: " + (item.amaiera_data || "—"), "data-plan-micro", item.id_mikroziklo); });
  records("makrozikloak").forEach(function (item) { addAgenda(item.hasiera_data, "Makrozikloaren hasiera", item.izena || "Makrozikloa", "Amaiera: " + (item.amaiera_data || "—"), "data-plan-macro", item.id_makro); });
  agenda.sort(function (a, b) { return a.date - b.date || a.kind.localeCompare(b.kind); });
  $("plan-agenda").innerHTML = agenda.length ? agenda.map(function (item) {
    var dateLabel = item.date.toLocaleDateString("eu-ES", { weekday: "short" });
    var itemAction = item.actionAttr ? ' data-agenda-action="' + item.actionAttr + '" data-agenda-id="' + Number(item.actionId) + '" role="button" tabindex="0"' : "";
    return '<li class="item"' + itemAction + '><span class="agenda-date">' + dateLabel + '<br>' + item.date.getDate() + '</span><div class="agenda-detail"><span class="agenda-kind">' + esc(item.kind) + '</span><strong>' + esc(item.title) + '</strong><small class="muted">' + esc(item.detail) + '</small></div>' + (item.actionAttr ? '<span class="agenda-open" aria-hidden="true">›</span>' : '') + '</li>';
  }).join("") : '<li class="empty">Hilabete honetan ez dago jarduerarik.</li>';
}

function planTypeOptions(current) {
  var names = records("mikro_motak").map(function (row) { return row.izena; }).filter(Boolean);
  if (!names.length) names = MICRO_TYPES.slice();
  if (current && names.indexOf(current) === -1) names = names.concat([current]);
  return names.map(function (name) {
    return '<option value="' + esc(name) + '"' + (name === current ? " selected" : "") + ">" + esc(name) + "</option>";
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
  $("plan-modal-title").textContent = (record ? "Editatu " : "Sortu ") + (isMacro ? "makrozikloa" : "mikrozikloa");
  var fields = "";
  if (isMacro) {
    fields += '<label>Izena<input name="izena" required maxlength="120" value="' +
      esc(record ? record.izena : "") + '"></label>';
    fields += '<div class="grid2"><label>Hasiera<input name="hasiera_data" type="date" value="' +
      esc(record ? planInput(record.hasiera_data) : planDefaultStart()) +
      '"></label><label>Amaiera<input name="amaiera_data" type="date" value="' +
      esc(record ? planInput(record.amaiera_data) : planDefaultEnd()) + '"></label></div>';
  } else {
    var options = '<option value="">Makroziklorik gabe</option>' + planMacroList().map(function (macro) {
      return '<option value="' + Number(macro.id_makro) + '"' +
        (record && Number(record.id_makro) === Number(macro.id_makro) ? " selected" : "") +
        ">" + esc(macro.izena) + "</option>";
    }).join("");
    fields += "<label>Makrozikloa<select name=\"id_makro\">" + options + "</select></label>";
    fields += '<div class="grid2"><label>Hasiera<input name="hasiera_data" type="date" required value="' +
      esc(record ? planInput(record.hasiera_data) : planDefaultStart()) +
      '"></label><label>Amaiera<input name="amaiera_data" type="date" required value="' +
      esc(record ? planInput(record.amaiera_data) : planDefaultEnd()) + '"></label></div>';
    fields += '<div class="grid2"><label>Mota<select name="mota">' +
      planTypeOptions(record ? record.mota : "Karga") +
      '</select></label><label>Aste-zenbakia<input name="aste_zenbakia" type="number" min="1" max="53" value="' +
      esc(record && record.aste_zenbakia != null ? record.aste_zenbakia : "") + '"></label></div>';
    fields += '<label>Helburu nagusia<input name="helburu_nagusia" maxlength="250" value="' +
      esc(record ? record.helburu_nagusia : "") + '"></label>';
  }
  fields += '<div class="modal-actions"><button class="btn" type="submit">Gorde</button>' +
    '<button class="btn secondary" type="button" data-plan-cancel>Ezeztatu</button>' +
    (record ? '<button class="btn danger" type="button" data-plan-delete>Ezabatu</button>' : "") + "</div>";
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
  }).join("") : '<li class="empty">Ez dago makroziklorik.</li>';
  $("session-micro").innerHTML = '<option value="">Mikroziklorik gabe</option>' + micros.map(function (micro) {
    return '<option value="' + Number(micro.id_mikroziklo) + '">' + esc(micro.mota || "Mikrozikloa") +
      " · " + esc(micro.hasiera_data || "") + "</option>";
  }).join("");
  $("micros-list").innerHTML = micros.length ? micros.map(function (micro) {
    return '<li class="item"><div class="item-main"><strong>' + esc(micro.mota || "Mikrozikloa") +
      (micro.aste_zenbakia ? " · " + esc(micro.aste_zenbakia) + ". astea" : "") +
      '</strong><small>' + esc(micro.hasiera_data || "") + " – " + esc(micro.amaiera_data || "") +
      (micro.helburu_nagusia ? " · " + esc(micro.helburu_nagusia) : "") +
      "</small></div></li>";
  }).join("") : '<li class="empty">Ez dago mikroziklorik.</li>';
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
  if (!id) return notify("Aukeratu entrenamendua lehenik", "error");
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
var scoreTimer = 0;
function scoreStorageKey() { return "7metro-scoreboard-" + (teamId || "local"); }
function scoreRead() {
  scoreboard = { home: 0, away: 0, seconds: 0, period: 0, running: false, events: [], lastTick: 0, savedMatchId: null };
  try {
    var saved = JSON.parse(localStorage.getItem(scoreStorageKey()) || "null");
    if (saved && typeof saved === "object") scoreboard = Object.assign(scoreboard, saved, { running: false, lastTick: 0 });
  } catch (error) { console.warn("Markagailua ezin izan da kargatu", error); }
  var saveButton = $("score-save-match"), saveStatus = $("score-save-status");
  if (saveButton && saveStatus) {
    saveButton.disabled = Boolean(scoreboard.savedMatchId);
    saveButton.textContent = scoreboard.savedMatchId ? "Partida gordeta" : "Partida hau gorde";
    saveStatus.textContent = scoreboard.savedMatchId ? "Gordeta · partiden historiala freskatuta." : "Oraindik ez da gorde.";
  }
}
function scoreSave() {
  scoreboard.events = scoreboard.events.slice(-100);
  try { localStorage.setItem(scoreStorageKey(), JSON.stringify(scoreboard)); }
  catch (error) { notify("Markagailua ezin izan da gorde gailuan", "error"); }
}
function scoreFormat(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds) || 0));
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}
function scoreRender() {
  $("score-home").textContent = scoreboard.home;
  $("score-away").textContent = scoreboard.away;
  $("score-clock").textContent = scoreFormat(scoreboard.seconds);
  $("score-start").textContent = scoreboard.running ? "Gelditu" : "Hasi";
  var duration = Math.max(1, Number($("score-minutes").value) || 30) * 60;
  var mode = $("score-mode").value;
  $("score-period").textContent = (scoreboard.period % 2 ? "2." : "1.") + " zatia · " + scoreFormat(mode === "match" ? duration : scoreboard.seconds);
  $("score-events").innerHTML = scoreboard.events.length ? scoreboard.events.slice().reverse().map(function (event) {
    var shotLabel = event.type === "gol" ? "Jaurtiketa arrunta · gola" : event.type === "jaurtiketa" ? "Jaurtiketa arrunta · huts" : event.type === "penalti_gol" ? "Penaltia · gola" : event.type === "penalti_jaurtiketa" ? "Penaltia · huts" : "";
    return '<li class="item"><div class="item-main"><strong>' + esc(event.time) + " · " + esc(event.team) + " " + esc(event.score) + "</strong><small>" + esc(event.player || "Goleatzailea zehaztu gabe") + (shotLabel ? " · " + shotLabel : "") + (event.shot_from && event.shot_to ? " · Kantxa " + Math.round(event.shot_from[0] * 100) + "% / " + Math.round(event.shot_from[1] * 100) + "% → atea " + Math.round(event.shot_to[0] * 100) + "% / " + Math.round(event.shot_to[1] * 100) + "%" : "") + "</small></div></li>";
  }).join("") : '<li class="empty">Oraindik ez da gertaerarik erregistratu.</li>';
}
var shotFrom = null, shotTo = null, shotCourtImage = new Image();
shotCourtImage.src = "irudiak/Zelai-erdia.png";
shotCourtImage.onload = function () { drawShotCanvases(); };
function drawShotCanvases() {
  var court = $("shot-court-canvas"), goal = $("shot-goal-canvas");
  if (!court || !goal) return;
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
  $("shot-location-hint").textContent = (shotFrom ? "Kantxako jatorria aukeratuta" : "Aukeratu jatorria kantxan") + " · " + (shotTo ? "Ateko helmuga aukeratuta" : "Aukeratu helmuga atean");
  $("shot-record").disabled = !(shotFrom && shotTo && $("shot-player").value);
}
function drawShotMarker(ctx, point, w, h) {
  var x = point[0] * w, y = point[1] * h;
  ctx.beginPath(); ctx.arc(x, y, Math.max(9, w * .018), 0, Math.PI * 2);
  ctx.fillStyle = "#ed3434"; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.stroke();
}
function bindShotCanvas(id, setter) {
  $(id).addEventListener("pointerdown", function (event) {
    var rect = event.currentTarget.getBoundingClientRect();
    setter([Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))]);
    drawShotCanvases();
  });
}
function scoreAddGoal(side) {
  scoreboard[side] = Math.max(0, scoreboard[side] + 1);
  var name = $(side === "home" ? "score-home-name" : "score-away-name").value.trim() || (side === "home" ? "Etxekoa" : "Kanpokoa");
  var playerSelect = $("score-player");
  var player = playerSelect.value ? playerSelect.options[playerSelect.selectedIndex].text : "";
  scoreboard.events.push({ time: scoreFormat(scoreboard.seconds), seconds: scoreboard.seconds, period: scoreboard.period + 1, side: side, team: name, score: scoreboard.home + "-" + scoreboard.away, player: player, playerId: playerSelect.value ? Number(playerSelect.value) : null, type: "gol" });
  scoreSave(); scoreRender();
}
var friendsCache = { friends: [], incoming: [], outgoing: [] };
var friendExercises = [], friendTrainings = [], friendSharedExercises = [];
function setFriendOptions(id, rows, placeholder) {
  var select = $(id);
  var prior = select.value;
  select.innerHTML = '<option value="">' + esc(placeholder) + '</option>' + rows.map(function (row) {
    return '<option value="' + Number(row.user_id || row.id_ariketa || row.id_saio) + '">' +
      esc(row.username || row.izena || ((row.data_ordua || "Entrenamendua") + " · " + (row.helburu_taktikoa || ""))) + '</option>';
  }).join("");
  if (rows.some(function (row) { return String(row.user_id || row.id_ariketa || row.id_saio) === prior; })) select.value = prior;
}
function renderShareExerciseOptions() {
  var list = $("share-exercise-items");
  if (!list) return;
  list.innerHTML = friendExercises.length ? friendExercises.map(function (exercise) {
    return '<label class="checkrow"><input type="checkbox" data-share-exercise="' + Number(exercise.id_ariketa) + '"><span>' + esc(exercise.izena || "Ariketa") + '</span></label>';
  }).join("") : '<div class="empty">Ez dago partekatzeko ariketarik.</div>';
  updateShareExerciseCount();
}
function selectedShareExerciseIds() {
  return Array.from(document.querySelectorAll('#share-exercise-items [data-share-exercise]:checked'))
    .map(function (input) { return Number(input.dataset.shareExercise); });
}
function updateShareExerciseCount() {
  var count = $("share-exercise-count");
  if (count) count.textContent = selectedShareExerciseIds().length + " hautatuta";
}
async function loadFriends() {
  [$("friend-incoming"), $("friends-list"), $("friend-outgoing"), $("friend-shared-exercises"), $("friend-shared-trainings")].forEach(function (el) { el.innerHTML = '<li class="empty">Kargatzen…</li>'; });
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
    $("friend-incoming").innerHTML = friendsCache.incoming.length ? friendsCache.incoming.map(function (item) {
      return '<li class="item"><div class="item-main"><strong>' + esc(item.username) + '</strong><small>Lagun-eskaera</small></div><button class="btn secondary" data-friend-action="friend_accept" data-id="' + Number(item.id) + '">Onartu</button><button class="btn danger" data-friend-action="friend_reject" data-id="' + Number(item.id) + '">Baztertu</button></li>';
    }).join("") : '<li class="empty">Ez dago sarrerako eskaerarik.</li>';
    $("friends-list").innerHTML = friendsCache.friends.length ? friendsCache.friends.map(function (item) {
      return '<li class="item"><div class="item-main"><strong>' + esc(item.username) + '</strong><small>Lagun</small></div><button class="btn danger" data-friend-action="friend_remove" data-id="' + Number(item.id) + '">Laguna kendu</button></li>';
    }).join("") : '<li class="empty">Onartutako lagunik ez duzu oraindik.</li>';
    $("friend-outgoing").innerHTML = friendsCache.outgoing.length ? '<li class="notice">' + friendsCache.outgoing.map(function (item) { return esc(item.username) + ' — eskaera bidalita'; }).join(" · ") + '</li>' : '';
    $("friend-shared-exercises").innerHTML = sharedExercises.length ? sharedExercises.map(function (item) {
      return '<li class="item"><div class="item-main"><strong>' + esc(item.izena) + '</strong><small>' + esc(item.shared_by_username || "Lagun batek partekatua") + (item.is_saved ? ' · Nire ariketetan gordeta' : '') + '</small></div>' + (item.is_saved ? '' : '<button class="btn secondary" data-save-shared-exercise="' + Number(item.id_ariketa) + '">Nire ariketetara gehitu</button>') + '<button class="btn secondary" data-show-shared-exercise="' + Number(item.id_ariketa) + '">Xehetasunak</button></li>';
    }).join("") : '<li class="empty">Oraindik ez dizute ariketarik partekatu.</li>';
    $("friend-shared-trainings").innerHTML = sharedTrainings.length ? sharedTrainings.map(function (item) {
      var details = (item.details || []).map(function (detail) { return detail.exercise ? (detail.ordena || "") + ". " + detail.exercise.izena + " · " + (detail.iraupena_minutuak || 0) + " min" : detail.taldea || ""; }).filter(Boolean).join("\n");
      return '<li class="item"><div class="item-main"><strong>' + esc(item.helburu_taktikoa || "Entrenamendua") + '</strong><small>' + esc(formatDay(item) + " · " + (item.shared_by_username || "Lagun batek partekatua")) + '</small><small>' + esc(details || "Ez dago ariketa xehetasunik") + '</small></div></li>';
    }).join("") : '<li class="empty">Oraindik ez dizute entrenamendurik partekatu.</li>';
    setFriendOptions("share-exercise-friend", friendsCache.friends, "Aukeratu laguna");
    setFriendOptions("share-training-friend", friendsCache.friends, "Aukeratu laguna");
    setFriendOptions("team-invite-friend", friendsCache.friends, "Aukeratu gonbidatzeko laguna");
    renderShareExerciseOptions();
    setFriendOptions("share-training-item", friendTrainings, "Aukeratu entrenamendua");
  } catch (error) {
    [$("friend-incoming"), $("friends-list")].forEach(function (el) { el.innerHTML = '<li class="notice error">' + esc(error.message) + '</li>'; });
    notify(error.message, "error");
  }
}
$("friend-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  try {
    await request({ action: "friend_add", username: $("friend-username").value.trim().toLowerCase() });
    $("friend-username").value = ""; notify("Lagun-eskaera bidali da", "success"); await loadFriends();
  } catch (error) { notify(error.message, "error"); }
});
$("friends-refresh").addEventListener("click", function () { loadFriends(); });
$("friend-share-exercise").addEventListener("submit", async function (event) {
  event.preventDefault();
  var exerciseIds = selectedShareExerciseIds();
  if (!exerciseIds.length) return notify("Hautatu gutxienez ariketa bat", "error");
  if (exerciseIds.length > 100) return notify("Gehienez 100 ariketa parteka ditzakezu aldi bakoitzean", "error");
  try {
    var result = await request({ action: "exercise_share_many", friend_id: Number($("share-exercise-friend").value), exercise_ids: exerciseIds });
    var shared = Number(result.shared_count) || 0, existing = Number(result.already_shared_count) || 0;
    notify(shared ? shared + " ariketa partekatu dira" + (existing ? "; " + existing + " aurretik partekatuta zeuden" : "") : "Aukeratutako ariketak lagun horrekin partekatuta zeuden jada", "success");
    await loadFriends();
  } catch (error) { notify(error.message, "error"); }
});
$("share-exercise-items").addEventListener("change", updateShareExerciseCount);
$("share-exercise-select-all").addEventListener("click", function () {
  var boxes = Array.from(document.querySelectorAll('#share-exercise-items [data-share-exercise]'));
  boxes.forEach(function (box, index) { box.checked = index < 100; });
  updateShareExerciseCount();
  if (boxes.length > 100) notify("Lehenengo 100 ariketak hautatu dira; partekatu gainerakoak beste bidalketa batean", "error");
});
$("share-exercise-clear").addEventListener("click", function () {
  document.querySelectorAll('#share-exercise-items [data-share-exercise]').forEach(function (box) { box.checked = false; });
  updateShareExerciseCount();
});
$("friend-share-training").addEventListener("submit", async function (event) {
  event.preventDefault();
  try {
    await request({ action: "training_share", friend_id: Number($("share-training-friend").value), training_id: Number($("share-training-item").value) });
    notify("Entrenamendua lagunarekin partekatu da", "success"); await loadFriends();
  } catch (error) { notify(error.message, "error"); }
});
document.addEventListener("click", async function (event) {
  var target = event.target.closest("[data-friend-action], [data-save-shared-exercise], [data-show-shared-exercise]");
  if (!target) return;
  try {
    if (target.dataset.friendAction) {
      await request({ action: target.dataset.friendAction, request_id: Number(target.dataset.id) });
      notify(target.dataset.friendAction === "friend_accept" ? "Lagun-eskaera onartu da" : "Eskaera eguneratu da", "success");
    } else if (target.dataset.saveSharedExercise) {
      await request({ action: "exercise_save", exercise_id: Number(target.dataset.saveSharedExercise) });
      notify("Ariketa zure zerrendara gehitu da", "success");
    } else {
      var exercise = friendSharedExercises.find(function (item) { return Number(item.id_ariketa) === Number(target.dataset.showSharedExercise); });
      if (exercise) alert([exercise.izena, exercise.shared_by_username ? "Nork partekatu du: " + exercise.shared_by_username : "", exercise.deskribapena || "", exercise.jokalari_kopurua ? "Jokalari kopurua: " + exercise.jokalari_kopurua : "", exercise.bideo_url || ""].filter(Boolean).join("\n\n"));
      return;
    }
    await loadFriends();
  } catch (error) { notify(error.message, "error"); }
});
function scoreUpdate() {
  if (!scoreboard.running) return;
  var now = Date.now();
  var elapsed = Math.floor((now - scoreboard.lastTick) / 1000);
  if (elapsed > 0) {
    scoreboard.seconds += $("score-mode").value === "countdown" ? -elapsed : elapsed;
    scoreboard.seconds = Math.max(0, scoreboard.seconds);
    scoreboard.lastTick += elapsed * 1000;
    if ($("score-mode").value === "countdown" && scoreboard.seconds === 0) {
      scoreboard.running = false; clearInterval(scoreTimer); notify("Denbora amaitu da", "success");
    }
    scoreSave(); scoreRender();
  }
}
$("score-player").innerHTML += players.map(function (player) {
  return '<option value="' + Number(player.id_jokalaria) + '">' + esc(playerName(player)) + "</option>";
}).join("");
bindShotCanvas("shot-court-canvas", function (point) { shotFrom = point; });
bindShotCanvas("shot-goal-canvas", function (point) { shotTo = point; });
$("shot-player").addEventListener("change", drawShotCanvases);
$("shot-record").addEventListener("click", function () {
  if (!shotFrom || !shotTo || !$("shot-player").value) return;
  var side = $("shot-team").value, name = $(side === "home" ? "score-home-name" : "score-away-name").value.trim() || (side === "home" ? "Etxekoa" : "Kanpokoa");
  var playerSelect = $("shot-player"), player = playerSelect.options[playerSelect.selectedIndex].text;
  var result = $("shot-result").value;
  var isGoal = result === "gol" || result === "penalti_gol";
  if (isGoal) scoreboard[side] = Math.max(0, scoreboard[side] + 1);
  scoreboard.events.push({ time: scoreFormat(scoreboard.seconds), seconds: scoreboard.seconds, team: name, score: scoreboard.home + "-" + scoreboard.away, player: player, side: side, type: result, playerId: Number(playerSelect.value), shot_from: shotFrom, shot_to: shotTo, period: scoreboard.period + 1 });
  shotFrom = null; shotTo = null; scoreSave(); scoreRender(); drawShotCanvases();
  notify(isGoal ? "Gola eta kokapenak erregistratu dira" : "Jaurtiketa eta kokapenak erregistratu dira", "success");
});
drawShotCanvases();
scoreRead(); scoreRender();
if (!$("score-save-date").value) $("score-save-date").value = localDateTime();
document.querySelectorAll("[data-score]").forEach(function (button) {
  button.addEventListener("click", function () {
    var side = button.dataset.score, delta = Number(button.dataset.delta);
    scoreboard[side] = Math.max(0, scoreboard[side] + delta); scoreSave(); scoreRender();
  });
});
$("score-goal-home").addEventListener("click", function () { scoreAddGoal("home"); });
$("score-goal-away").addEventListener("click", function () { scoreAddGoal("away"); });
$("score-start").addEventListener("click", function () {
  if (scoreboard.running) { scoreboard.running = false; clearInterval(scoreTimer); }
  else {
    if (!scoreboard.seconds) scoreboard.seconds = $("score-mode").value === "countdown" ? Math.max(1, Number($("score-minutes").value) || 30) * 60 : 0;
    scoreboard.running = true; scoreboard.lastTick = Date.now(); clearInterval(scoreTimer); scoreTimer = setInterval(scoreUpdate, 250);
  }
  scoreSave(); scoreRender();
});
$("score-period-next").addEventListener("click", function () {
  scoreboard.running = false; clearInterval(scoreTimer); scoreboard.period += 1;
  scoreboard.seconds = $("score-mode").value === "countdown" ? Math.max(1, Number($("score-minutes").value) || 30) * 60 : 0;
  scoreSave(); scoreRender();
});
$("score-reset").addEventListener("click", function () {
  scoreboard.running = false; clearInterval(scoreTimer); scoreboard = { home: 0, away: 0, seconds: 0, period: 0, running: false, events: [], lastTick: 0, savedMatchId: null };
  scoreSave(); scoreRender(); $("score-save-match").disabled = false; $("score-save-match").textContent = "Partida hau gorde"; $("score-save-status").textContent = "Oraindik ez da gorde.";
});
$("score-clear-events").addEventListener("click", function () { scoreboard.events = []; scoreSave(); scoreRender(); });
$("score-mode").addEventListener("change", function () { scoreboard.running = false; clearInterval(scoreTimer); scoreboard.seconds = 0; scoreSave(); scoreRender(); });
$("score-minutes").addEventListener("change", scoreRender);
$("score-home-name").addEventListener("change", scoreSave);
$("score-away-name").addEventListener("change", scoreSave);
$("score-fullscreen").addEventListener("click", async function () {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("v-scoreboard").requestFullscreen();
    $("score-fullscreen").textContent = document.fullscreenElement ? "Pantaila osotik irten" : "Pantaila osoa";
  } catch (error) { notify("Pantaila osoa ezin izan da aktibatu gailu honetan", "error"); }
});

function setMobileMenu(open) {
  var nav = $("nav"), toggle = $("mobile-menu-toggle"), backdrop = $("mobile-menu-backdrop");
  if (!nav || !toggle || !backdrop) return;
  var mobile = window.matchMedia("(max-width: 767px)").matches;
  var isOpen = Boolean(open && mobile && !nav.classList.contains("hidden"));
  nav.classList.toggle("menu-open", isOpen);
  backdrop.classList.toggle("hidden", !isOpen);
  document.body.classList.toggle("mobile-menu-active", isOpen);
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.setAttribute("aria-label", isOpen ? "Menua itxi" : "Menua ireki");
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
    if (!result.token || !result.user) throw new Error("Supabasek ez du saio baliodunik itzuli");
    token = result.token; user = result.user;
    saveLocal("7metro-supabase-token", token);
    saveLocal("7metro-username", user.izena);
    $("password").value = "";
    notify("Online kontura konektatuta", "success");
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
    if (!result.token || !result.user) throw new Error("Kontua sortu da, baina ezin izan da saioa hasi");
    token = result.token;
    user = result.user;
    saveLocal("7metro-supabase-token", token);
    saveLocal("7metro-username", user.izena);
    $("password").value = "";
    $("new-password").value = "";
    $("account-create-dialog").close();
    notify("Kontua sortu da eta saioa hasi duzu", "success");
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
  if (!selected || selected._role !== "owner") return notify("Taldearen jabeak bakarrik alda dezake izena", "error");
  $("team-rename-name").value = selected.izena || "";
  $("team-rename-dialog").showModal();
});
$("team-rename-close").addEventListener("click", function () { $("team-rename-dialog").close(); });
$("team-rename-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var selected = selectedTeamForManagement(), name = $("team-rename-name").value.trim();
  if (!selected || selected._role !== "owner") return notify("Taldearen jabeak bakarrik alda dezake izena", "error");
  if (name.length < 2 || name.length > 100) return notify("Izenak 2 eta 100 karaktere artean izan behar ditu", "error");
  var button = this.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    var result = await request({ action: "team_rename", team_id: Number(selected.id_taldea), name: name });
    var updated = result.team || Object.assign({}, selected, { izena: name });
    teams = teams.map(function (item) { return Number(item.id_taldea) === Number(updated.id_taldea) ? Object.assign({}, updated, { _role: "owner" }) : item; });
    var selectedId = String(updated.id_taldea);
    $("team-select").innerHTML = teams.map(function (item) {
      return '<option value="' + Number(item.id_taldea) + '">' + esc(item.izena) + (item._role === "owner" ? " · Jabea" : " · Kidea") + "</option>";
    }).join("");
    $("team-select").value = selectedId;
    if (Number(teamId) === Number(updated.id_taldea)) {
      team = updated;
      $("account").textContent = (user ? user.izena + " · " : "") + updated.izena;
    }
    $("team-rename-dialog").close();
    notify("Taldearen izena aldatu da", "success");
  } catch (error) { notify(error.message, "error"); }
  finally { button.disabled = false; }
});
$("delete-team").addEventListener("click", async function () {
  var selected = selectedTeamForManagement();
  if (!selected || selected._role !== "owner") return notify("Taldearen jabeak bakarrik ezaba dezake taldea", "error");
  var confirmation = "Ziur zaude '" + selected.izena + "' taldea ezabatu nahi duzula? Ekintza honek taldeko jokalariak, entrenamenduak, partidak eta plangintza ere ezabatuko ditu.";
  if (!window.confirm(confirmation)) return;
  var button = this;
  button.disabled = true;
  try {
    await request({ action: "team_delete", team_id: Number(selected.id_taldea) });
    if (Number(teamId) === Number(selected.id_taldea)) {
      team = null; teamId = 0; localStorage.removeItem("7metro-team-id");
    }
    await loadTeams(false);
    notify("Taldea eta haren datuak ezabatu dira", "success");
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
    notify("Taldea sortu da", "success");
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
    form.reset(); await refreshAll(); notify("Jokalaria gehitu da", "success");
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
    resetBoard(); await refreshAll(); notify("Ariketa gehitu da", "success");
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
    notify('"' + name + '" kategoria sortu da', "success");
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
  if (!boardSelection) return notify("Aukeratu ezabatu nahi duzun elementua", "error");
  if (boardSelection.kind === "token") delete boardState.posizioak[boardSelection.tag];
  else boardState.marrazkiak.splice(boardSelection.index, 1);
  boardSelection = null;
  redrawBoard();
});
$("board-clear").addEventListener("click", function () {
  if (!Object.keys(boardState.posizioak).length && !boardState.marrazkiak.length && !boardState.animazioa.length) return;
  if (!confirm("Arbel guztia garbitu nahi duzu?")) return;
  resetBoard();
});
$("board-frame-add").addEventListener("click", function () {
  stopBoardAnimation();
  boardState.animazioa.push(captureBoardFrame());
  boardFrameIndex = boardState.animazioa.length - 1;
  document.querySelector('[data-board-tool="move"]').click();
  updateBoardAnimationControls();
  notify((boardFrameIndex + 1) + ". pausoa gehitu da. Mugitu elementuak hurrengo pausorako.", "success");
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
  notify("Pausoa eguneratu da", "success");
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
      ? "Makrozikloa gorde da" : "Mikrozikloa gorde da";
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
    if (!confirm(isMacro ? "Makrozikloa ezabatu nahi duzu?" : "Mikrozikloa ezabatu nahi duzu?")) return;
    remove.disabled = true;
    try {
      await deletePlanRecord();
      closePlanForm();
      await refreshAll();
      notify("Erregistroa ezabatu da", "success");
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
    await refreshAll(); notify("Entrenamendua gorde da", "success");
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
    return notify("Golak 0 eta 999 arteko zenbaki osoak izan behar dira", "error");
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
    await refreshAll(); notify("Partida gorde da", "success");
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
    return notify("Emaitza 0 eta 999 arteko zenbaki osoz osatu behar da", "error");
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
    notify("Partidaren emaitza eta estatistikak eguneratu dira", "success");
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
  if (scoreboard.savedMatchId) return notify("Markagailu hau gordeta dago. Berrabiarazi beste partida bat gordetzeko.", "error");
  if (!token || !teamId) return notify("Hasi saioa eta aukeratu taldea partida gordetzeko", "error");
  var opponent = $("score-away-name").value.trim();
  var date = $("score-save-date").value;
  if (!date || !opponent) {
    $("score-save-status").textContent = "Errorea: bete data eta aurkariaren izena.";
    return notify("Data eta aurkariaren izena bete behar dira", "error");
  }
  var homeName = $("score-home-name").value.trim() || "7metro";
  var statsByPlayer = {};
  scoreboard.events.forEach(function (entry) {
    var side = entry.side || (entry.team === homeName ? "home" : "away");
    var playerId = Number(entry.playerId) || 0;
    if (side !== "home" || !playerId) return;
    var row = statsByPlayer[playerId] || (statsByPlayer[playerId] = { id_jokalaria: playerId, golak: 0, jaurtiketak: 0 });
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
  button.disabled = true; button.textContent = "Gordetzen…";
  var result;
  try {
    result = await request({
      action: "pwa_create_match", team_id: teamId, data_ordua: date, aurkaria: opponent,
      lekua: $("score-save-venue").value, emaitza_geurea: scoreboard.home,
      emaitza_aurkaria: scoreboard.away, stats: Object.keys(statsByPlayer).map(function (id) { return statsByPlayer[id]; }),
      shots: savedShots
    });
  } catch (error) {
    $("score-save-status").textContent = "Errorea: " + error.message;
    notify(error.message, "error");
    button.disabled = false; button.textContent = "Partida hau gorde";
    return;
  }
  scoreboard.savedMatchId = Number(result.id) || true;
  scoreSave();
  $("score-save-status").textContent = "Gordeta · " + opponent + " · " + scoreboard.home + "–" + scoreboard.away;
  button.textContent = "Partida gordeta";
  notify("Partida markagailutik gorde da", "success");
  try { await refreshAll(); }
  catch (error) { notify("Partida gordeta dago, baina historiala ezin izan da freskatu: " + error.message, "error"); }
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
  if (!sessionId) return notify("Aukeratu entrenamendua lehenik", "error");
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
    await refreshAll(); renderAttendance(sessionId); $("attendance-dialog").close(); notify("Asistentzia gorde da", "success");
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
        notify("Taldean sartu zara", "success");
        await loadTeams(false);
      } else {
        notify("Gonbidapena baztertu da", "success");
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
    try { await refreshAll(); notify("Datuak eguneratu dira", "success"); }
    catch (error) { notify(error.message, "error"); }
    finally { target.disabled = false; }
  }
  var deletion = null, message = "", successMessage = "Erregistroa ezabatu da";
  if (target.hasAttribute("data-delete-player")) {
    deletion = { action: "pwa_delete_player", id: Number(target.dataset.deletePlayer) };
    message = "Jokalari hau ezabatu nahi duzu?";
  } else if (target.hasAttribute("data-delete-exercise")) {
    deletion = { action: "pwa_delete_exercise", id: Number(target.dataset.deleteExercise) };
    message = "Ariketa hau ezabatu nahi duzu?";
  } else if (target.hasAttribute("data-delete-exercise-category")) {
    deletion = { action: "pwa_delete_category", izena: target.dataset.deleteExerciseCategory };
    message = '"' + target.dataset.deleteExerciseCategory + '" izeneko kategoria-erregistro guztiak ezabatu? Kategoria hori ariketetatik kenduko da; beste kategoriak mantenduko dira.';
    successMessage = "Kategoria ezabatu da";
  } else if (target.hasAttribute("data-delete-match")) {
    deletion = { action: "pwa_delete_match", id: Number(target.dataset.deleteMatch) };
    message = "Partida hau eta haren estatistikak ezabatu nahi dituzu?";
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
    var matchId = Number(target.dataset.matchStats);
    var selected = matches.find(function (match) { return Number(match.id_partida) === matchId; });
    if (!selected) {
      $("match-detail").classList.add("hidden");
      notify("Ezin izan da partida aurkitu. Freskatu zerrenda.", "error");
      return;
    }
    selectSection("v-stats");
    // Historiako botoiak analisi osoa partida horretara bideratzen du.
    $("stats-match").value = String(matchId);
    $("stats-mode").value = "players";
    $("stats-period").value = "all";
    $("stats-venue").value = "all";
    $("stats-opponent").value = "";
    $("stats-start").value = "";
    $("stats-end").value = "";
    $("stats-search").value = "";
    renderStats();
  }
  if (target.hasAttribute("data-close-match-stats")) {
    $("match-detail").classList.add("hidden");
  }
  if (target.hasAttribute("data-view-cup")) {
    var cupId = Number(target.dataset.viewCup);
    var cup = records("txapelketak").find(function (item) { return Number(item.id_txapelketa) === cupId; });
    if (!cup) { notify("Ezin izan da txapelketa aurkitu. Freskatu egutegia.", "error"); return; }
    $("calendar-cup-title").textContent = cup.izena || "Txapelketa";
    $("calendar-cup-meta").textContent = [formatDate(cup), cup.kategoria, cup.lekua].filter(Boolean).join(" · ");
    $("calendar-cup-modal").classList.remove("hidden");
  }
  if (target.hasAttribute("data-close-calendar-cup")) $("calendar-cup-modal").classList.add("hidden");
  if (target.hasAttribute("data-view-session")) {
    if (renderSavedSession(target.dataset.viewSession)) selectSection("v-session-detail");
    else notify("Ezin izan da entrenamendua aurkitu. Freskatu zerrenda.", "error");
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
  if (!friend) return notify("Aukeratu gonbidatzeko lagun bat", "error");
  try {
    await request({ action: "team_invite", team_id: teamId, username: String(friend.username || "").trim().toLowerCase() });
    $("team-invite-friend").value = "";
    notify("Taldeko gonbidapena bidali da", "success");
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
  else notify("Online saioa itxi da", "success");
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
$("install-status").textContent = standalone ? "Instalatuta erabiltzen ari zara" : "Arakatzailetik erabiltzen ari zara";
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function (error) {
      console.error("Service worker-a ezin izan da erregistratu", error);
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
