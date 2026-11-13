"use strict";

var pushState = { active: false, configured: false, publicKey: "", binding: "", subscription: null, preferences: { callups: true, schedule: true, notices: true, responses: true, friends: true }, busy: false, message: "", epoch: 0, refreshing: null, pending: 0, friendSequence: 0 };
function pushSupported() { return window.isSecureContext && "Notification" in window && "PushManager" in window && "serviceWorker" in navigator; }
function pushDeviceSecret() {
  var value = readStore("7metro-push-device");
  if (!/^[0-9a-f]{64}$/.test(value)) { value = Array.from(crypto.getRandomValues(new Uint8Array(32)), function (n) { return n.toString(16).padStart(2, "0"); }).join(""); saveLocal("7metro-push-device", value); }
  return value;
}
async function pushRegistration() {
  var registration = await navigator.serviceWorker.getRegistration();
  if (!registration) registration = await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
  return await Promise.race([navigator.serviceWorker.ready, new Promise(function (_, reject) { setTimeout(function () { reject(new Error(t("Birkargatu aplikazioa eta saiatu berriro"))); }, 6000); })]);
}
function pushMessage(registration, type, binding) {
  return new Promise(function (resolve, reject) {
    if (!registration.active) { reject(new Error(t("Birkargatu aplikazioa eta saiatu berriro"))); return; }
    var channel = new MessageChannel(), timer = setTimeout(function () { channel.port1.close(); reject(new Error(t("Birkargatu aplikazioa eta saiatu berriro"))); }, 1200);
    channel.port1.onmessage = function (event) { clearTimeout(timer); channel.port1.close(); if (event.data && event.data.ok) resolve(event.data); else reject(new Error(t("Ezin izan dira jakinarazpenak aktibatu"))); };
    registration.active.postMessage({ type: type, binding: binding || "" }, [channel.port2]);
  });
}
function pushRender() {
  var supported = pushSupported(), permission = supported ? Notification.permission : "unsupported";
  document.querySelectorAll("[data-push-settings]").forEach(function (container) {
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    var hint = !supported ? "Gailu edo arakatzaile honek ez ditu push jakinarazpenak onartzen." : permission === "denied" ? "Jakinarazpenak blokeatuta daude. Baimendu arakatzailearen edo telefonoaren ezarpenetan." : !pushState.configured ? "Jakinarazpenen zerbitzua prestatzen ari da." : pushState.active ? "Jakinarazpenak aktibatuta daude gailu honetan." : "Aktibatu jakinarazpenak gailu honetan jasotzeko.";
    container.innerHTML = '<h2>' + esc(t("Jakinarazpenak")) + '</h2><p class="muted">' + esc(t(hint)) + '</p>' + (ios && !standalone ? '<p class="muted">' + esc(t("iPhonen edo iPaden, ireki aplikazioa hasierako pantailako ikonotik.")) + '</p>' : '') + '<p class="push-settings-status" role="status" aria-live="polite">' + esc(pushState.message) + '</p><div class="push-preferences">' + [["callups", "Deialdi berriak, aldaketak eta oroigarriak"], ["schedule", "Ordutegi eta toki aldaketak"], ["notices", "Taldeko abisuak"], ["responses", "Jokalarien erantzunak"], ["friends", "Lagun-eskaerak"]].map(function (entry) {
      return '<label class="checkrow"><input type="checkbox" data-push-kind="' + entry[0] + '"' + (pushState.preferences[entry[0]] ? ' checked' : '') + (!pushState.active || pushState.busy ? ' disabled' : '') + '><span>' + esc(t(entry[1])) + '</span></label>';
    }).join("") + '</div><p class="muted">' + esc(t("Oroigarriak 24 ordu eta 3 ordu lehenago bidaltzen dira erantzun gabe daudenei.")) + '</p><div class="push-settings-actions"><button class="btn' + (pushState.active ? ' secondary' : '') + '" type="button" data-push-action="' + (pushState.active ? 'disable' : 'enable') + '"' + (pushState.busy || (!pushState.active && (!supported || permission === 'denied' || !pushState.configured)) ? ' disabled' : '') + '>' + esc(t(pushState.active ? "Desaktibatu gailu honetan" : "Aktibatu jakinarazpenak")) + '</button>' + (pushState.active ? '<button class="btn secondary" type="button" data-push-action="test"' + (pushState.busy ? ' disabled' : '') + '>' + esc(t("Proba bidali")) + '</button>' : '') + '<button class="btn secondary" type="button" data-push-action="refresh"' + (pushState.busy ? ' disabled' : '') + '>' + esc(t("Birkargatu")) + '</button></div>';
  });
}
async function pushSave(subscription, preferences) {
  return await request({ action: "push_save", device_secret: pushDeviceSecret(), subscription: subscription.toJSON(), preferences: preferences, language: I18n.language() });
}
async function pushRefresh() {
  if (!token || pushState.busy) { pushRender(); return; }
  if (pushState.refreshing) return pushState.refreshing;
  var epoch = pushState.epoch, sessionToken = token;
  var run = (async function () {
    try {
      var result = await request({ action: "push_status", device_secret: pushDeviceSecret() });
      if (epoch !== pushState.epoch || token !== sessionToken) return;
      pushState.configured = result.configured; pushState.publicKey = result.public_key;
      pushState.active = false; pushState.message = "";
      if (pushSupported()) {
        var registration = await pushRegistration(), subscription = await registration.pushManager.getSubscription();
        if (epoch !== pushState.epoch || token !== sessionToken) return;
        if (result.registered && subscription && Notification.permission === "granted") {
          if (result.endpoint !== subscription.endpoint || result.language !== I18n.language()) {
            var saved = await pushSave(subscription, result.preferences); result.binding = saved.binding;
          }
          if (epoch !== pushState.epoch || token !== sessionToken) return;
          await pushMessage(registration, "7METRO_PUSH_BIND", result.binding);
          if (epoch !== pushState.epoch || token !== sessionToken) { await pushMessage(registration, "7METRO_PUSH_CLEAR", result.binding).catch(function () {}); return; }
          pushState.preferences = result.preferences; pushState.binding = result.binding; pushState.subscription = subscription; pushState.active = true;
        } else {
          await pushMessage(registration, "7METRO_PUSH_CLEAR").catch(function () {});
          if (subscription) await subscription.unsubscribe();
        }
      }
    } catch (error) { if (epoch === pushState.epoch && token === sessionToken) pushState.message = error.message; }
    finally { if (epoch === pushState.epoch) pushRender(); }
  })();
  pushState.refreshing = run;
  try { await run; } finally { if (pushState.refreshing === run) pushState.refreshing = null; }
}
async function pushEnable() {
  if (pushState.busy || !pushSupported()) return;
  // Permission is requested directly from this click, before any network await.
  var permissionPromise;
  try { permissionPromise = Notification.permission === "granted" ? Promise.resolve("granted") : Notification.requestPermission(); }
  catch (error) { pushState.message = error.message; pushRender(); return; }
  pushState.busy = true; pushState.message = ""; pushRender();
  var subscription = null, registered = false, epoch = pushState.epoch, sessionToken = token;
  try {
    if (await permissionPromise !== "granted") throw new Error(t("Ez da jakinarazpenak jasotzeko baimenik eman"));
    var registration = await pushRegistration();
    await registration.update();
    for (var attempt = 0; ; attempt++) {
      try { await pushMessage(registration, "7METRO_PUSH_PING"); break; }
      catch (error) { if (attempt >= 3) throw error; }
    }
    var previous = await registration.pushManager.getSubscription(); if (previous) await previous.unsubscribe();
    var key = pushState.publicKey.replace(/-/g, "+").replace(/_/g, "/");
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(key), function (c) { return c.charCodeAt(0); }) });
    if (epoch !== pushState.epoch || token !== sessionToken) { await subscription.unsubscribe(); return; }
    var result = await pushSave(subscription, pushState.preferences); registered = true;
    if (epoch !== pushState.epoch || token !== sessionToken) { await subscription.unsubscribe(); return; }
    await pushMessage(registration, "7METRO_PUSH_BIND", result.binding);
    if (epoch !== pushState.epoch || token !== sessionToken) { await pushMessage(registration, "7METRO_PUSH_CLEAR", result.binding).catch(function () {}); await subscription.unsubscribe(); return; }
    pushState.binding = result.binding; pushState.subscription = subscription; pushState.active = true;
    pushState.message = t("Jakinarazpenak aktibatu dira");
  } catch (error) {
    if (subscription) await subscription.unsubscribe().catch(function () {});
    if (registered && token === sessionToken) await request({ action: "push_remove", device_secret: pushDeviceSecret() }).catch(function () {});
    if (epoch === pushState.epoch) { pushState.active = false; pushState.message = error.message; }
  } finally { if (epoch === pushState.epoch) { pushState.busy = false; pushRender(); } }
}
async function pushStopLocal(binding, subscription, epoch) {
  if (!("serviceWorker" in navigator)) return;
  var registration = await navigator.serviceWorker.getRegistration(); if (!registration) return;
  if (epoch !== pushState.epoch && !binding && !subscription) return;
  var cleared = await pushMessage(registration, "7METRO_PUSH_CLEAR", binding).then(function () { return true; }, function () { return false; });
  if (!subscription && epoch === pushState.epoch) subscription = await registration.pushManager?.getSubscription();
  var removed = subscription ? await subscription.unsubscribe().catch(function () { return false; }) : true;
  if (!cleared && !removed) throw new Error(t("Ezin izan dira jakinarazpenak desaktibatu"));
}
async function pushDisable() {
  if (pushState.busy) return;
  var epoch = pushState.epoch;
  pushState.busy = true; pushRender();
  try {
    var results = await Promise.allSettled([pushStopLocal(pushState.binding, pushState.subscription, pushState.epoch), request({ action: "push_remove", device_secret: pushDeviceSecret() })]);
    if (epoch !== pushState.epoch) return;
    if (results.every(function (result) { return result.status === "rejected"; })) throw new Error(t("Ezin izan dira jakinarazpenak desaktibatu"));
    pushState.active = false; pushState.subscription = null; pushState.binding = ""; pushState.message = t("Jakinarazpenak desaktibatu dira");
  } catch (error) { if (epoch === pushState.epoch) pushState.message = error.message; }
  finally { if (epoch === pushState.epoch) { pushState.busy = false; pushRender(); } }
}
function pushReset() {
  var binding = pushState.binding, subscription = pushState.subscription;
  pushState.epoch++; pushState.active = false; pushState.subscription = null; pushState.binding = ""; pushState.busy = false; pushState.message = ""; pushState.refreshing = null;
  pushState.preferences = { callups: true, schedule: true, notices: true, responses: true, friends: true }; pushState.friendSequence++;
  pushStopLocal(binding, subscription, pushState.epoch).catch(function () {}); $("portal-friend-requests").innerHTML = ""; pushRender();
}
async function pushPlayerFriends() {
  var sessionToken = token, sequence = ++pushState.friendSequence; if (!sessionToken) return;
  $("portal-friend-requests").innerHTML = portalEmpty("Kargatzen…");
  try {
    var result = await request({ action: "friends_list" }); if (token !== sessionToken || sequence !== pushState.friendSequence) return;
    $("portal-friend-requests").innerHTML = result.incoming.length ? result.incoming.map(function (row) {
      return '<div class="portal-roster-row"><strong>' + esc(row.username) + '</strong><div class="portal-inline-actions"><button class="btn" type="button" data-player-friend-answer="friend_accept" data-request-id="' + Number(row.id) + '">' + esc(t("Onartu")) + '</button><button class="btn secondary" type="button" data-player-friend-answer="friend_reject" data-request-id="' + Number(row.id) + '">' + esc(t("Baztertu")) + '</button></div></div>';
    }).join("") : portalEmpty("Ez dago sarrerako eskaerarik.");
  } catch (error) { if (token === sessionToken && sequence === pushState.friendSequence) $("portal-friend-requests").textContent = error.message; }
}
async function pushNavigate(result, sessionToken) {
  var target = result.target;
  if (token !== sessionToken) return;
  if (target.mode === "player") {
    var boot = await request({ action: "portal_bootstrap" });
    if (token !== sessionToken) return;
    if (!boot.links.some(function (link) { return Number(link.player_id) === Number(target.player_id); })) throw new Error(t("Jakinarazpena ez dago erabilgarri"));
    portalState.playerId = Number(target.player_id); portalSetMode("player"); await portalShow(boot);
    if (result.kind === "notices") portalSetTab("notices");
    else {
      portalSetTab("agenda");
      var data = portalState.data, row = (target.kind === "session" ? data.sessions : data.matches).find(function (event) { return Number(event.id) === Number(target.event_id); });
      if (row) { portalCalendarState.view = "calendar"; portalCalendarSelect(portalCalendarDate(row.date.slice(0, 10))); portalRenderAgenda(); }
    }
  } else if (target.mode === "coach") {
    portalSetMode("coach"); portalHide(); await loadTeams(false);
    if (!teams.some(function (row) { return Number(row.id_taldea) === Number(target.team_id); })) throw new Error(t("Jakinarazpena ez dago erabilgarri"));
    await openTeam(target.team_id);
    if (target.kind === "session") { if (renderSavedSession(target.event_id)) selectSection("v-session-detail"); }
    else { selectSection("v-matches"); await portalOpenMatch(target.event_id); }
  } else if (target.mode === "friends") {
    if (document.body.classList.contains("player-mode")) { portalSetTab("settings"); await pushPlayerFriends(); }
    else selectSection("v-friends");
  } else if (document.body.classList.contains("player-mode")) portalSetTab("settings");
  else selectSection("v-more");
}
async function pushOpen(id) {
  if (!Number.isSafeInteger(id) || id < 1) return;
  pushState.pending = id;
  var pendingUrl = new URL(location.href); pendingUrl.searchParams.set("notification", String(id)); history.replaceState(null, "", pendingUrl);
  if (!token) return;
  var sessionToken = token;
  try {
    var result = await request({ action: "push_resolve", id: id });
    if (token !== sessionToken) return;
    await pushNavigate(result, sessionToken);
    if (token !== sessionToken) return;
    if (window.InboxUI) window.InboxUI.refresh();
    pushState.pending = 0;
    var url = new URL(location.href); url.searchParams.delete("notification"); history.replaceState(null, "", url);
  } catch (error) {
    if (error.message === t("Jakinarazpena ez dago erabilgarri")) {
      pushState.pending = 0; var unavailableUrl = new URL(location.href); unavailableUrl.searchParams.delete("notification"); history.replaceState(null, "", unavailableUrl);
    }
    notify(error.message, "error");
  }
}
window.PushUI = {
  refresh: pushRefresh, reset: pushReset, loadPlayerFriends: pushPlayerFriends,
  beforeLogout: async function () { await pushStopLocal(pushState.binding, pushState.subscription, pushState.epoch).catch(function () {}); },
  afterLogin: async function () {
    await pushRefresh(); var id = pushState.pending || Number(new URL(location.href).searchParams.get("notification")); if (id) await pushOpen(id);
  }, open: pushOpen, openTarget: function (result) { return pushNavigate(result, token); }
};
window.addEventListener("DOMContentLoaded", function () {
  pushRender();
  document.addEventListener("click", async function (event) {
    var button = event.target.closest("[data-push-action]"), friend = event.target.closest("[data-player-friend-answer]");
    if (button) {
      if (button.dataset.pushAction === "enable") pushEnable();
      if (button.dataset.pushAction === "disable") pushDisable();
      if (button.dataset.pushAction === "refresh") pushRefresh();
      if (button.dataset.pushAction === "test" && !pushState.busy) {
        var testEpoch = pushState.epoch;
        pushState.busy = true; pushRender();
        try { await request({ action: "push_test", device_secret: pushDeviceSecret() }); if (testEpoch === pushState.epoch) pushState.message = t("Probako jakinarazpena bidaltzeko ilaran dago"); }
        catch (error) { if (testEpoch === pushState.epoch) pushState.message = error.message; } finally { if (testEpoch === pushState.epoch) { pushState.busy = false; pushRender(); } }
      }
    }
    if (event.target.closest("[data-player-friends-refresh]")) pushPlayerFriends();
    if (friend && !friend.disabled) {
      friend.disabled = true;
      try { await request({ action: friend.dataset.playerFriendAnswer, request_id: Number(friend.dataset.requestId) }); await pushPlayerFriends(); }
      catch (error) { notify(error.message, "error"); } finally { friend.disabled = false; }
    }
  });
  document.addEventListener("change", async function (event) {
    var input = event.target.closest("[data-push-kind]"); if (!input || !pushState.active || pushState.busy) return;
    var preferences = Object.assign({}, pushState.preferences); preferences[input.dataset.pushKind] = input.checked;
    var epoch = pushState.epoch;
    pushState.busy = true; pushRender();
    try { await pushSave(pushState.subscription, preferences); if (epoch === pushState.epoch) { pushState.preferences = preferences; pushState.message = t("Aldaketak gordeta"); } }
    catch (error) { if (epoch === pushState.epoch) pushState.message = error.message; } finally { if (epoch === pushState.epoch) { pushState.busy = false; pushRender(); } }
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", function (event) {
    if (event.data && event.data.type === "7METRO_PUSH_OPEN") pushOpen(Number(event.data.id));
  });
  window.addEventListener("languagechange", function () { pushRender(); if (token) pushRefresh(); });
  if (!token) pushReset();
});
