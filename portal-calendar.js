"use strict";

var portalCalendarState = { view: "list", month: null, selected: "" };
function portalCalendarReset() { portalCalendarState = { view: "list", month: null, selected: "" }; }
function portalCalendarBounds() {
  var min = new Date(), max = new Date(); min.setHours(0, 0, 0, 0); max.setHours(0, 0, 0, 0);
  min.setDate(min.getDate() - 7); max.setDate(max.getDate() + 90);
  return { min: min, max: max };
}
function portalCalendarLabel(date) {
  if (I18n.language() === "eu") return t(PLAN_MONTHS[date.getMonth()]) + " " + date.getDate() + " · " + date.getFullYear();
  return date.toLocaleDateString(I18n.locale(), { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
function portalAgendaEvents() {
  var data = portalState.data; if (!data) return [];
  return data.sessions.map(function (row) { return { kind: "session", row: row }; }).concat(data.matches.map(function (row) { return { kind: "match", row: row }; })).sort(function (a, b) { return a.row.date.localeCompare(b.row.date); });
}
function portalCalendarDate(key) { return /^\d{4}-\d{2}-\d{2}$/.test(key) ? new Date(key + "T00:00:00") : new Date(); }
function portalCalendarSelect(date) {
  var bounds = portalCalendarBounds(); date = new Date(Math.max(bounds.min.getTime(), Math.min(bounds.max.getTime(), date.getTime())));
  portalCalendarState.selected = planKey(date); portalCalendarState.month = new Date(date.getFullYear(), date.getMonth(), 1);
}
function portalCalendarHtml(events) {
  if (!portalCalendarState.month || !portalCalendarState.selected) portalCalendarSelect(new Date());
  var base = portalCalendarState.month, selected = portalCalendarState.selected, bounds = portalCalendarBounds(), today = planKey(new Date());
  var min = planKey(bounds.min), max = planKey(bounds.max), byDay = Object.create(null);
  events.forEach(function (event) { var day = String(event.row.date).slice(0, 10); (byDay[day] || (byDay[day] = [])).push(event); });
  var prev = new Date(base.getFullYear(), base.getMonth(), 0), next = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  var html = '<div class="card portal-calendar"><div class="portal-calendar-nav"><button type="button" data-portal-calendar-step="-1" aria-label="' + esc(t("Aurreko hilabetea")) + '"' + (prev < bounds.min ? ' disabled' : '') + '>‹</button><h3 aria-live="polite">' + esc(t(PLAN_MONTHS[base.getMonth()]) + ' ' + base.getFullYear()) + '</h3><button type="button" data-portal-calendar-step="1" aria-label="' + esc(t("Hurrengo hilabetea")) + '"' + (next > bounds.max ? ' disabled' : '') + '>›</button></div><button class="btn secondary portal-calendar-today" type="button" data-portal-calendar-today>' + esc(t("Gaur")) + '</button><div class="portal-calendar-weekdays" aria-hidden="true">' + ["Al", "Ar", "Az", "Og", "Or", "La", "Ig"].map(function (day) { return '<span>' + esc(t(day)) + '</span>'; }).join("") + '</div><div class="portal-calendar-grid" role="group" aria-label="' + esc(t("Hilabeteko egunak")) + '">';
  html += planWeeks(base).map(function (week) { return week.map(function (date) {
    var key = planKey(date), entries = byDay[key] || [], sessions = entries.filter(function (e) { return e.kind === "session"; }).length, matches = entries.length - sessions;
    var label = portalCalendarLabel(date) + ', ' + t("Entrenamenduak") + ': ' + sessions + ', ' + t("Partidak") + ': ' + matches;
    return '<button type="button" class="portal-calendar-day' + (date.getMonth() !== base.getMonth() ? ' outside' : '') + (key === today ? ' today' : '') + '" data-portal-calendar-day="' + key + '" aria-label="' + esc(label) + '" aria-pressed="' + String(key === selected) + '"' + (key === today ? ' aria-current="date"' : '') + (key < min || key > max ? ' disabled' : '') + '><span>' + date.getDate() + '</span><span class="portal-calendar-dots" aria-hidden="true">' + (sessions ? '<i class="session"></i>' : '') + (matches ? '<i class="match"></i>' : '') + (entries.length > 1 ? '<small>' + entries.length + '</small>' : '') + '</span></button>';
  }).join(""); }).join("");
  html += '</div><div class="portal-calendar-legend"><span><i class="session"></i>' + esc(t("Entrenamendua")) + '</span><span><i class="match"></i>' + esc(t("Partida")) + '</span></div></div><div id="portal-calendar-events"><h3>' + esc(portalCalendarLabel(portalCalendarDate(selected))) + '</h3>';
  return html + (byDay[selected] && byDay[selected].length ? byDay[selected].map(portalEventCard).join("") : portalEmpty("Egun honetan ez dago jarduerarik.")) + '</div>';
}
function portalRenderAgenda(events) {
  events = events || portalAgendaEvents();
  var calendar = portalCalendarState.view === "calendar", upcoming = events.filter(function (e) { return String(e.row.date).slice(0, 10) >= planKey(new Date()); });
  $("portal-agenda").innerHTML = '<h2>' + esc(t("Nire agenda")) + '</h2><div class="portal-agenda-toggle" role="group" aria-label="' + esc(t("Agendaren ikuspegia")) + '"><button type="button" data-portal-agenda-view="list" aria-pressed="' + String(!calendar) + '">' + esc(t("Agenda")) + '</button><button type="button" data-portal-agenda-view="calendar" aria-pressed="' + String(calendar) + '">' + esc(t("Egutegia")) + '</button></div><p class="muted">' + esc(t("Datozen 90 egunetako jarduerak")) + '</p>' + (calendar ? portalCalendarHtml(events) : upcoming.length ? upcoming.map(portalEventCard).join("") : portalEmpty("Ez dago hurrengo jarduerarik."));
}
function portalCalendarFocus() {
  var button = document.querySelector('[data-portal-calendar-day="' + portalCalendarState.selected + '"]');
  if (button) button.focus({ preventScroll: true });
}
window.addEventListener("DOMContentLoaded", function () {
  $("portal-agenda").addEventListener("click", function (event) {
    var view = event.target.closest("[data-portal-agenda-view]"), step = event.target.closest("[data-portal-calendar-step]"), day = event.target.closest("[data-portal-calendar-day]");
    if (view) {
      portalCalendarState.view = view.dataset.portalAgendaView; portalRenderAgenda();
      document.querySelector('[data-portal-agenda-view="' + portalCalendarState.view + '"]').focus({ preventScroll: true });
    } else if (step && !step.disabled) {
      var month = portalCalendarState.month, target = new Date(month.getFullYear(), month.getMonth() + Number(step.dataset.portalCalendarStep), 1);
      var date = new Date(target.getFullYear(), target.getMonth(), Math.min(portalCalendarDate(portalCalendarState.selected).getDate(), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
      var direction = step.dataset.portalCalendarStep; portalCalendarSelect(date); portalRenderAgenda();
      var control = document.querySelector('[data-portal-calendar-step="' + direction + '"]');
      if (control.disabled) portalCalendarFocus(); else control.focus({ preventScroll: true });
    } else if (day && !day.disabled) { portalCalendarSelect(portalCalendarDate(day.dataset.portalCalendarDay)); portalRenderAgenda(); portalCalendarFocus(); }
    else if (event.target.closest("[data-portal-calendar-today]")) { portalCalendarSelect(new Date()); portalRenderAgenda(); portalCalendarFocus(); }
  });
  $("portal-agenda").addEventListener("keydown", function (event) {
    var day = event.target.closest("[data-portal-calendar-day]"), offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!day || !offsets[event.key]) return;
    event.preventDefault(); var date = portalCalendarDate(day.dataset.portalCalendarDay); date.setDate(date.getDate() + offsets[event.key]);
    portalCalendarSelect(date); portalRenderAgenda(); portalCalendarFocus();
  });
});
