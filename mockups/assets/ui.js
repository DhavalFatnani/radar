/* ============================================================================
   Radar — UI behaviors (shared by every screen)
   Theme/mode persistence, deliberate approval motion, toggles, score rings,
   toasts, mobile rail. Optimistic & keyboard-friendly (spec §6).
   ========================================================================== */
(function () {
  const root = document.documentElement;
  const store = {
    get theme() { return localStorage.getItem("radar.theme") || "slate"; },
    set theme(v) { localStorage.setItem("radar.theme", v); },
    get mode() { return localStorage.getItem("radar.mode") || "light"; },
    set mode(v) { localStorage.setItem("radar.mode", v); },
  };

  // deep-link override: ?theme=slate|paper|observatory&mode=light|dark
  try {
    const p = new URLSearchParams(location.search);
    if (["slate", "paper", "observatory"].includes(p.get("theme"))) store.theme = p.get("theme");
    if (["light", "dark"].includes(p.get("mode"))) store.mode = p.get("mode");
  } catch (e) { /* file:// without query — ignore */ }

  function applyTheme() {
    root.setAttribute("data-theme", store.theme);
    root.setAttribute("data-mode", store.mode);
    document.querySelectorAll("[data-set-theme]").forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.setTheme === store.theme));
    document.querySelectorAll("[data-set-mode]").forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.setMode === store.mode));
    document.querySelectorAll("[data-mode-icon]").forEach((el) =>
      el.dataset.modeIcon = store.mode);
  }

  function toast(msg) {
    let wrap = document.querySelector(".toast-wrap");
    if (!wrap) { wrap = document.createElement("div"); wrap.className = "toast-wrap"; document.body.appendChild(wrap); }
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M20 6 9 17l-5-5"/></svg><span>${msg}</span>`;
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .25s"; setTimeout(() => t.remove(), 260); }, 2200);
  }
  window.radarToast = toast;

  // ---- Score rings: fill conic gradient from data-score ----
  function paintScores(scope) {
    (scope || document).querySelectorAll(".score[data-score] .ring").forEach((ring) => {
      const score = +ring.closest(".score").dataset.score || 0;
      ring.style.setProperty("--p", score);
    });
  }
  window.radarPaintScores = paintScores;

  // ---- Wire everything on a (re)render ----
  function wire(scope) {
    const el = scope || document;

    // theme / mode segmented controls
    el.querySelectorAll("[data-set-theme]").forEach((b) => b.addEventListener("click", () => { store.theme = b.dataset.setTheme; applyTheme(); }));
    el.querySelectorAll("[data-set-mode]").forEach((b) => b.addEventListener("click", () => { store.mode = b.dataset.setMode; applyTheme(); }));
    el.querySelectorAll("[data-toggle-mode]").forEach((b) => b.addEventListener("click", () => { store.mode = store.mode === "dark" ? "light" : "dark"; applyTheme(); }));

    // approval control — deliberate, confirms with motion, swaps badge
    el.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.done) return;
        btn.dataset.done = "1";
        btn.classList.add("confirming");
        const target = document.getElementById(btn.dataset.approve);
        if (target) {
          target.className = "badge badge-approved swap-in";
          target.innerHTML = "approved";
        }
        const label = btn.dataset.label || "Signal approved";
        toast(label);
        btn.disabled = true; btn.style.opacity = ".6";
        const reject = btn.parentElement.querySelector("[data-reject]");
        if (reject) reject.style.display = "none";
        setTimeout(() => btn.classList.remove("confirming"), 400);
      });
    });

    // toggle controls (bundling mode, outreach mode)
    el.querySelectorAll("[data-toggle]").forEach((tg) => {
      tg.addEventListener("click", () => {
        const on = tg.getAttribute("aria-checked") === "true";
        tg.setAttribute("aria-checked", String(!on));
        const labels = tg.querySelector(".labels .state");
        if (labels && tg.dataset.on && tg.dataset.off) labels.textContent = !on ? tg.dataset.on : tg.dataset.off;
        if (tg.dataset.toastOn && tg.dataset.toastOff) toast(!on ? tg.dataset.toastOn : tg.dataset.toastOff);
      });
    });

    // mobile rail
    el.querySelectorAll("[data-rail-toggle]").forEach((b) => b.addEventListener("click", () => {
      const app = document.querySelector(".app");
      app.dataset.rail = app.dataset.rail === "open" ? "closed" : "open";
    }));

    paintScores(el);
  }
  window.radarWire = wire;

  // keyboard: shift+D flips light/dark (power-user comfort, spec §6)
  document.addEventListener("keydown", (e) => {
    if (e.shiftKey && (e.key === "D" || e.key === "d") && !/input|textarea/i.test(e.target.tagName)) {
      store.mode = store.mode === "dark" ? "light" : "dark"; applyTheme();
    }
  });

  document.addEventListener("DOMContentLoaded", () => { applyTheme(); wire(document); });
  applyTheme(); // apply ASAP to avoid flash
})();
