"use strict";

(function () {
  var model = window.SevenMetroInsights, playerId = 0, reportId = 0, currentTeam = teamId;
  var profileReturn = "v-players", reportReturn = "v-matches", drafts = new Map();
  var pdfFile = null, pdfSequence = 0, pdfTimer = 0, pdfKey = "";
  function syncTeam() {
    if (currentTeam === teamId) return;
    currentTeam = teamId; playerId = 0; reportId = 0; pdfSequence++; pdfFile = null; pdfKey = ""; clearTimeout(pdfTimer);
    $("player-profile-content").innerHTML = ""; $("match-report-content").innerHTML = "";
    $("player-profile-name").textContent = ""; $("player-profile-number").textContent = "";
    $("match-report-notes").value = ""; $("match-report-share").disabled = true; $("match-report-download").disabled = true;
  }
  function data() { return Object.assign({}, tables, { jokalariak: players, partidak: matches, saioak: sessions }); }
  function currentSection() { var section = document.querySelector("#team-app section.on"); return section ? section.id : "v-home"; }
  function percent(value) { return value == null ? "—" : value + "%"; }
  function label(s) { return (s.number ? "#" + s.number + " " : "") + (s.label || t("Jokalaria zehaztu gabe")); }
  function metric(value, title, detail) {
    return '<div class="insight-metric"><strong>' + esc(value) + '</strong><span>' + esc(t(title)) + '</span>' + (detail ? '<small>' + esc(detail) + '</small>' : '') + '</div>';
  }
  function empty(text) { return '<p class="report-empty">' + esc(t(text)) + '</p>'; }
  function card(title, body) { return '<div class="card"><h2>' + esc(t(title)) + '</h2>' + body + '</div>'; }
  function statsTable(list, profiles) {
    if (!list.length) return empty("Ez dago banakako estatistikarik erregistratuta.");
    var headings = ["Jokalaria", "Golak", "Jaurtiketak", "Eraginkortasuna", "7 m", "Horia", "2 min", "Gorria", "Urdina"];
    return '<div class="insight-table-wrap" tabindex="0"><table class="insight-table"><thead><tr>' + headings.map(function (h) { return '<th scope="col">' + esc(t(h)) + '</th>'; }).join('') + '</tr></thead><tbody>' + list.map(function (s) {
      return '<tr><th scope="row">' + (profiles && s.id ? '<button class="btn secondary" type="button" data-player-profile="' + Number(s.id) + '">' + esc(label(s)) + '</button>' : esc(label(s))) + '</th><td>' + s.goals + '</td><td>' + s.shots + '</td><td>' + percent(s.efficiency) + '</td><td>' + s.penaltyGoals + '/' + s.penaltyShots + '</td><td>' + s.sanctions.horia + '</td><td>' + s.sanctions['2min'] + '</td><td>' + s.sanctions.gorria + '</td><td>' + s.sanctions.urdina + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function maps(shots, title) {
    if (!shots.length) return "";
    var circles = function (destination) {
      return shots.map(function (s) {
        var p = destination ? s.to : s.from, x = destination ? 18 + p[0] * 324 : p[0] * 800, y = destination ? 18 + p[1] * 174 : p[1] * 520;
        return '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="' + (destination ? 5 : 11) + '" fill="' + (model.goal(s.type) ? '#20a561' : '#e14353') + '" stroke="white" stroke-width="2"><title>' + esc(t(model.goal(s.type) ? "Gola" : "Jaurtiketa huts")) + ' · ' + s.minute + ' min</title></circle>';
      }).join('');
    };
    return card(title, (shots.length ? '<div class="insight-legend"><span><i style="background:#20a561"></i>' + esc(t("Gola")) + '</span><span><i style="background:#e14353"></i>' + esc(t("Jaurtiketa huts")) + '</span><span>' + shots.length + ' ' + esc(t("kokapen erregistratuta")) + '</span></div>' : empty("Ez dago koordenatudun jaurtiketarik.")) + '<div class="report-map-grid"><div><h3>' + esc(t("Jaurtiketa jatorria")) + '</h3><svg viewBox="0 0 800 520" role="img" aria-label="' + esc(t("Jaurtiketen jatorria zelaiaren irudian")) + '"><image href="./irudiak/Zelai-erdia.png" width="800" height="520" preserveAspectRatio="none" transform="rotate(180 400 260)"/>' + circles(false) + '</svg></div><div><h3>' + esc(t("Helmuga atean")) + '</h3><svg viewBox="0 0 360 210" role="img" aria-label="' + esc(t("Atearen helburu mapa")) + '"><rect width="360" height="210" fill="#26324a"/><path d="M10 10H350V200H10Z M123 10V200 M237 10V200 M10 73H350 M10 137H350" fill="none" stroke="white" stroke-width="2"/>' + circles(true) + '</svg></div></div>');
  }
  function renderProfile() {
    if (!playerId) return;
    var profile = model.profile(playerId, data(), $("player-profile-period").value), body = $("player-profile-content");
    if (!profile) { $("player-profile-name").textContent = t("Jokalaria ez da aurkitu"); body.innerHTML = empty("Birkargatu taldeko jokalarien zerrenda."); return; }
    var p = profile.player, s = profile.totals;
    $("player-profile-name").textContent = playerName(p);
    $("player-profile-number").textContent = p.dortsala == null ? "—" : "#" + p.dortsala;
    $("player-profile-meta").textContent = [t(p.posizioa || "Posiziorik gabe"), t(p.egoera || "")].filter(Boolean).join(" · ");
    var html = '<div class="insight-metrics">' + metric(profile.history.length, "Partidak", t("Datuak dituzten partidak")) + metric(s.goals, "Golak", s.shots + ' ' + t("jaurtiketa")) + metric(percent(s.efficiency), "Eraginkortasuna", s.penaltyGoals + '/' + s.penaltyShots + ' · 7 m') + metric(percent(profile.attendanceRate), "Asistentzia", profile.present + '/' + profile.attendanceCount + ' ' + t("saio")) + '</div>';
    var recent = profile.history.slice(0, 12).reverse(), maximum = Math.max(1, ...recent.map(function (h) { return h.stats.shots; }));
    html += card("Azken partidetako bilakaera", recent.length ? '<div class="insight-legend"><span><i style="background:var(--blue)"></i>' + esc(t("Golak")) + '</span><span><i style="background:var(--bad)"></i>' + esc(t("Huts egindako jaurtiketak")) + '</span></div><div class="insight-trend">' + recent.map(function (h) {
      return '<div class="insight-trend-row" title="' + esc(formatDay(h.match) + ' · ' + (h.match.aurkaria || t("Aurkaria"))) + '"><span>' + esc(formatDay(h.match)) + '</span><div class="insight-trend-track" role="img" aria-label="' + esc(h.stats.goals + '/' + h.stats.shots + ' · ' + percent(h.stats.efficiency)) + '"><i class="goals" style="width:' + h.stats.goals / maximum * 100 + '%"></i><i class="misses" style="width:' + Math.max(0, h.stats.shots - h.stats.goals) / maximum * 100 + '%"></i></div><strong>' + h.stats.goals + '/' + h.stats.shots + '</strong></div>';
    }).join('') + '</div>' : empty("Ez dago partidarik aukeratutako tartean."));
    html += card("Partiden historia", profile.history.length ? '<div class="insight-table-wrap" tabindex="0"><table class="insight-table"><thead><tr>' + ["Partida", "Emaitza", "Golak", "Jaurtiketak", "Eraginkortasuna"].map(function (h) { return '<th scope="col">' + esc(t(h)) + '</th>'; }).join('') + '</tr></thead><tbody>' + profile.history.map(function (h) {
      return '<tr><th scope="row"><button class="insight-name-link" type="button" data-match-report="' + Number(h.match.id_partida) + '">' + esc(h.match.aurkaria || t("Aurkaria")) + '</button>' + '<br><small>' + esc(formatDay(h.match)) + '</small></th><td>' + Number(h.match.emaitza_geurea || 0) + '-' + Number(h.match.emaitza_aurkaria || 0) + '</td><td>' + h.stats.goals + '</td><td>' + h.stats.shots + '</td><td>' + percent(h.stats.efficiency) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : empty("Ez dago partidarik aukeratutako tartean."));
    html += card("Asistentziaren historia", '<div class="insight-legend"><span>' + profile.present + ' ' + esc(t("bertaratze")) + '</span><span>' + profile.absent + ' ' + esc(t("hutsegite")) + '</span><span>' + profile.late + ' ' + esc(t("berandutze")) + '</span></div>' + (profile.attendance.length ? profile.attendance.slice(0, 30).map(function (a) {
      return '<div class="insight-attendance"><div><strong>' + esc(formatDay(a.session)) + '</strong><small>' + esc(a.session.helburu_taktikoa || a.session.lekua || t("Entrenamendua")) + (a.present && a.late ? ' · ' + a.late + ' min · ' + esc(t(a.lateType)) : '') + '</small></div><span class="insight-tag ' + (a.recorded ? a.present ? 'present' : 'absent' : '') + '">' + esc(t(!a.recorded ? "Apuntatu gabe" : a.present ? "Bertaratu da" : "Ez da bertaratu")) + '</span></div>';
    }).join('') : empty("Ez dago saiorik aukeratutako tartean.")));
    html += card("Zigorrak", '<div class="insight-legend">' + model.sanctionTypes.map(function (type) { return '<span>' + esc(scoreActionLabel(type)) + ': <strong>' + s.sanctions[type] + '</strong></span>'; }).join('') + '</div>');
    html += maps(profile.mapped, "Jokalariaren jaurtiketen mapa");
    var details = [["Eskua", t(p.eskua || "")], ["Jaiotze-data", p.jaiotze_data ? formatDay({ data_ordua: p.jaiotze_data }) : ""], ["Altuera (cm)", p.altuera_cm], ["Pisua (kg)", p.pisua_kg], ["Telefonoa", p.telefonoa], ["Emaila", p.emaila], ["Oharrak", p.oharrak]].filter(function (row) { return row[1] != null && row[1] !== ""; });
    if (details.length) html += '<details class="card"><summary><strong>' + esc(t("Jokalariaren datuak")) + '</strong></summary><div class="insight-detail-grid" style="margin-top:16px">' + details.map(function (row) { return '<dl><dt>' + esc(t(row[0])) + '</dt><dd>' + esc(row[1]) + '</dd></dl>'; }).join('') + '</div></details>';
    body.innerHTML = html;
  }
  function reportDraft(match) {
    var key = teamId + ":" + match.id_partida;
    if (!drafts.has(key)) drafts.set(key, { notes: String(match.partida_analisia || ""), expected: match.partida_analisia == null ? null : String(match.partida_analisia), saving: false });
    var draft = drafts.get(key);
    if (!draft.saving && draft.notes === String(draft.expected || "")) {
      draft.expected = match.partida_analisia == null ? null : String(match.partida_analisia); draft.notes = String(draft.expected || "");
    }
    return draft;
  }
  function noteStatus(draft) {
    $("match-report-notes-status").textContent = draft.saving ? t("Gordetzen...") : draft.notes !== String(draft.expected || "") ? t("Gorde gabeko aldaketak") : t("Gordeta");
    $("match-report-save-notes").disabled = draft.saving || draft.notes === String(draft.expected || "");
  }
  function reportData() {
    var match = matches.find(function (m) { return Number(m.id_partida) === reportId; });
    return match ? model.breakdown(match, data()) : null;
  }
  function renderReport() {
    if (!reportId) return;
    var report = reportData();
    if (!report) { $("match-report-content").innerHTML = empty("Ez da taldeko partida aurkitu"); return; }
    var m = report.match, home = report.homeTotal, away = report.awayTotal;
    var homeName = team && team.izena || "7metro", awayName = m.aurkaria || t("Aurkaria"), draft = reportDraft(m);
    var html = '<div class="report-score"><p>' + esc(formatDate(m)) + ' · ' + esc(t(m.lekua || "")) + '</p><div class="report-score-line"><span>' + esc(homeName) + '</span><strong>' + Number(m.emaitza_geurea || 0) + ' - ' + Number(m.emaitza_aurkaria || 0) + '</strong><span>' + esc(awayName) + '</span></div></div>';
    var comparison = [[home.shots, "Erregistratutako jaurtiketak", away.shots], [percent(home.efficiency), "Eraginkortasuna", percent(away.efficiency)], [home.penaltyGoals + '/' + home.penaltyShots, "Penaltiak", away.penaltyGoals + '/' + away.penaltyShots]];
    model.sanctionTypes.forEach(function (type) { comparison.push([home.sanctions[type], scoreActionLabel(type), away.sanctions[type]]); });
    html += card("Taldeen alderaketa", '<div class="report-stat-comparison"><strong>' + esc(homeName) + '</strong><span></span><strong>' + esc(awayName) + '</strong></div>' + comparison.map(function (r) { return '<div class="report-stat-comparison"><strong>' + esc(r[0]) + '</strong><span>' + esc(t(r[1])) + '</span><strong>' + esc(r[2]) + '</strong></div>'; }).join(''));
    html += card("Gure jokalarien estatistikak", statsTable(report.home, true));
    html += card("Aurkariaren jokalarien estatistikak", statsTable(report.away, false));
    html += maps(report.mapped.filter(function (s) { return s.side === "home"; }), "Gure jaurtiketen mapak");
    html += maps(report.mapped.filter(function (s) { return s.side === "away"; }), "Aurkariaren jaurtiketen mapak");
    $("match-report-content").innerHTML = html;
    $("match-report-notes").value = draft.notes; noteStatus(draft); preparePdf(report, draft);
  }
  function preparePdf(report, draft) {
    var key = JSON.stringify([teamId, reportId, I18n.language(), report, draft.notes]);
    if (key === pdfKey && pdfFile) { $("match-report-pdf-status").textContent = t("PDFa prest dago"); return; }
    pdfKey = key; pdfFile = null; clearTimeout(pdfTimer);
    var sequence = ++pdfSequence, language = I18n.language(), dictionary = (window.SevenMetroLocales[language] || {}).messages || {};
    $("match-report-share").disabled = true; $("match-report-download").disabled = true;
    $("match-report-pdf-status").textContent = t("PDFa prestatzen...");
    var options = { teamName: team && team.izena || "7metro", opponentName: report.match.aurkaria || t("Aurkaria"), notes: draft.notes,
      locale: I18n.locale(), t: function (key) { return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : key; } };
    pdfTimer = setTimeout(function () {
      window.SevenMetroReportPdf.build(report, options).then(function (result) {
        if (sequence !== pdfSequence) return;
        pdfFile = new File([result], fileName(report.match), { type: "application/pdf" });
        $("match-report-share").disabled = false; $("match-report-download").disabled = false;
        $("match-report-pdf-status").textContent = t("PDFa prest dago");
      }).catch(function (error) {
        if (sequence !== pdfSequence) return;
        console.error("PDF export failed", error);
        $("match-report-pdf-status").textContent = t("Ezin izan da PDFa prestatu. Sakatu berriro saiatzeko.");
        $("match-report-download").disabled = false;
      });
    }, 250);
  }
  function fileName(match) {
    var rival = String(match.aurkaria || "partida").normalize("NFKD").replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || "partida";
    return '7metro-' + String(match.data_ordua || "").slice(0, 10) + '-' + rival + '.pdf';
  }
  function download(file) {
    file = file || pdfFile;
    if (!file) { pdfKey = ""; var report = reportData(); if (report) preparePdf(report, reportDraft(report.match)); return; }
    var url = URL.createObjectURL(file), a = document.createElement("a");
    a.href = url; a.download = file.name; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }
  async function openReport(id) {
    syncTeam();
    var origin = currentSection();
    var match = ensureMatchStats(Number(id));
    if (!match) return notify(t("Ezin izan da partida aurkitu. Birkargatu zerrenda."), "error");
    if (scoreMatchMode) await scoreExitMatchMode();
    if (origin !== "v-match-report") reportReturn = origin;
    reportId = Number(id); pdfKey = ""; renderReport(); selectSection("v-match-report");
  }
  function openProfile(id) {
    syncTeam();
    if (!players.some(function (p) { return Number(p.id_jokalaria) === Number(id); })) return;
    var origin = currentSection(); if (origin !== "v-player-profile") profileReturn = origin;
    if (playerId !== Number(id)) $("player-profile-period").value = "all";
    playerId = Number(id); renderProfile(); selectSection("v-player-profile");
  }
  document.addEventListener("click", function (event) {
    var button = event.target.closest("button"); if (!button) return;
    if (button.hasAttribute("data-player-profile")) openProfile(button.dataset.playerProfile);
    if (button.hasAttribute("data-match-report")) openReport(button.dataset.matchReport).catch(function (error) { notify(error.message, "error"); });
  });
  $("player-profile-period").addEventListener("change", renderProfile);
  $("player-profile-back").addEventListener("click", function () { selectSection(profileReturn); });
  $("match-report-back").addEventListener("click", function () { selectSection(reportReturn); });
  $("match-report-refresh").addEventListener("click", async function () {
    var report = reportData(); if (!report) return;
    var draft = reportDraft(report.match);
    if (draft.saving || draft.notes !== String(draft.expected || "") && !confirm(t("Gorde gabeko txostenaren oharrak baztertu eta berriro kargatu nahi dituzu?"))) return;
    var id = reportId, originalTeam = teamId, button = this;
    button.disabled = true; $("match-report-notes").readOnly = true;
    try {
      var result = await request({ action: "team_snapshot", team_id: originalTeam });
      if (teamId !== originalTeam || reportId !== id) return;
      var fresh = result.tables && result.tables.partidak && result.tables.partidak.find(function (m) { return Number(m.id_partida) === id; });
      if (!fresh) throw new Error(t("Ez da taldeko partida aurkitu"));
      matches = matches.filter(function (m) { return Number(m.id_partida) !== id; }).concat([fresh]).sort(function (a, b) { return String(b.data_ordua).localeCompare(String(a.data_ordua)); });
      ["partidak", "partida_jokalariak", "partidu_zigorrak", "partidu_jaurtiketak"].forEach(function (table) {
        tables[table] = records(table).filter(function (r) { return Number(r.id_partida) !== id; }).concat((result.tables[table] || []).filter(function (r) { return Number(r.id_partida) === id; }));
      });
      draft.expected = fresh.partida_analisia == null ? null : String(fresh.partida_analisia); draft.notes = String(draft.expected || "");
      renderMatches(); renderDashboard(); renderProfile(); renderReport();
    } catch (error) { notify(error.message, "error"); }
    finally { button.disabled = false; $("match-report-notes").readOnly = false; }
  });
  $("match-report-download").addEventListener("click", function () { download(); });
  $("match-report-share").addEventListener("click", function () {
    if (!pdfFile) return;
    var file = pdfFile;
    var fallback = function () { download(file); notify(t("PDFa deskargatu da. Orain parteka dezakezu."), "success"); };
    try {
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: t("Partidaren txostena") }).catch(function (error) { if (error.name !== "AbortError") fallback(); });
      } else fallback();
    } catch (error) { if (error.name !== "AbortError") fallback(); }
  });
  $("match-report-copy").addEventListener("click", async function () {
    var report = reportData(); if (!report) return;
    var text = ["7metro · " + t("Partidaren txostena"), (team && team.izena || "7metro") + ' ' + Number(report.match.emaitza_geurea || 0) + '-' + Number(report.match.emaitza_aurkaria || 0) + ' ' + (report.match.aurkaria || t("Aurkaria")), formatDate(report.match),
      report.home.filter(function (s) { return s.goals; }).map(function (s) { return label(s) + ': ' + s.goals + ' ' + t("Golak"); }).join('\n'), reportDraft(report.match).notes].filter(Boolean).join('\n\n');
    try { await navigator.clipboard.writeText(text); notify(t("Laburpena kopiatu da"), "success"); }
    catch (error) { notify(t("Ezin izan da laburpena kopiatu"), "error"); }
  });
  $("match-report-notes").addEventListener("input", function () {
    var report = reportData(); if (!report) return;
    var draft = reportDraft(report.match); draft.notes = this.value; noteStatus(draft); preparePdf(report, draft);
  });
  $("match-report-save-notes").addEventListener("click", async function () {
    var report = reportData(); if (!report) return;
    var draft = reportDraft(report.match); if (draft.saving) return;
    var sent = draft.notes, originalTeam = teamId; draft.saving = true; noteStatus(draft);
    try {
      var result = await request({ action: "pwa_update_match_notes", team_id: originalTeam, id: report.match.id_partida, notes: sent, expected_notes: draft.expected });
      if (originalTeam !== teamId) return;
      draft.expected = result.notes; if (draft.notes === sent) draft.notes = String(result.notes || "");
      matches.concat(records("partidak")).forEach(function (m) { if (Number(m.id_partida) === Number(report.match.id_partida)) m.partida_analisia = result.notes; });
      if (scoreboard.savedMatchSnapshot && Number(scoreboard.savedMatchSnapshot.id_partida) === Number(report.match.id_partida)) { scoreboard.savedMatchSnapshot.partida_analisia = result.notes; scoreSave(); }
      notify(t("Oharrak gorde dira"), "success");
    } catch (error) { notify(error.message, "error"); }
    finally { draft.saving = false; if (reportId === Number(report.match.id_partida) && originalTeam === teamId) noteStatus(draft); }
  });
  window.InsightsUI = { openProfile: openProfile, openReport: openReport, refresh: function () {
    syncTeam();
    renderProfile(); renderReport();
  }, statsTable: statsTable };
})();
