"use strict";
(function (root) {
  function separator(row) { return row.is_separator === true || row.id_ariketa == null; }
  function linked(previous, row) {
    return previous && !separator(previous) && !separator(row) &&
      String(previous.taldea || "") === String(row.taldea || "") && (row.paraleloa === true || Number(row.paraleloa) === 1);
  }
  function blocks(rows) {
    var result = [], previous = null, block = null, elapsed = 0;
    (rows || []).forEach(function (row) {
      if (separator(row)) { previous = null; block = null; return; }
      var minutes = Math.max(0, Number(row.iraupena_minutuak) || 0);
      if (!block || !linked(previous, row)) {
        block = { entries: [], minutes: 0, start: elapsed, end: elapsed }; result.push(block);
      }
      block.entries.push(row); block.minutes = Math.max(block.minutes, minutes);
      block.end = block.start + block.minutes; elapsed = block.end; previous = row;
    });
    return result;
  }
  function duration(rows) { var list = blocks(rows); return list.length ? list[list.length - 1].end : 0; }
  function normalize(rows) {
    var previous = null;
    rows.forEach(function (row) { if (!linked(previous, row)) row.paraleloa = 0; previous = row; });
    return rows;
  }
  var api = { blocks: blocks, duration: duration, normalize: normalize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TrainingTime = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
