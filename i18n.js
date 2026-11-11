"use strict";

(function () {
  var catalogues = window.SevenMetroLocales || {};
  var languages = { eu: { name: "Euskara", locale: "eu-ES", messages: {} } };
  Object.keys(catalogues).forEach(function (code) { languages[code] = catalogues[code]; });
  var language = "eu", textNodes = [], attributes = [];
  try {
    var saved = localStorage.getItem("7metro-language");
    if (Object.prototype.hasOwnProperty.call(languages, saved)) language = saved;
  } catch (error) { /* Language switching also works without local storage. */ }

  function t(source, parameters) {
    if (typeof source !== "string") return source;
    var key = source.trim(), messages = languages[language].messages;
    if (!key) return source;
    var translated = Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : key;
    var result = source.slice(0, source.length - source.trimStart().length) + translated +
      source.slice(source.trimEnd().length);
    if (parameters) result = result.replace(/\{(\w+)\}/g, function (match, name) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : match;
    });
    return result;
  }

  // Only capture the authored shell, before app.js loads any user content.
  // Later render functions explicitly translate their own interface messages.
  var walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    var node = walker.currentNode;
    if (node.nodeValue.trim() && !node.parentElement.closest('script,style,textarea,[translate="no"]')) {
      textNodes.push({ node: node, source: node.nodeValue, last: node.nodeValue });
    }
  }
  document.querySelectorAll("[aria-label],[placeholder],[title],[alt]").forEach(function (element) {
    if (element.closest('[translate="no"]')) return;
    ["aria-label", "placeholder", "title", "alt"].forEach(function (name) {
      if (!element.hasAttribute(name)) return;
      var source = element.getAttribute(name);
      attributes.push({ element: element, name: name, source: source, last: source });
    });
  });

  function applyStatic() {
    document.documentElement.lang = language;
    textNodes.forEach(function (entry) {
      if (!entry.node.isConnected || entry.node.nodeValue !== entry.last) return;
      entry.last = t(entry.source);
      entry.node.nodeValue = entry.last;
    });
    attributes.forEach(function (entry) {
      if (!entry.element.isConnected || entry.element.getAttribute(entry.name) !== entry.last) return;
      entry.last = t(entry.source);
      entry.element.setAttribute(entry.name, entry.last);
    });
    document.querySelectorAll("[data-language-select]").forEach(function (select) { select.value = language; });
  }

  function setLanguage(code) {
    if (!Object.prototype.hasOwnProperty.call(languages, code)) return false;
    if (code === language) return true;
    var previous = language;
    language = code;
    try { localStorage.setItem("7metro-language", code); } catch (error) { /* Optional persistence. */ }
    applyStatic();
    window.dispatchEvent(new CustomEvent("languagechange", { detail: { language: code, previous: previous } }));
    return true;
  }

  window.I18n = {
    t: t, setLanguage: setLanguage,
    serverMessage: function (source) {
      if (language !== "eu" && typeof source === "string") {
        var match = source.match(/^Ezin izan dira (.+) (datuak|aukerak) kargatu$/);
        if (match) return t(match[2] === "datuak" ? "Ezin izan dira {table} datuak kargatu" : "Ezin izan dira {table} aukerak kargatu", { table: match[1] });
      }
      return t(source);
    },
    language: function () { return language; },
    locale: function () { return languages[language].locale; },
    languages: function () { return Object.keys(languages).map(function (code) { return { code: code, name: languages[code].name }; }); }
  };
  document.querySelectorAll("[data-language-select]").forEach(function (select) {
    select.innerHTML = "";
    window.I18n.languages().forEach(function (item) {
      var option = document.createElement("option");
      option.value = item.code; option.textContent = item.name; option.lang = item.code;
      option.translate = false; select.appendChild(option);
    });
    select.addEventListener("change", function () { setLanguage(select.value); });
  });
  applyStatic();
})();
