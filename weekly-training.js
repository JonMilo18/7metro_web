"use strict";

(function () {
  var state = { team: 0, version: 0, saved: [], draft: [], publications: [], busy: false, sequence: 0 };

  function dateValue(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function monday(value) {
    var date = value ? new Date(value + "T12:00:00") : new Date();
    if (!Number.isFinite(date.getTime())) return "";
    date.setDate(date.getDate() - (date.getDay() + 6) % 7);
    return dateValue(date);
  }

  function dirty() {
    return JSON.stringify(state.saved) !== JSON.stringify(state.draft);
  }

  function current(context) {
    return context.sequence === state.sequence && context.team === teamId && Boolean(token);
  }

  function status(message, error) {
    $("weekly-training-status").textContent = message;
    $("weekly-training-status").classList.toggle("error", Boolean(error));
  }

  function collect() {
    state.draft = Array.from(document.querySelectorAll("[data-weekly-slot]")).map(function (row) {
      return { weekday: Number(row.querySelector('[name="weekday"]').value), time: row.querySelector('[name="time"]').value,
        lekua: row.querySelector('[name="lekua"]').value, helburu_taktikoa: row.querySelector('[name="helburu_taktikoa"]').value };
    });
    preview();
  }

  function renderSlots() {
    $("weekly-training-slots").innerHTML = state.draft.map(function (slot, index) {
      var options = [];
      for (var day = 1; day <= 7; day++) {
        var name = new Date(2024, 0, day).toLocaleDateString(I18n.locale(), { weekday: "long" });
        options.push('<option value="' + day + '"' + (slot.weekday === day ? ' selected' : '') + '>' + esc(name) + '</option>');
      }
      return '<div class="weekly-training-slot" data-weekly-slot="' + index + '">' +
        '<label>' + esc(t("Eguna")) + '<select name="weekday">' + options.join("") + '</select></label>' +
        '<label>' + esc(t("Ordua")) + '<input name="time" type="time" required value="' + esc(slot.time) + '"></label>' +
        '<label>' + esc(t("Tokia")) + '<input name="lekua" maxlength="250" required value="' + esc(slot.lekua) + '"></label>' +
        '<label>' + esc(t("Izena edo helburua (aukerakoa)")) + '<input name="helburu_taktikoa" maxlength="250" value="' + esc(slot.helburu_taktikoa) + '"></label>' +
        '<button class="btn secondary" type="button" data-weekly-remove="' + index + '">' + esc(t("Kendu")) + '</button></div>';
    }).join("");
    if (!state.draft.length) $("weekly-training-slots").innerHTML = '<p class="muted">' + esc(t("Gehitu taldearen entrenamendu-egunak.")) + '</p>';
    preview();
  }

  function preview() {
    var week = $("weekly-training-week").value;
    var valid = /^\d{4}-\d{2}-\d{2}$/.test(week) && monday(week) === week;
    var pending = 0;
    $("weekly-training-fields").disabled = state.busy || state.team !== teamId;
    $("weekly-training-publish-fields").disabled = state.busy;
    $("weekly-training").setAttribute("aria-busy", String(state.busy));
    $("weekly-training-save").disabled = !dirty();
    $("weekly-training-add").disabled = state.draft.length >= 28;
    $("weekly-training-dirty").hidden = !dirty();
    $("weekly-training-preview").innerHTML = valid ? state.saved.map(function (slot) {
      var day = new Date(week + "T12:00:00");
      day.setDate(day.getDate() + slot.weekday - 1);
      var scheduled = dateValue(day) + "T" + slot.time;
      var published = state.publications.some(function (item) { return item.scheduled_at === scheduled; }) ||
        sessions.some(function (session) { return String(session.data_ordua || "").slice(0, 16).replace(" ", "T") === scheduled; });
      if (!published) pending++;
      return '<li class="item"><strong>' + esc(day.toLocaleDateString(I18n.locale(), { weekday: "long", day: "numeric", month: "short" })) + ' · ' + esc(slot.time) + '</strong>' +
        '<span>' + esc(slot.helburu_taktikoa || t("Entrenamendua")) + ' · ' + esc(slot.lekua) + '</span>' +
        '<small class="muted">' + esc(t(published ? "Argitaratuta" : "Argitaratzeko")) + '</small></li>';
    }).join("") : "";
    $("weekly-training-publish").disabled = state.team !== teamId || !valid || !pending || dirty();
    if (valid) {
      var end = new Date(week + "T12:00:00");
      end.setDate(end.getDate() + 6);
      $("weekly-training-range").textContent = new Date(week + "T12:00:00").toLocaleDateString(I18n.locale()) + " – " + end.toLocaleDateString(I18n.locale());
    } else $("weekly-training-range").textContent = "";
  }

  async function load(discard) {
    if (!token || !teamId || state.busy) return;
    var context = { sequence: ++state.sequence, team: teamId };
    var preserve = !discard && state.team === teamId && dirty();
    state.busy = true;
    preview();
    status(t("Kargatzen..."));
    try {
      var result = await request({ action: "weekly_training_get", team_id: context.team, week_start: $("weekly-training-week").value });
      if (!current(context)) return;
      state.team = context.team;
      state.publications = result.publications;
      if (!preserve) {
        state.version = result.version;
        state.saved = result.slots;
        state.draft = JSON.parse(JSON.stringify(result.slots));
      }
      $("weekly-training-settings").open = state.saved.length === 0 || preserve;
      renderSlots();
      status("");
    } catch (error) {
      if (current(context)) status(error.message, true);
    } finally {
      if (current(context)) { state.busy = false; preview(); }
    }
  }

  async function saveOrPublish(action) {
    if (state.busy || state.team !== teamId || (action === "publish" && dirty())) return;
    var context = { sequence: ++state.sequence, team: teamId };
    state.busy = true;
    preview();
    status(t(action === "save" ? "Gordetzen..." : "Argitaratzen..."));
    try {
      var result = await request({ action: "weekly_training_" + action, team_id: context.team,
        week_start: $("weekly-training-week").value, version: state.version, slots: state.draft });
      if (!current(context)) return;
      state.version = result.version;
      state.saved = result.slots;
      state.draft = JSON.parse(JSON.stringify(result.slots));
      state.publications = result.publications;
      renderSlots();
      if (action === "publish") {
        status(t("{count} entrenamendu argitaratu dira. Lehendik zeudenak: {skipped}.", { count: result.created_ids.length, skipped: result.skipped }));
        try { await refreshAll(); }
        catch (error) {
          if (current(context)) status(t("Entrenamenduak argitaratu dira, baina zerrenda ezin izan da birkargatu. Sakatu Birkargatu."), true);
        }
      } else {
        $("weekly-training-settings").open = false;
        status(t("Ohiko ordutegia gordeta"));
      }
    } catch (error) {
      if (current(context)) status(error.message, true);
    } finally {
      if (current(context)) { state.busy = false; preview(); }
    }
  }

  function reset() {
    state.sequence++;
    state.team = 0;
    state.version = 0;
    state.saved = []; state.draft = []; state.publications = []; state.busy = false;
    $("weekly-training").open = false;
    $("weekly-training-week").value = monday();
    status("");
    renderSlots();
  }

  window.WeeklyTraining = {
    reset: reset,
    refresh: function () {
      if (state.team && state.team !== teamId) reset();
      else preview();
    }
  };
  document.addEventListener("DOMContentLoaded", function () {
    reset();
    $("weekly-training").addEventListener("toggle", function () { if (this.open) load(false); });
    $("plan-create-weekly").addEventListener("click", function () {
      if (state.busy || !$("plan-create-date").reportValidity()) return;
      var wasOpen = $("weekly-training").open;
      $("weekly-training-week").value = monday($("plan-create-date").value);
      closePlanningOptions();
      $("weekly-training").open = true;
      if (wasOpen) load(false);
      $("weekly-training").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("weekly-training-week").addEventListener("change", function () {
      this.value = monday(this.value);
      if (this.value) load(false);
      else preview();
    });
    $("weekly-training-add").addEventListener("click", function () {
      if (state.busy || state.draft.length >= 28) return;
      state.draft.push({ weekday: 1, time: "18:00", lekua: "Kiroldegia", helburu_taktikoa: "" });
      renderSlots();
      $("weekly-training-slots").lastElementChild.querySelector("select").focus();
    });
    $("weekly-training-slots").addEventListener("click", function (event) {
      var button = event.target.closest("[data-weekly-remove]");
      if (!button || state.busy) return;
      state.draft.splice(Number(button.dataset.weeklyRemove), 1);
      renderSlots();
    });
    $("weekly-training-form").addEventListener("input", collect);
    $("weekly-training-form").addEventListener("change", collect);
    $("weekly-training-form").addEventListener("submit", function (event) { event.preventDefault(); collect(); saveOrPublish("save"); });
    $("weekly-training-publish-form").addEventListener("submit", function (event) { event.preventDefault(); saveOrPublish("publish"); });
    $("weekly-training-reload").addEventListener("click", function () {
      if (!dirty() || confirm(t("Gorde gabeko ordutegiaren aldaketak baztertu nahi dituzu?"))) load(true);
    });
    window.addEventListener("languagechange", renderSlots);
  });
})();
