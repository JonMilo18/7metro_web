"use strict";

(function () {
  var forced = "", memory = {};
  function context() {
    var player = document.body.classList.contains("player-mode");
    var id = user && (user.id_erabiltzailea || user.izena);
    return { player: player, key: "7metro-guide:" + id + ":" + (player ? "player" : "coach:" + teamId) };
  }
  function read(key) {
    if (memory[key]) return memory[key];
    try {
      var value = JSON.parse(localStorage.getItem(key) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }
    catch (error) { return {}; }
  }
  function save(key, state) {
    memory[key] = state;
    try { localStorage.setItem(key, JSON.stringify(state)); } catch (error) { /* The guide also works without persistence. */ }
  }
  function steps(info, state) {
    if (info.player && !portalState.playerId) return [
      { id: "link", title: "Lotu zure jokalari-fitxa", text: "Eskatu entrenatzaileari gonbidapena eta onartu hemen.", button: "Ikusi gonbidapenak", done: false }
    ];
    if (info.player) return [
      { id: "agenda", title: "Begiratu egutegia", text: "Aukeratu egun bat entrenamenduak eta partidak ikusteko.", button: "Ireki egutegia", done: Boolean(state.agenda) },
      { id: "callups", title: "Erantzun deialdiari", text: "Deialdia jasotzean, adierazi joango zaren ala ez.", button: "Ikusi deialdiak", done: Boolean(portalState.data && portalState.data.responses.length) },
      { id: "settings", title: "Prestatu zure kontua", text: "Aukeratu hizkuntza, itxura eta jakinarazpenak.", button: "Ireki kontua", done: Boolean(state.settings) }
    ];
    return [
      { id: "players", title: "Gehitu jokalariak", text: "Osatu taldeko jokalarien izenak eta dortsalak.", button: "Ireki taldea", done: players.length > 0 },
      { id: "exercise", title: "Prestatu ariketa bat", text: "Marraztu arbelean eta gorde zure liburutegian.", button: "Sortu ariketa", done: exercises.length > 0 },
      { id: "training", title: "Sortu lehen entrenamendua", text: "Aukeratu data eta gehitu prestatutako ariketak.", button: "Sortu entrenamendua", done: sessions.length > 0 }
    ];
  }
  function render() {
    var coachHost = document.getElementById("coach-onboarding"), playerHost = document.getElementById("player-onboarding");
    if (!coachHost || !token || !user) return;
    var info = context(), host = info.player ? playerHost : coachHost;
    coachHost.hidden = true;
    if (playerHost) playerHost.hidden = true;
    if (!host && info.player && !portalState.playerId) {
      host = document.createElement("div"); host.id = "player-onboarding"; host.className = "onboarding";
      $("portal-no-link").appendChild(host);
    }
    if (!host) return;
    var state = read(info.key), items = steps(info, state), completed = items.filter(function (item) { return item.done; }).length;
    if (completed === items.length && forced !== info.key) { state.finished = true; save(info.key, state); }
    if ((state.dismissed || state.finished) && forced !== info.key) return;
    host.hidden = false;
    host.innerHTML = '<div class="onboarding-head"><div><h2>' + esc(t("Lehen urratsak")) + '</h2><small>' + esc(t("{done}/{total} osatuta", { done: completed, total: items.length })) + '</small></div><button class="btn secondary" type="button" data-guide-dismiss>' +
      esc(t(completed === items.length ? "Amaitu" : "Geroago")) + '</button></div><ol class="onboarding-steps">' + items.map(function (item) {
      return '<li><strong' + (item.done ? ' class="guide-done"' : '') + '>' + esc(t(item.title)) + '</strong><p>' + esc(t(item.text)) + '</p><button class="btn secondary" type="button" data-guide-step="' + item.id + '"' +
        (item.done ? ' disabled' : '') + '>' + esc(t(item.done ? "Eginda" : item.button)) + '</button></li>';
    }).join("") + '</ol>';
  }
  function visit(tab) {
    if (!token || !user || !document.body.classList.contains("player-mode")) return;
    if (!["agenda", "settings"].includes(tab)) return;
    var info = context(), state = read(info.key);
    state[tab] = true; save(info.key, state);
  }
  window.AppGuide = { render: render, visit: visit };
  document.addEventListener("click", function (event) {
    var action = event.target.closest("[data-guide-step],[data-guide-dismiss],[data-guide-reopen]");
    if (!action || !token || !user) return;
    var info = context();
    if (action.hasAttribute("data-guide-dismiss")) {
      var state = read(info.key); state.dismissed = true; save(info.key, state); forced = ""; render(); return;
    }
    if (action.hasAttribute("data-guide-reopen")) {
      forced = info.key;
      if (info.player) portalSetTab("home"); else selectSection("v-home");
      render(); window.scrollTo(0, 0); return;
    }
    var step = action.dataset.guideStep;
    if (info.player) {
      if (step === "link") { $("portal-invites").scrollIntoView({ block: "start" }); return; }
      if (step === "agenda") { portalCalendarState.view = "calendar"; portalRenderAgenda(); }
      visit(step); portalSetTab(step);
    } else if (step === "players") selectSection("v-players");
    else if (step === "exercise") selectSection("v-board");
    else if (step === "training") $("session-create").click();
    window.scrollTo(0, 0);
  });
  window.addEventListener("languagechange", render);
})();
