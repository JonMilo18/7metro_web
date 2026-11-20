"use strict";
(function () {
  var list = [], loadedKey = "", generation = 0, busy = false, saving = null;
  function identity() { return String(user && (user.id_erabiltzailea || user.izena) || "") + ":" + teamId; }
  function current(key, version) { return key === identity() && version === generation; }
  function setBusy(value) {
    busy = value;
    document.querySelectorAll("[data-use-session-template],[data-remove-session-template],#session-template-refresh,#session-template-confirm,#session-template-name")
      .forEach(function (node) { node.disabled = value; });
    $("session-template-list").setAttribute("aria-busy", String(value));
  }
  function render() {
    if (loadedKey !== identity()) list = [];
    var query = normalizeCategoryName($("session-template-search").value);
    var visible = list.filter(function (item) { return normalizeCategoryName(item.name + " " + (item.session.helburu_taktikoa || "")).includes(query); });
    $("session-template-count").textContent = list.length ? String(list.length) : "";
    $("session-template-list").innerHTML = visible.length ? visible.map(function (item) {
      return '<li class="session-template-card"><div><h3>' + esc(item.name) + '</h3><p class="muted">' + item.exercise_count + esc(t(" ariketa")) + ' · ' + item.duration + ' min</p>' +
        (item.session.helburu_taktikoa && item.session.helburu_taktikoa !== item.name ? '<p>' + esc(item.session.helburu_taktikoa) + '</p>' : '') + '</div><div class="session-template-actions"><button type="button" class="btn" data-use-session-template="' + esc(item.id) + '">' + esc(t("Erabili txantiloia")) + '</button><button type="button" class="btn secondary" data-remove-session-template="' + esc(item.id) + '">' + esc(t("Ezabatu")) + '</button></div></li>';
    }).join("") : '<li class="empty">' + esc(t(query ? "Ez dago bilaketarekin bat datorren txantiloirik." : "Oraindik ez dago txantiloirik. Gorde entrenamendu bat txantiloi gisa berrerabiltzeko.")) + '</li>';
    setBusy(busy);
  }
  async function load() {
    var key = identity(), version = generation;
    setBusy(true); $("session-template-error").hidden = true;
    try {
      var result = await request({ action: "session_template_list", team_id: teamId });
      if (!current(key, version)) return;
      list = result.templates || []; loadedKey = key; render();
    } catch (error) {
      if (current(key, version)) { $("session-template-error").textContent = error.message; $("session-template-error").hidden = false; }
    } finally { if (current(key, version)) setBusy(false); }
  }
  async function openLibrary() {
    if (busy || sessionEditorBusy) return;
    $("session-template-search").value = ""; render();
    $("session-templates-dialog").showModal();
    await load();
  }
  function editorDetails() {
    return sessionSelection.map(function (entry) {
      return { is_separator: Boolean(entry.is_separator), id_ariketa: entry.is_separator ? null : Number(entry.id_ariketa),
        iraupena_minutuak: entry.is_separator ? 0 : Number(entry.iraupena_minutuak) || 0,
        taldea: entry.taldea || null, aldaerak: entry.aldaerak || null, paraleloa: entry.paraleloa ? 1 : 0 };
    });
  }
  async function prepareSave(id) {
    if (busy || sessionEditorBusy) return;
    var key = identity(), version = generation;
    setBusy(true);
    try {
      var data;
      if (id) {
        var result = await request({ action: "pwa_get_session", team_id: teamId, id: Number(id) });
        if (!current(key, version)) return;
        var details = result.details.map(function (entry) { return Object.assign({}, entry, { is_separator: entry.id_ariketa == null }); });
        data = { session: { lekua: result.session.lekua || "", helburu_taktikoa: result.session.helburu_taktikoa || "" }, exercises: details,
          total_minutes: Math.min(999, details.reduce(function (sum, entry) { return sum + (entry.is_separator ? 0 : Number(entry.iraupena_minutuak) || 0); }, 0)) };
      } else data = { session: { lekua: $("session-place").value, helburu_taktikoa: $("session-goal").value }, exercises: editorDetails(), total_minutes: Number($("session-total-minutes").value) || 0 };
      saving = { key: key, version: version, id: crypto.randomUUID(), content: data };
      $("session-template-name").value = data.session.helburu_taktikoa.slice(0, 120);
      $("session-template-save-error").hidden = true;
      $("session-template-save-dialog").showModal();
      $("session-template-name").focus();
    } catch (error) { if (current(key, version)) notify(error.message, "error"); }
    finally { if (current(key, version)) setBusy(false); }
  }
  $("session-template-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (busy || !saving || !current(saving.key, saving.version)) return;
    var pending = saving, name = $("session-template-name").value.trim();
    if (!name) { $("session-template-name").focus(); return; }
    // Keep the same UUID for a retry with identical data; changed input is a new save.
    if (pending.sentName && pending.sentName !== name) pending.id = crypto.randomUUID();
    pending.sentName = name; setBusy(true);
    try {
      await request(Object.assign({ action: "session_template_save", team_id: teamId, template_id: pending.id, name: name }, pending.content));
      if (!current(pending.key, pending.version)) return;
      $("session-template-save-dialog").close();
      loadedKey = ""; notify(t("Entrenamenduaren txantiloia gorde da"), "success");
      if ($("session-templates-dialog").open) await load();
    } catch (error) {
      if (current(pending.key, pending.version)) { $("session-template-save-error").textContent = error.message; $("session-template-save-error").hidden = false; }
    } finally { if (current(pending.key, pending.version)) setBusy(false); }
  });
  async function useTemplate(id) {
    if (busy || sessionEditorBusy || !canReplaceSessionDraft()) return;
    var key = identity(), version = generation, selectedDate = $("session-date").value || localDateTime();
    setBusy(true); sessionEditorBusy = "load"; renderSessionEditor();
    try {
      var result = await request({ action: "session_template_get", team_id: teamId, template_id: id });
      if (!current(key, version)) return;
      resetSessionEditor();
      sessionEditor.templateId = id;
      sessionSelection = restoreSessionSelection(result.template.details);
      (result.exercises || []).forEach(function (exercise) {
        sessionReferenceExercises = sessionReferenceExercises.filter(function (row) { return Number(row.id_ariketa) !== Number(exercise.id_ariketa); }).concat([exercise]);
      });
      $("session-date").value = selectedDate;
      $("session-place").value = result.template.session.lekua || "";
      $("session-goal").value = result.template.session.helburu_taktikoa || "";
      $("session-micro").value = "";
      $("session-total-minutes").value = result.template.total_minutes;
      activeSessionGroup = null; renderSessionPicker();
      // A loaded template is a recoverable draft until it becomes a dated training.
      sessionCleanDraft = ""; sessionEditorBusy = false; renderSessionEditor();
      $("session-templates-dialog").close(); showSessionEditor();
      sessionCleanDraft = "template-loaded";
      if (window.AppOffline) await window.AppOffline.saveDraft(true);
    } catch (error) { if (current(key, version)) notify(error.message, "error"); }
    finally { if (current(key, version)) { sessionEditorBusy = false; renderSessionEditor(); setBusy(false); } }
  }
  async function removeTemplate(id) {
    if (busy) return;
    var item = list.find(function (row) { return row.id === id; });
    if (!item || !confirm(item.name + "\n" + t("Txantiloia ezabatu? Sortutako entrenamenduak mantenduko dira."))) return;
    var key = identity(), version = generation; setBusy(true);
    try {
      await request({ action: "session_template_delete", team_id: teamId, template_id: id });
      if (!current(key, version)) return;
      list = list.filter(function (row) { return row.id !== id; }); render(); notify(t("Txantiloia ezabatu da"), "success");
    } catch (error) { if (current(key, version)) notify(error.message, "error"); }
    finally { if (current(key, version)) setBusy(false); }
  }
  document.addEventListener("click", function (event) {
    var target = event.target.closest("button"); if (!target) return;
    if (target.hasAttribute("data-save-session-template")) prepareSave(target.dataset.saveSessionTemplate);
    if (target.hasAttribute("data-use-session-template")) useTemplate(target.dataset.useSessionTemplate);
    if (target.hasAttribute("data-remove-session-template")) removeTemplate(target.dataset.removeSessionTemplate);
  });
  $("session-template-open").addEventListener("click", openLibrary);
  $("session-template-refresh").addEventListener("click", load);
  $("session-template-search").addEventListener("input", render);
  ["session-templates-dialog", "session-template-save-dialog"].forEach(function (id) {
    $(id).addEventListener("click", function (event) { if (event.target === this && !busy) this.close(); });
    $(id).addEventListener("cancel", function (event) { if (busy) event.preventDefault(); });
    $(id).querySelector("[data-close-template-dialog]").addEventListener("click", function () { if (!busy) $(id).close(); });
  });
  window.addEventListener("languagechange", function () { if ($("session-templates-dialog").open) render(); });
  window.SessionTemplates = { reset: function () {
    generation++; busy = false; list = []; saving = null; loadedKey = "";
    ["session-templates-dialog", "session-template-save-dialog"].forEach(function (id) { if ($(id).open) $(id).close(); });
    setBusy(false);
  } };
})();
