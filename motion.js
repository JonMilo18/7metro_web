"use strict";

(function () {
  var reduced = matchMedia("(prefers-reduced-motion: reduce)");
  var animations = new Set(), current = new WeakMap(), panels = new WeakMap();
  var buttons = new WeakMap(), gestureButton = null, indicatorFrame = 0;

  function animate(element, frames, duration) {
    if (!element || reduced.matches || !element.animate || !element.getClientRects().length) return null;
    var previous = current.get(element);
    if (previous) previous.cancel();
    var animation = element.animate(frames, { duration: duration || 190, easing: "cubic-bezier(.2,.8,.2,1)" });
    current.set(element, animation); animations.add(animation);
    function cleanup() {
      animations.delete(animation);
      if (current.get(element) === animation) current.delete(element);
    }
    animation.finished.then(cleanup, cleanup);
    return animation;
  }

  function enter(element) {
    animate(element, [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }]);
  }

  function indicator(container) {
    var selected = container.querySelector('[aria-pressed="true"],[aria-selected="true"]');
    if (!selected) return;
    var bounds = container.getBoundingClientRect(), rect = selected.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    container.style.setProperty("--motion-nav-x", (rect.left - bounds.left + container.scrollLeft) + "px");
    container.style.setProperty("--motion-nav-y", (rect.top - bounds.top + container.scrollTop) + "px");
    container.style.setProperty("--motion-nav-width", rect.width + "px");
    container.style.setProperty("--motion-nav-height", rect.height + "px");
    container.dataset.motionReady = "true";
  }

  function updateIndicators() {
    cancelAnimationFrame(indicatorFrame);
    indicatorFrame = requestAnimationFrame(function () {
      document.querySelectorAll(".motion-nav").forEach(indicator);
    });
  }

  function setPanel(element, open, immediate) {
    var previous = panels.get(element), start = element.getBoundingClientRect().height;
    if (previous) previous.animation.cancel();
    var overflow = previous ? previous.overflow : element.style.overflow;
    if (immediate || reduced.matches || !element.animate) {
      panels.delete(element); element.style.overflow = overflow;
      if (element.tagName === "DETAILS") element.open = open;
      else element.hidden = !open;
      return;
    }
    if (element.tagName === "DETAILS") element.open = true;
    else element.hidden = false;
    var end = open ? element.getBoundingClientRect().height :
      element.tagName === "DETAILS" ? element.querySelector("summary").getBoundingClientRect().height +
        parseFloat(getComputedStyle(element).paddingTop) + parseFloat(getComputedStyle(element).paddingBottom) +
        parseFloat(getComputedStyle(element).borderTopWidth) + parseFloat(getComputedStyle(element).borderBottomWidth) : 0;
    element.style.overflow = "hidden";
    var animation = animate(element, [{ height: start + "px" }, { height: end + "px" }], 200);
    if (!animation) {
      element.style.overflow = overflow;
      if (element.tagName === "DETAILS") element.open = open;
      else element.hidden = !open;
      return;
    }
    var state = { animation: animation, open: open, overflow: overflow };
    panels.set(element, state);
    function finish() {
      if (panels.get(element) !== state) return;
      panels.delete(element); element.style.overflow = overflow;
      if (element.tagName === "DETAILS") element.open = open;
      else element.hidden = !open;
    }
    animation.finished.then(finish, finish);
  }

  function isOpen(element) {
    var pending = panels.get(element);
    return pending ? pending.open : element.tagName === "DETAILS" ? element.open : !element.hidden;
  }

  document.addEventListener("click", function (event) {
    var button = event.target.closest("button");
    gestureButton = button;
    setTimeout(function () { if (gestureButton === button) gestureButton = null; }, 0);
    var summary = event.target.closest("summary");
    if (!summary || event.target.closest("button,a,input,select,textarea") || event.defaultPrevented || reduced.matches) return;
    var details = summary.parentElement;
    if (details.tagName !== "DETAILS") return;
    event.preventDefault();
    setPanel(details, !isOpen(details));
  }, true);

  document.addEventListener("submit", function (event) {
    var button = event.submitter || event.target.querySelector('[type="submit"]');
    gestureButton = button;
    setTimeout(function () { if (gestureButton === button) gestureButton = null; }, 0);
  }, true);

  function saving(action) {
    if (!/(?:create|update|save|duplicate|publish|respond)/.test(String(action)) || action === "pwa_save_attendance") return null;
    var button = gestureButton || (document.activeElement && document.activeElement.closest("button"));
    if (!button || !button.classList.contains("btn")) return null;
    var state = buttons.get(button) || { count: 0, failed: false, timer: 0 };
    clearTimeout(state.timer);
    if (!state.count) state.failed = false;
    state.count++; buttons.set(button, state);
    button.classList.remove("motion-saved"); button.classList.add("motion-saving");
    return function (success) {
      state.failed = state.failed || !success;
      state.count--;
      if (state.count) return;
      button.classList.remove("motion-saving");
      if (!state.failed) button.classList.add("motion-saved");
      state.timer = setTimeout(function () { button.classList.remove("motion-saved"); buttons.delete(button); }, 1200);
    };
  }

  function touch(canvas, event) {
    if (reduced.matches) return;
    var ring = document.createElement("span");
    ring.className = "motion-touch"; ring.setAttribute("aria-hidden", "true");
    ring.style.left = event.clientX + "px"; ring.style.top = event.clientY + "px";
    (canvas.closest("dialog") || document.body).appendChild(ring);
    var animation = animate(ring, [
      { opacity: .9, transform: "translate(-50%,-50%) scale(.5)" },
      { opacity: 0, transform: "translate(-50%,-50%) scale(1.8)" }
    ], 240);
    if (animation) animation.finished.then(function () { ring.remove(); }, function () { ring.remove(); });
    else ring.remove();
  }

  function pulse(element) {
    animate(element, [{ boxShadow: "0 0 0 4px rgba(0,68,238,.5)" }, { boxShadow: "0 0 0 10px rgba(0,68,238,0)" }], 220);
  }

  var observer = new MutationObserver(function (changes) {
    var navigationChanged = false;
    changes.forEach(function (change) {
      var element = change.target;
      if (element.tagName === "DIALOG" && change.attributeName === "open" && element.open) {
        if (element.id === "board-fullscreen-dialog") animate(element, [{ opacity: 0 }, { opacity: 1 }]);
        else animate(element, [
          { opacity: 0, transform: "translateY(" + (matchMedia("(max-width:767px)").matches ? 28 : 14) + "px) scale(.99)" },
          { opacity: 1, transform: "translateY(0) scale(1)" }
        ], 200);
      }
      if (change.attributeName === "aria-pressed" || change.attributeName === "aria-selected") {
        if (element.closest(".motion-nav")) navigationChanged = true;
        if (element.matches('.motion-nav button[aria-pressed="true"],.motion-nav button[aria-selected="true"]') && change.oldValue !== "true") {
          animate(element.querySelector("svg"), [{ transform: "scale(.9)" }, { transform: "scale(1.08)", offset: .6 }, { transform: "scale(1)" }], 220);
        }
      }
    });
    if (navigationChanged) updateIndicators();
  });
  observer.observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["open", "aria-pressed", "aria-selected"] });
  var resize = new ResizeObserver(updateIndicators);
  document.querySelectorAll(".portal-tabs,#nav>div").forEach(function (container) {
    container.classList.add("motion-nav"); resize.observe(container);
    container.querySelectorAll("button").forEach(function (button) { resize.observe(button); });
  });
  window.addEventListener("languagechange", updateIndicators);
  reduced.addEventListener("change", function () {
    if (reduced.matches) animations.forEach(function (animation) { animation.cancel(); });
    updateIndicators();
  });
  updateIndicators();
  window.AppMotion = { enter: enter, reveal: setPanel, isOpen: isOpen, saving: saving, touch: touch, pulse: pulse };
})();
