"use strict";

(function () {
  var database, syncing = false, activeWrites = 0, unavailable = false, storageError = false, renderSequence = 0;
  var draftLoadedFor = "", recoveredDraft = null, restoring = false, lastDraft = "";
  var writes = ["pwa_create_session", "pwa_update_session", "pwa_duplicate_session", "pwa_create_match"];
  var reads = ["teams_list", "team_snapshot", "portal_bootstrap", "portal_player_snapshot", "pwa_get_session"];

  function owner() { return Number(user && user.id_erabiltzailea) || 0; }
  function disconnected() { return !navigator.onLine || unavailable; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function openDatabase() {
    if (!database) database = new Promise(function (resolve, reject) {
      var opening = indexedDB.open("7metro-offline", 1);
      opening.onupgradeneeded = function () {
        var store = opening.result.createObjectStore("work", { keyPath: "key" });
        store.createIndex("owner-type", ["owner", "type"]);
      };
      opening.onerror = function () { reject(opening.error); };
      opening.onsuccess = function () { resolve(opening.result); };
    });
    return database;
  }
  async function transaction(mode, action) {
    try {
      var db = await openDatabase();
      return await new Promise(function (resolve, reject) {
        var tx = db.transaction("work", mode), result;
        var command = action(tx.objectStore("work"));
        if (command) command.onsuccess = function () { result = command.result; };
        tx.oncomplete = function () { resolve(result); };
        tx.onerror = tx.onabort = function () { reject(tx.error); };
      });
    } catch (error) {
      if (!storageError) { storageError = true; renderStatus(); }
      throw error;
    }
  }
  function get(key) { return transaction("readonly", function (store) { return store.get(key); }); }
  function put(record) { return transaction("readwrite", function (store) { return store.put(record); }); }
  function remove(key) { return transaction("readwrite", function (store) { return store.delete(key); }); }
  function all() { return transaction("readonly", function (store) { return store.getAll(); }); }
  function pending(id) { return transaction("readonly", function (store) { return store.index("owner-type").getAll(IDBKeyRange.only([id, "pending"])); }); }
  async function withNetworkTimeout(send) {
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 20000);
    try { return await send(controller.signal); }
    finally { clearTimeout(timer); }
  }
  async function authKey(value) {
    var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return "auth:" + Array.from(new Uint8Array(digest)).map(function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
  }
  async function rememberIdentity(value, profile) {
    if (!value || !profile || !profile.id_erabiltzailea) return;
    await put({ key: await authKey(value), owner: Number(profile.id_erabiltzailea), profile: clone(profile) });
  }
  async function prepare() {
    if (!token) return;
    try {
      var record = await get(await authKey(token));
      if (record && record.profile && record.profile.izena === userName) user = record.profile;
      else if (navigator.onLine) {
        var sessionToken = token;
        var account = await withNetworkTimeout(function (signal) { return requestImpl({ action: "account_get" }, false, signal); });
        if (token === sessionToken && account.user) {
          user = account.user; userName = user.izena;
          saveLocal("7metro-username", userName);
          await rememberIdentity(token, user);
        }
      }
    } catch (error) { /* Online login remains available if device storage is unavailable. */ }
  }
  function readKey(payload, id) { return "cache:" + id + ":" + JSON.stringify(payload); }

  async function perform(payload, anonymous, send) {
    var id = owner(), sessionToken = token;
    if (!anonymous && id && writes.includes(payload.action)) {
      var body = clone(payload), entries;
      try { entries = await pending(id); }
      catch (error) {
        if (navigator.onLine) return send();
        throw new Error(t("Ezin da gailuan gorde. Ez itxi aplikazioa aldaketak zerbitzarian gorde arte."));
      }
      var existing = entries.find(function (entry) {
        if (entry.type !== "pending" || entry.owner !== id) return false;
        if (payload.operation_id) return entry.payload.operation_id === payload.operation_id;
        var previous = clone(entry.payload); delete previous.operation_id;
        return JSON.stringify(previous) === JSON.stringify(payload);
      });
      body.operation_id = payload.operation_id || (existing ? existing.payload.operation_id : crypto.randomUUID());
      var job = existing || { key: "pending:" + id + ":" + body.operation_id, type: "pending", owner: id,
        payload: body, teamName: team && team.izena || "", created: Date.now(), error: "", blocked: false };
      if (!existing && payload.action === "pwa_create_match" && scoreSaving) job.board = clone(scoreboard);
      try { await put(job); }
      catch (error) {
        if (navigator.onLine) return withNetworkTimeout(function (signal) { return requestImpl(body, false, signal); });
        throw new Error(t("Ezin da gailuan gorde. Ez itxi aplikazioa aldaketak zerbitzarian gorde arte."));
      }
      if (job.board && scoreSaving) { scoreboard.pendingOperationId = body.operation_id; scoreSave(); }
      activeWrites++;
      try {
        if (!navigator.onLine) return { queued: true, operation_id: body.operation_id };
        var result = await withNetworkTimeout(function (signal) { return requestImpl(body, false, signal); });
        unavailable = false;
        await completeJob(job, result);
        return result;
      } catch (error) {
        if (error.network || error.status >= 500) {
          unavailable = true;
          return { queued: true, operation_id: body.operation_id };
        }
        await remove(job.key);
        unlockScore(job);
        throw error;
      } finally { activeWrites--; renderStatus(); }
    }
    try {
      var response = !anonymous && reads.includes(payload.action) ? await withNetworkTimeout(send) : await send();
      if (response.token && response.user) await rememberIdentity(response.token, response.user).catch(function () {});
      if (id && !anonymous && reads.includes(payload.action) && token === sessionToken) {
        await put({ key: readKey(payload, id), owner: id, type: "cache", value: response, updated: Date.now() }).catch(function () {});
      }
      if (!anonymous) unavailable = false;
      renderStatus();
      return response;
    } catch (error) {
      if ((error.network || error.status >= 500) && id && !anonymous && reads.includes(payload.action)) {
        unavailable = true;
        var saved = await get(readKey(payload, id));
        renderStatus();
        if (saved) return Object.assign({}, saved.value, { offline_cached: true });
      }
      throw error;
    }
  }

  function draftKey(id, selectedTeam) { return "draft:" + id + ":" + selectedTeam; }
  function draftValue() {
    return { editor: clone(sessionEditor), selection: clone(sessionSelection), fields: {
      date: $("session-date").value, place: $("session-place").value, goal: $("session-goal").value,
      micro: $("session-micro").value, minutes: $("session-total-minutes").value
    } };
  }
  async function saveDraftNow(force) {
    if (!token || !owner() || !teamId || restoring || (sessionEditorBusy && force !== true) || !sessionCleanDraft ||
        sessionDraftValue() === sessionCleanDraft) return;
    var value = draftValue(), encoded = JSON.stringify(value);
    if (encoded === lastDraft) return;
    lastDraft = encoded;
    try { await put({ key: draftKey(owner(), teamId), type: "draft", owner: owner(), teamId: teamId, value: value, updated: Date.now() }); }
    catch (error) { lastDraft = ""; }
  }
  async function clearDraft() {
    if (!owner() || !teamId) return;
    lastDraft = ""; recoveredDraft = null;
    $("session-draft-recovery").hidden = true;
    await remove(draftKey(owner(), teamId)).catch(function () {});
  }
  function applyDraft(value) {
    restoring = true;
    resetSessionEditor();
    sessionEditor = clone(value.editor); sessionSelection = clone(value.selection);
    $("session-date").value = value.fields.date; $("session-place").value = value.fields.place;
    $("session-goal").value = value.fields.goal; $("session-micro").value = value.fields.micro;
    $("session-total-minutes").value = value.fields.minutes;
    renderSessionPicker(); renderSessionEditor();
    restoring = false;
    showSessionEditor();
  }
  async function teamOpened() {
    var key = draftKey(owner(), teamId);
    if (token && owner() && draftLoadedFor !== key) {
      draftLoadedFor = key; lastDraft = "";
      recoveredDraft = await get(key).catch(function () { return null; });
      $("session-draft-recovery").hidden = !recoveredDraft;
    }
    renderStatus();
    if (!disconnected()) sync();
  }

  async function completeJob(job, result) {
    if (job.payload.action === "pwa_create_match") {
      var scoreKey = "7metro-scoreboard-" + job.owner + "-" + job.payload.team_id;
      var saved = JSON.parse(localStorage.getItem(scoreKey) || "null");
      if (saved && saved.pendingOperationId === job.payload.operation_id) {
        saved.savedMatchId = Number(result.id); delete saved.pendingOperationId;
        localStorage.setItem(scoreKey, JSON.stringify(saved));
        if (owner() === job.owner && Number(teamId) === Number(job.payload.team_id) && scoreboard.pendingOperationId === job.payload.operation_id) {
          scoreboard.savedMatchId = Number(result.id); delete scoreboard.pendingOperationId;
          scoreSave(); scoreRender();
          $("score-save-status").textContent = t("Partida sinkronizatu da");
        }
      }
    }
    await remove(job.key);
  }
  function unlockScore(job) {
    var key = "7metro-scoreboard-" + job.owner + "-" + job.payload.team_id;
    var saved = JSON.parse(localStorage.getItem(key) || "null");
    if (saved && saved.pendingOperationId === job.payload.operation_id) {
      delete saved.pendingOperationId; localStorage.setItem(key, JSON.stringify(saved));
    }
    if (owner() === job.owner && Number(teamId) === Number(job.payload.team_id) && scoreboard.pendingOperationId === job.payload.operation_id) {
      delete scoreboard.pendingOperationId; scoreSave(); scoreRender();
    }
  }
  async function drain() {
    if (syncing || activeWrites || !navigator.onLine || !token || !owner()) return;
    syncing = true;
    var id = owner(), sessionToken = token, completed = 0;
    try {
      var jobs = (await pending(id)).filter(function (record) { return !record.blocked; })
        .sort(function (a, b) { return a.created - b.created; });
      for (var job of jobs) {
        if (token !== sessionToken || owner() !== id || !navigator.onLine) break;
        try {
          var result = await withNetworkTimeout(function (signal) { return requestImpl(job.payload, false, signal); });
          unavailable = false;
          await completeJob(job, result); completed++;
        } catch (error) {
          if (error.network || error.status >= 500) { unavailable = true; break; }
          if (error.status === 401) break;
          job.error = error.message; job.blocked = true; await put(job);
        }
      }
      if (completed && token === sessionToken && owner() === id) {
        notify(t("Gordetzeko zain zeuden datuak sinkronizatu dira"), "success");
        if (teamId && !document.body.classList.contains("player-mode")) await refreshAll();
      }
    } catch (error) { /* Pending rows are retained when a refresh or device storage fails. */ }
    finally { syncing = false; renderStatus(); }
  }
  function sync() {
    if (navigator.locks) return navigator.locks.request("7metro-offline-sync", { ifAvailable: true }, function (lock) { if (lock) return drain(); });
    return drain();
  }
  async function renderStatus() {
    var sequence = ++renderSequence, id = owner(), sessionToken = token;
    var banner = document.getElementById("offline-status");
    if (!banner) return;
    if (!token || document.getElementById("v-login").classList.contains("on")) { banner.hidden = true; return; }
    var jobs = [];
    if (owner()) jobs = await pending(owner()).catch(function () { return []; });
    if (sequence !== renderSequence || token !== sessionToken || owner() !== id) return;
    banner.hidden = !disconnected() && !jobs.length && !storageError;
    $("offline-status-text").textContent = storageError ? t("Ezin da gailuan gorde. Ez itxi aplikazioa aldaketak zerbitzarian gorde arte.") :
      disconnected() ? t("Konexiorik gabe. Gailuan gordetzen ari da.") : t("Gordetzeak sinkronizatzeko zain");
    $("offline-pending-open").hidden = !jobs.length;
    $("offline-pending-open").textContent = t("Gordetzeko zain: {count}", { count: jobs.length });
    if ($("offline-pending-dialog").open) renderJobs(jobs);
  }
  function renderJobs(jobs) {
    $("offline-pending-list").innerHTML = jobs.length ? jobs.map(function (job) {
      return '<li class="offline-job"><strong>' + esc(t(job.payload.action === "pwa_create_match" ? "Partida" : "Entrenamendua")) + '</strong><span>' + esc(job.teamName) + '</span><p>' + esc(job.error || t("Konexioa itzultzean automatikoki bidaliko da")) + '</p>' +
        (job.blocked ? '<button class="btn secondary" type="button" data-offline-review="' + esc(job.key) + '">' + esc(t("Berrikusi")) + '</button>' : '') +
        '<button class="btn danger" type="button" data-offline-cancel="' + esc(job.key) + '">' + esc(t("Bidalketa bertan behera utzi")) + '</button></li>';
    }).join("") : '<li>' + esc(t("Dena sinkronizatuta dago")) + '</li>';
  }
  async function review(job) {
    var payload = job.payload;
    if (payload.action === "pwa_create_match") {
      if (Number(teamId) !== Number(payload.team_id)) await openTeam(payload.team_id);
      if (job.board) {
        if (!confirm(t("Gordetzeko zain dagoen markagailua berreskuratu nahi duzu?"))) return;
        scoreboard = clone(job.board); scoreboard.running = false; clearInterval(scoreTimer);
        delete scoreboard.pendingOperationId;
        $("score-away-name").value = payload.aurkaria; $("score-save-date").value = payload.data_ordua;
        $("score-save-venue").value = payload.lekua; scoreSave(); scoreRender();
        $("offline-pending-dialog").close(); selectSection("v-scoreboard");
      } else {
        $("match-date").value = payload.data_ordua; $("match-opponent").value = payload.aurkaria;
        $("match-place").value = payload.lekua; $("match-score-home").value = payload.emaitza_geurea;
        $("match-score-away").value = payload.emaitza_aurkaria;
        var selectedPlayers = new Set((payload.stats || []).map(function (row) { return Number(row.id_jokalaria); }));
        $("match-players").querySelectorAll("[data-match-played]").forEach(function (checkbox) {
          checkbox.checked = selectedPlayers.has(Number(checkbox.dataset.matchPlayed));
        });
        (payload.stats || []).forEach(function (row) {
          Object.keys(row).forEach(function (field) {
            var input = $("match-form").querySelector('[data-player="' + Number(row.id_jokalaria) + '"][data-stat="' + field + '"]');
            if (input) input.value = row[field];
          });
        });
        updateMatchPlayerSelection();
        $("offline-pending-dialog").close(); selectSection("v-matches"); $("match-create").click();
      }
    } else {
      if (!canReplaceSessionDraft()) return;
      if (Number(teamId) !== Number(payload.team_id)) await openTeam(payload.team_id);
      var group = null;
      var selection = payload.exercises.map(function (entry, index) {
        if (entry.is_separator) group = "offline-" + index;
        return Object.assign({}, entry, { entryKey: -(index + 1), group_id: group });
      });
      applyDraft({ editor: { mode: payload.action === "pwa_update_session" ? "edit" : payload.action === "pwa_duplicate_session" ? "duplicate" : "create",
        source: payload.id ? { id_saio: payload.id } : null, snapshot: payload.snapshot || null }, selection: selection,
        fields: { date: payload.data_ordua, place: payload.lekua, goal: payload.helburu_taktikoa || "", micro: payload.id_mikroziklo || "", minutes: 90 } });
      $("offline-pending-dialog").close();
      await saveDraftNow();
    }
    await remove(job.key); renderStatus();
  }
  async function forgetSession() {
    if (token) await remove(await authKey(token)).catch(function () {});
    draftLoadedFor = ""; recoveredDraft = null; lastDraft = "";
    $("session-draft-recovery").hidden = true;
    $("offline-status").hidden = true;
    if ($("offline-pending-dialog").open) $("offline-pending-dialog").close();
  }
  async function deleteAccount() {
    var id = owner(), entries = await all();
    await transaction("readwrite", function (store) {
      entries.filter(function (record) { return record.owner === id; }).forEach(function (record) { store.delete(record.key); });
    });
    Object.keys(localStorage).filter(function (key) { return key.startsWith("7metro-scoreboard-" + id + "-") || key.startsWith("7metro-guide:" + id + ":"); })
      .forEach(function (key) { localStorage.removeItem(key); });
    await forgetSession();
  }
  window.AppOffline = { perform: perform, prepare: prepare, disconnected: disconnected,
    saveDraft: saveDraftNow, clearDraft: clearDraft, teamOpened: teamOpened, sync: sync,
    forgetSession: forgetSession, deleteAccount: deleteAccount, rememberIdentity: rememberIdentity, render: renderStatus };
  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("session-form").addEventListener("input", saveDraftNow);
    $("session-draft-restore").addEventListener("click", function () {
      if (!recoveredDraft || !canReplaceSessionDraft()) return;
      applyDraft(recoveredDraft.value); recoveredDraft = null; $("session-draft-recovery").hidden = true;
    });
    $("session-draft-discard").addEventListener("click", clearDraft);
    $("offline-pending-open").addEventListener("click", function () { $("offline-pending-dialog").showModal(); renderStatus(); });
    $("offline-pending-close").addEventListener("click", function () { $("offline-pending-dialog").close(); });
    $("offline-sync-retry").addEventListener("click", sync);
    $("offline-pending-list").addEventListener("click", async function (event) {
      var button = event.target.closest("[data-offline-review],[data-offline-cancel]");
      if (!button || syncing || activeWrites) return;
      var job = await get(button.dataset.offlineReview || button.dataset.offlineCancel);
      if (!job || job.owner !== owner()) return;
      button.disabled = true;
      try {
        if (button.hasAttribute("data-offline-review")) await review(job);
        else if (confirm(t("Gordetze hau bidaltzea bertan behera utzi nahi duzu?"))) {
          await remove(job.key);
          var scoreKey = "7metro-scoreboard-" + job.owner + "-" + job.payload.team_id;
          var saved = JSON.parse(localStorage.getItem(scoreKey) || "null");
          if (saved && saved.pendingOperationId === job.payload.operation_id) {
            delete saved.pendingOperationId; localStorage.setItem(scoreKey, JSON.stringify(saved));
          }
          if (scoreboard.pendingOperationId === job.payload.operation_id && Number(teamId) === Number(job.payload.team_id)) {
            delete scoreboard.pendingOperationId; scoreSave(); scoreRender();
          }
        }
      } catch (error) { notify(error.message, "error"); }
      finally { button.disabled = false; renderStatus(); }
    });
    window.addEventListener("offline", renderStatus);
    window.addEventListener("online", function () { unavailable = false; renderStatus(); sync(); });
    window.addEventListener("pagehide", saveDraftNow);
    window.addEventListener("languagechange", renderStatus);
    document.addEventListener("visibilitychange", function () { if (document.hidden) saveDraftNow(); else sync(); });
    setInterval(sync, 30000);
  });
})();
