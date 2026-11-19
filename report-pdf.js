"use strict";

(function () {
  var assets = null;
  function binary(buffer) {
    var bytes = new Uint8Array(buffer), text = "";
    for (var i = 0; i < bytes.length; i += 8192) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(text);
  }
  function loadAssets() {
    if (assets) return assets;
    var library = window.jspdf ? Promise.resolve() : new Promise(function (resolve, reject) {
      var script = document.createElement("script"); script.src = "./vendor/jspdf.umd.min.js";
      script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
    });
    var font = function (name) { return fetch("./vendor/fonts/" + name).then(function (r) { if (!r.ok) throw new Error("Font unavailable"); return r.arrayBuffer(); }).then(binary); };
    var court = new Promise(function (resolve, reject) { var image = new Image(); image.onload = function () { resolve(image); }; image.onerror = reject; image.src = "./irudiak/Zelai-erdia.png"; });
    var logo = new Promise(function (resolve, reject) {
      var image = new Image(); image.onerror = reject;
      image.onload = function () {
        try {
          var canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          canvas.getContext("2d").drawImage(image, 0, 0); resolve(canvas.toDataURL("image/png"));
        } catch (error) { reject(error); }
      };
      image.src = "./irudiak/logo_nagusia_argia.png";
    });
    assets = Promise.all([library, font("NotoSans-Regular.ttf"), font("NotoSans-Bold.ttf"), court, logo]).catch(function (error) { assets = null; throw error; });
    return assets;
  }
  function mapImage(shots, goal, court) {
    var canvas = document.createElement("canvas"), w = goal ? 720 : 1200, h = goal ? 420 : 780;
    canvas.width = w; canvas.height = h; var ctx = canvas.getContext("2d");
    if (goal) {
      ctx.fillStyle = "#26324a"; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = "white"; ctx.lineWidth = 4;
      ctx.strokeRect(20, 20, w - 40, h - 40);
      [246, 474].forEach(function (x) { ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, h - 20); ctx.stroke(); });
      [146, 274].forEach(function (y) { ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(w - 20, y); ctx.stroke(); });
    } else { ctx.save(); ctx.translate(w, h); ctx.rotate(Math.PI); ctx.drawImage(court, 0, 0, w, h); ctx.restore(); }
    shots.forEach(function (s) {
      var p = goal ? s.to : s.from;
      var x = goal ? 36 + p[0] * 648 : p[0] * w, y = goal ? 36 + p[1] * 348 : p[1] * h;
      ctx.beginPath(); ctx.arc(x, y, goal ? 10 : 17, 0, Math.PI * 2);
      ctx.fillStyle = /gol$/.test(s.type) ? "#159358" : "#dc3349"; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = "white"; ctx.stroke();
    });
    return canvas.toDataURL("image/png");
  }
  async function build(report, options) {
    var loaded = await loadAssets(), t = options.t, width = 182, margin = 14, y = 36;
    var statistics = options.statistics || null;
    var documentTitle = statistics ? statistics.title : t("Partidaren txostena");
    var doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
    doc.addFileToVFS("NotoSans-Regular.ttf", loaded[1]); doc.addFont("NotoSans-Regular.ttf", "Noto", "normal");
    doc.addFileToVFS("NotoSans-Bold.ttf", loaded[2]); doc.addFont("NotoSans-Bold.ttf", "Noto", "bold");
    var normal = function (size, color) { doc.setFont("Noto", "normal"); doc.setFontSize(size || 9); doc.setTextColor.apply(doc, color || [34, 45, 62]); };
    var bold = function (size, color) { doc.setFont("Noto", "bold"); doc.setFontSize(size || 10); doc.setTextColor.apply(doc, color || [17, 33, 59]); };
    var clean = function (value) { return String(value == null ? "" : value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/[\u2010-\u2015\u2212]/g, "-"); };
    function header() {
      doc.setFillColor(0, 68, 238); doc.rect(0, 0, 210, 2, "F");
      doc.addImage(loaded[4], "PNG", 12, 4, 24 * 415 / 314, 24, "7metro-logo");
      bold(17); doc.text("7metro", 48, 15);
      normal(7.5, [105, 117, 137]); doc.text(clean(t("Eskubaloiaren kudeaketa")), 48, 21);
      bold(9, [0, 68, 238]); doc.text(doc.splitTextToSize(clean(documentTitle), 76), 196, 14, { align: "right" });
      doc.setDrawColor(223, 229, 237); doc.line(margin, 31, 196, 31);
      y = 41;
    }
    function page() { doc.addPage(); header(); }
    function space(height) { if (y + height > 278) page(); }
    function paragraph(text, size, maxWidth, indent) {
      normal(size || 9); var lines = doc.splitTextToSize(clean(text), maxWidth || width), lineHeight = (size || 9) * .48;
      lines.forEach(function (line) { space(lineHeight + 1); normal(size || 9); doc.text(line, margin + (indent || 0), y); y += lineHeight; }); y += 3;
    }
    function title(text) {
      var lines; bold(11.5); lines = doc.splitTextToSize(clean(t(text)), width - 6);
      space(lines.length * 5.5 + 7);
      doc.setFillColor(0, 68, 238); doc.roundedRect(margin, y - 3.5, 1.2, 4.5, .5, .5, "F");
      bold(11.5); doc.text(lines, margin + 5, y, { lineHeightFactor: 1.35 }); y += lines.length * 5.5 + 3;
    }
    function percentage(value) { return value == null ? "-" : value + "%"; }
    function playerLabel(s) { return (s.number != null && String(s.number) !== "" ? "#" + s.number + " " : "") + (s.label || t("Jokalaria zehaztu gabe")); }
    function table(headings, rows, widths, sectionTitle) {
      if (!rows.length) { if (sectionTitle) title(sectionTitle); paragraph(t("Ez dago banakako estatistikarik erregistratuta.")); return; }
      bold(7.2);
      var headerLines = headings.map(function (h, i) { return doc.splitTextToSize(clean(h), widths[i] - 3); });
      var headerHeight = Math.max(10, ...headerLines.map(function (lines) { return lines.length * 3.5 + 4; }));
      function heading() {
        doc.setFillColor(234, 240, 250); doc.rect(margin, y, width, headerHeight, "F"); bold(7.2);
        var x = margin;
        headerLines.forEach(function (lines, i) { doc.text(lines, x + 1.5, y + 4, { maxWidth: widths[i] - 3 }); x += widths[i]; }); y += headerHeight;
      }
      normal(8);
      var firstHeight = Math.max(9, ...rows[0].map(function (v, i) { return doc.splitTextToSize(clean(v), widths[i] - 3).length * 4 + 4; }));
      space(headerHeight + Math.min(firstHeight, 40) + (sectionTitle ? 14 : 0)); if (sectionTitle) title(sectionTitle); heading();
      rows.forEach(function (row, index) {
        normal(8); var cells = row.map(function (value, i) { return doc.splitTextToSize(clean(value), widths[i] - 3); });
        var remaining = Math.max.apply(Math, cells.map(function (c) { return c.length; }));
        if (y + Math.min(remaining * 4 + 4, 40) > 278) { page(); heading(); }
        while (remaining > 0) {
          var capacity = Math.floor((278 - y - 4) / 4);
          if (capacity < 1) { page(); heading(); continue; }
          var take = Math.min(remaining, capacity), height = Math.max(9, take * 4 + 4);
          if (index % 2 === 0) { doc.setFillColor(247, 249, 252); doc.rect(margin, y, width, height, "F"); }
          normal(8); var x = margin;
          cells.forEach(function (lines, i) { var chunk = lines.splice(0, take); if (chunk.length) doc.text(chunk, x + 1.5, y + 5, { lineHeightFactor: 1.4 }); x += widths[i]; });
          doc.setDrawColor(223, 229, 237); doc.line(margin, y + height, margin + width, y + height); y += height;
          remaining = Math.max.apply(Math, cells.map(function (c) { return c.length; }));
          if (remaining) { page(); heading(); }
        }
      }); y += 7;
    }
    function maps(shots, label) {
      var from = shots.filter(function (shot) { return shot.from; }), to = shots.filter(function (shot) { return shot.to; });
      if (!from.length && !to.length) return;
      var both = from.length && to.length;
      space(both ? 92 : 108); title(label);
      paragraph(t("Berdea: gola. Gorria: jaurtiketa huts."), 8);
      normal(8);
      if (from.length) {
        doc.text(clean(t("Jaurtiketa jatorria")), margin, y);
        doc.addImage(mapImage(from, false, loaded[3]), "PNG", margin, y + 3, both ? 88 : 120, both ? 57.2 : 78);
      }
      if (to.length) {
        var x = both ? 110 : margin;
        doc.text(clean(t("Helmuga atean")), x, y);
        doc.addImage(mapImage(to, true, loaded[3]), "PNG", x, y + 3, both ? 86 : 110, both ? 50.2 : 64.2);
      }
      y += both ? 67 : from.length ? 88 : 74;
    }
    function finish() {
      var pages = doc.getNumberOfPages();
      for (var i = 1; i <= pages; i++) {
        doc.setPage(i); normal(7.5, [105, 117, 137]); doc.setDrawColor(223, 229, 237); doc.line(margin, 284, 196, 284);
        doc.setFillColor(0, 68, 238); doc.rect(margin, 284, 16, .6, "F");
        doc.text("7metro · " + clean(t("Taldearen txostena")), margin, 290); doc.text(i + " / " + pages, 196, 290, { align: "right" });
      }
      doc.setProperties({ title: clean(documentTitle + " · " + options.teamName), author: "7metro", creator: "7metro" });
      return doc.output("arraybuffer");
    }
    header();
    if (statistics) {
      title(statistics.title); paragraph(options.teamName, 12);
      if (statistics.subtitle) paragraph(statistics.subtitle, 10);
      paragraph(t("Iragazkiak") + ': ' + statistics.filters.join(' · '), 8);
      paragraph(t("Sortua") + ': ' + new Date().toLocaleDateString(options.locale.indexOf('eu') === 0 ? 'en-GB' : options.locale), 8);
      var metrics = statistics.metrics || [];
      for (var start = 0; start < metrics.length; start += 3) {
        var group = metrics.slice(start, start + 3), cardWidth = (width - 10) / 3;
        var height = Math.max.apply(Math, group.map(function (metric) {
          normal(8); return 19 + doc.splitTextToSize(clean(metric.label), cardWidth - 8).length * 4 + doc.splitTextToSize(clean(metric.detail), cardWidth - 8).length * 3.6;
        }));
        space(height + 5);
        group.forEach(function (metric, index) {
          var x = margin + index * (cardWidth + 5);
          doc.setFillColor(239, 244, 255); doc.roundedRect(x, y, cardWidth, height, 2, 2, "F");
          bold(17, [0, 68, 238]); doc.text(clean(metric.value), x + 4, y + 9);
          bold(8); var labels = doc.splitTextToSize(clean(metric.label), cardWidth - 8); doc.text(labels, x + 4, y + 16);
          normal(7); doc.text(doc.splitTextToSize(clean(metric.detail), cardWidth - 8), x + 4, y + 18 + labels.length * 4);
        }); y += height + 5;
      }
      (statistics.sections || []).forEach(function (section) { table(section.headings, section.rows, section.widths, section.title); });
      maps(statistics.mapped || [], t("Jaurtiketen mapa eta zonak"));
      if (statistics.note) paragraph(statistics.note, 8);
      return finish();
    }
    var m = report.match, date = new Date(String(m.data_ordua || "").replace(" ", "T"));
    var dateText = m.data_ordua;
    if (Number.isFinite(date.getTime())) {
      // Some mobile browsers ship without Basque ICU data; keep that date numeric.
      dateText = options.locale.indexOf("eu") === 0 ? String(m.data_ordua).replace("T", " · ").slice(0, 21) : date.toLocaleString(options.locale, { dateStyle: "long", timeStyle: "short" });
    }
    paragraph(dateText, 9);
    paragraph(["Etxean", "Kanpoan"].includes(m.lekua) ? t(m.lekua) : m.lekua || "", 9);
    bold(12); var ownLines = doc.splitTextToSize(clean(options.teamName), 80), awayLines = doc.splitTextToSize(clean(options.opponentName), 80);
    var scoreHeight = Math.max(42, Math.max(ownLines.length, awayLines.length) * 5.5 + 27);
    space(scoreHeight + 4);
    doc.setFillColor(239, 244, 255); doc.roundedRect(margin, y, width, scoreHeight, 3, 3, "F");
    bold(12); doc.text(ownLines, margin + 5, y + 9, { maxWidth: 80 }); doc.text(awayLines, 191, y + 9, { align: "right", maxWidth: 80 });
    bold(25, [0, 68, 238]); doc.text(Number(m.emaitza_geurea || 0) + " - " + Number(m.emaitza_aurkaria || 0), 105, y + scoreHeight - 8, { align: "center" });
    y += scoreHeight + 11;
    var own = report.homeTotal, away = report.awayTotal;
    var comparisons = [[t("Erregistratutako jaurtiketak"), own.shots, away.shots], [t("Eraginkortasuna"), percentage(own.efficiency), percentage(away.efficiency)], [t("Penaltiak"), own.penaltyGoals + "/" + own.penaltyShots, away.penaltyGoals + "/" + away.penaltyShots]];
    [["horia", "Horia"], ["2min", "2 min"], ["gorria", "Gorria"], ["urdina", "Urdina"]].forEach(function (entry) { comparisons.push([t(entry[1]), own.sanctions[entry[0]], away.sanctions[entry[0]]]); });
    table(["", t("Gure taldea"), t("Aurkaria")], comparisons, [82, 50, 50], "Taldeen alderaketa");
    paragraph(t("Banakako estatistikek erregistratutako ekintzak biltzen dituzte. Mapetan kokapena duten jaurtiketak bakarrik agertzen dira."), 8);
    var headings = ["Jokalaria", "Golak", "Jaurtiketak", "%", "7 m", "Horia", "2 min", "Gorria", "Urdina"].map(t);
    function playerRows(list) { return list.map(function (s) { return [playerLabel(s), s.goals, s.shots, percentage(s.efficiency), s.penaltyGoals + "/" + s.penaltyShots, s.sanctions.horia, s.sanctions['2min'], s.sanctions.gorria, s.sanctions.urdina]; }); }
    table(headings, playerRows(report.home), [57, 15, 22, 15, 19, 14, 13, 14, 13], "Gure jokalarien estatistikak");
    table(headings, playerRows(report.away), [57, 15, 22, 15, 19, 14, 13, 14, 13], "Aurkariaren jokalarien estatistikak");
    [["home", "Gure jaurtiketen mapak"], ["away", "Aurkariaren jaurtiketen mapak"]].forEach(function (entry) {
      var shots = report.mapped.filter(function (s) { return s.side === entry[0]; });
      maps(shots, entry[1]);
    });
    if ((options.notes || '').trim()) { title("Entrenatzailearen oharrak"); paragraph(options.notes, 9); }
    return finish();
  }
  window.SevenMetroReportPdf = { build: build, buildStatistics: function (snapshot, options) { return build(null, Object.assign({}, options, { statistics: snapshot })); } };
})();
