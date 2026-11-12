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
    assets = Promise.all([library, font("NotoSans-Regular.ttf"), font("NotoSans-Bold.ttf"), court]).catch(function (error) { assets = null; throw error; });
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
    var doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
    doc.addFileToVFS("NotoSans-Regular.ttf", loaded[1]); doc.addFont("NotoSans-Regular.ttf", "Noto", "normal");
    doc.addFileToVFS("NotoSans-Bold.ttf", loaded[2]); doc.addFont("NotoSans-Bold.ttf", "Noto", "bold");
    var normal = function (size, color) { doc.setFont("Noto", "normal"); doc.setFontSize(size || 9); doc.setTextColor.apply(doc, color || [34, 45, 62]); };
    var bold = function (size, color) { doc.setFont("Noto", "bold"); doc.setFontSize(size || 10); doc.setTextColor.apply(doc, color || [17, 33, 59]); };
    var clean = function (value) { return String(value == null ? "" : value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/[\u2010-\u2015\u2212]/g, "-"); };
    function header() {
      doc.setFillColor(0, 68, 238); doc.rect(0, 0, 210, 24, "F");
      bold(18, [255, 255, 255]); doc.text("7metro", margin, 15);
      normal(9, [255, 255, 255]); doc.text(clean(t("Partidaren txostena")), 196, 14, { align: "right" });
      y = 35;
    }
    function page() { doc.addPage(); header(); }
    function space(height) { if (y + height > 278) page(); }
    function paragraph(text, size, maxWidth, indent) {
      normal(size || 9); var lines = doc.splitTextToSize(clean(text), maxWidth || width), lineHeight = (size || 9) * .48;
      lines.forEach(function (line) { space(lineHeight + 1); normal(size || 9); doc.text(line, margin + (indent || 0), y); y += lineHeight; }); y += 3;
    }
    function title(text) { space(15); bold(12); doc.text(clean(t(text)), margin, y); y += 8; }
    function percentage(value) { return value == null ? "-" : value + "%"; }
    function playerLabel(s) { return (s.number ? "#" + s.number + " " : "") + (s.label || t("Jokalaria zehaztu gabe")); }
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
      space(headerHeight + firstHeight + (sectionTitle ? 8 : 0)); if (sectionTitle) title(sectionTitle); heading();
      rows.forEach(function (row, index) {
        normal(8); var cells = row.map(function (value, i) { return doc.splitTextToSize(clean(value), widths[i] - 3); });
        var height = Math.max(9, ...cells.map(function (c) { return c.length * 4 + 4; }));
        if (y + height > 278) { page(); heading(); }
        if (index % 2 === 0) { doc.setFillColor(247, 249, 252); doc.rect(margin, y, width, height, "F"); }
        normal(8); var x = margin;
        cells.forEach(function (lines, i) { doc.text(lines, x + 1.5, y + 5, { lineHeightFactor: 1.4 }); x += widths[i]; });
        doc.setDrawColor(223, 229, 237); doc.line(margin, y + height, margin + width, y + height); y += height;
      }); y += 7;
    }
    header();
    var m = report.match, date = new Date(String(m.data_ordua || "").replace(" ", "T"));
    var dateText = m.data_ordua;
    if (Number.isFinite(date.getTime())) {
      // Some mobile browsers ship without Basque ICU data; keep that date numeric.
      dateText = options.locale.indexOf("eu") === 0 ? String(m.data_ordua).replace("T", " · ").slice(0, 21) : date.toLocaleString(options.locale, { dateStyle: "long", timeStyle: "short" });
    }
    paragraph(dateText, 9);
    paragraph(["Etxean", "Kanpoan"].includes(m.lekua) ? t(m.lekua) : m.lekua || "", 9);
    bold(14); var ownLines = doc.splitTextToSize(clean(options.teamName), 68), awayLines = doc.splitTextToSize(clean(options.opponentName), 68);
    var scoreHeight = Math.max(28, Math.max(ownLines.length, awayLines.length) * 6 + 14);
    doc.setFillColor(239, 244, 255); doc.roundedRect(margin, y, width, scoreHeight, 3, 3, "F");
    doc.text(ownLines, margin + 5, y + 12, { maxWidth: 68 }); doc.text(awayLines, 191, y + 12, { align: "right", maxWidth: 68 });
    bold(22, [0, 68, 238]); doc.text(Number(m.emaitza_geurea || 0) + " - " + Number(m.emaitza_aurkaria || 0), 105, y + scoreHeight / 2 + 3, { align: "center" });
    y += scoreHeight + 11;
    var own = report.homeTotal, away = report.awayTotal;
    var comparisons = [[t("Erregistratutako jaurtiketak"), own.shots, away.shots], [t("Eraginkortasuna"), percentage(own.efficiency), percentage(away.efficiency)], [t("Penaltiak"), own.penaltyGoals + "/" + own.penaltyShots, away.penaltyGoals + "/" + away.penaltyShots]];
    [["horia", "Horia"], ["2min", "2 min"], ["gorria", "Gorria"], ["urdina", "Urdina"]].forEach(function (entry) { comparisons.push([t(entry[1]), own.sanctions[entry[0]], away.sanctions[entry[0]]]); });
    table(["", options.teamName, options.opponentName], comparisons, [82, 50, 50], "Taldeen alderaketa");
    paragraph(t("Banakako estatistikek erregistratutako ekintzak biltzen dituzte. Mapetan kokapena duten jaurtiketak bakarrik agertzen dira."), 8);
    var headings = ["Jokalaria", "Golak", "Jaurtiketak", "%", "7 m", "Horia", "2 min", "Gorria", "Urdina"].map(t);
    function playerRows(list) { return list.map(function (s) { return [playerLabel(s), s.goals, s.shots, percentage(s.efficiency), s.penaltyGoals + "/" + s.penaltyShots, s.sanctions.horia, s.sanctions['2min'], s.sanctions.gorria, s.sanctions.urdina]; }); }
    table(headings, playerRows(report.home), [57, 15, 22, 15, 19, 14, 13, 14, 13], "Gure jokalarien estatistikak");
    table(headings, playerRows(report.away), [57, 15, 22, 15, 19, 14, 13, 14, 13], "Aurkariaren jokalarien estatistikak");
    [["home", "Gure jaurtiketen mapak"], ["away", "Aurkariaren jaurtiketen mapak"]].forEach(function (entry) {
      var shots = report.mapped.filter(function (s) { return s.side === entry[0]; });
      space(92); title(entry[1]);
      if (!shots.length) { paragraph(t("Ez dago koordenatudun jaurtiketarik."), 8); return; }
      paragraph(shots.length + " " + t("kokapen erregistratuta") + " · " + t("Berdea: gola. Gorria: jaurtiketa huts."), 8);
      normal(8); doc.text(clean(t("Jaurtiketa jatorria")), margin, y); doc.text(clean(t("Helmuga atean")), 110, y); y += 3;
      doc.addImage(mapImage(shots, false, loaded[3]), "PNG", margin, y, 88, 57.2);
      doc.addImage(mapImage(shots, true, loaded[3]), "PNG", 110, y, 86, 50.2); y += 64;
    });
    if (options.notes.trim()) { title("Entrenatzailearen oharrak"); paragraph(options.notes, 9); }
    var pages = doc.getNumberOfPages();
    for (var i = 1; i <= pages; i++) {
      doc.setPage(i); normal(7.5, [105, 117, 137]); doc.setDrawColor(223, 229, 237); doc.line(margin, 284, 196, 284);
      doc.text("7metro", margin, 290); doc.text(i + " / " + pages, 196, 290, { align: "right" });
    }
    doc.setProperties({ title: clean(t("Partidaren txostena") + " · " + options.teamName + " - " + options.opponentName), author: "7metro", creator: "7metro" });
    return doc.output("arraybuffer");
  }
  window.SevenMetroReportPdf = { build: build };
})();
