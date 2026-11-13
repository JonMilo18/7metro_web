"use strict";

(function () {
  var state = { epoch: 0, items: [], unread: 0, more: false, loading: false, busy: false, timer: 0 };

  function title(item) {
    if (item.target.reason === "reminder") return t("Deialdiaren oroigarria");
    if (item.kind === "callups") {
      if (item.target.reason === "withdrawn") return t("Deialdia bertan behera geratu da");
      if (item.target.kind === "session") return t("Entrenamendu berria");
      return t(item.target.reason === "new" ? "Deialdi berria" : "Deialdia aldatu da");
    }
    return t({ schedule: "Ordutegia edo tokia aldatu da", notices: "Taldeko abisu berria",
      responses: "Bertaratze-erantzun berria", friends: "Lagun-eskaera berria" }[item.kind] || "Jakinarazpenak");
  }

  function dateLabel(value) {
    var date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString(I18n.locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  }

  function render() {
    $("notification-bell").hidden = !token;
    $("notification-badge").hidden = state.unread === 0;
    $("notification-badge").textContent = state.unread > 99 ? "99+" : String(state.unread);
    $("notification-bell").setAttribute("aria-label", state.unread ? t("{count} jakinarazpen irakurri gabe", { count: state.unread }) : t("Jakinarazpenak"));
    $("inbox-read-all").disabled = !state.unread || state.loading || state.busy;
    $("inbox-reload").disabled = state.loading || state.busy;
    $("inbox-more").hidden = !state.more;
    $("inbox-more").disabled = state.loading || state.busy;
    $("inbox-list").innerHTML = state.items.map(function (item) {
      var context = [item.team_name, item.event_date && dateLabel(item.event_date)].filter(Boolean).join(" · ");
      return '<li><button class="inbox-item' + (item.read ? '' : ' inbox-unread') + '" type="button" data-inbox-open="' + Number(item.id) + '"' +
        (state.loading || state.busy ? ' disabled' : '') + '><strong>' + esc(title(item)) + '</strong>' +
        (context ? '<span>' + esc(context) + '</span>' : '') +
        (item.target.reason === "reminder" ? '<span>' + esc(t("Ireki aplikazioa deialdiari erantzuteko.")) + '</span>' : '') +
        '<small>' + esc(dateLabel(item.created_at)) + (item.read ? '' : ' · ' + esc(t("Irakurri gabe"))) + '</small></button></li>';
    }).join("");
    $("inbox-empty").hidden = state.items.length > 0 || state.loading;
  }

  function current(epoch, sessionToken) {
    return state.epoch === epoch && token === sessionToken && Boolean(token);
  }

  async function refresh(more) {
    if (!token || state.loading) return;
    var epoch = state.epoch, sessionToken = token;
    var list = $("inbox-dialog").open;
    var payload = { action: list ? "inbox_list" : "inbox_count" };
    if (more && state.items.length) payload.before = state.items[state.items.length - 1].id;
    state.loading = true;
    if (list) $("inbox-status").textContent = t("Kargatzen...");
    render();
    try {
      var result = await request(payload);
      if (!current(epoch, sessionToken)) return;
      state.unread = result.unread;
      if (list) {
        state.items = more ? state.items.concat(result.items) : result.items;
        state.more = result.has_more;
        $("inbox-status").textContent = "";
      }
    } catch (error) {
      if (current(epoch, sessionToken) && list) $("inbox-status").textContent = error.message;
    } finally {
      if (current(epoch, sessionToken)) {
        state.loading = false;
        render();
        if (!list && $("inbox-dialog").open) refresh(false);
      }
    }
  }

  async function openItem(id) {
    if (state.busy || state.loading) return;
    var epoch = state.epoch, sessionToken = token;
    state.busy = true;
    render();
    try {
      var result = await request({ action: "inbox_open", id: id });
      if (!current(epoch, sessionToken)) return;
      $("inbox-dialog").close();
      await PushUI.openTarget(result);
    } catch (error) {
      if (current(epoch, sessionToken)) notify(error.message, "error");
    } finally {
      if (current(epoch, sessionToken)) { state.busy = false; await refresh(false); }
    }
  }

  function reset() {
    state.epoch++;
    clearInterval(state.timer);
    state.timer = 0; state.items = []; state.unread = 0; state.more = false; state.loading = false; state.busy = false;
    if ($("inbox-dialog").open) $("inbox-dialog").close();
    $("inbox-status").textContent = "";
    render();
    $("notification-bell").hidden = true;
  }

  window.InboxUI = {
    refresh: function () { return refresh(false); }, reset: reset,
    start: function () {
      clearInterval(state.timer);
      refresh(false);
      state.timer = setInterval(function () { if (!document.hidden && !state.busy) refresh(false); }, 60000);
    }
  };
  document.addEventListener("DOMContentLoaded", function () {
    render();
    $("notification-bell").addEventListener("click", function () {
      if (!token) return;
      $("inbox-dialog").showModal();
      refresh(false);
    });
    $("inbox-close").addEventListener("click", function () { $("inbox-dialog").close(); });
    $("inbox-reload").addEventListener("click", function () { refresh(false); });
    $("inbox-more").addEventListener("click", function () { refresh(true); });
    $("inbox-list").addEventListener("click", function (event) {
      var button = event.target.closest("[data-inbox-open]");
      if (button) openItem(Number(button.dataset.inboxOpen));
    });
    $("inbox-read-all").addEventListener("click", async function () {
      if (state.busy || state.loading) return;
      var epoch = state.epoch, sessionToken = token;
      state.busy = true;
      render();
      try {
        await request({ action: "inbox_read_all" });
        if (current(epoch, sessionToken)) await refresh(false);
      } catch (error) {
        if (current(epoch, sessionToken)) $("inbox-status").textContent = error.message;
      } finally { if (current(epoch, sessionToken)) { state.busy = false; render(); } }
    });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && token && !state.busy) refresh(false); });
    window.addEventListener("languagechange", render);
  });
})();
