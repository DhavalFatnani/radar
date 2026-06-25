/* ============================================================================
   Radar v2 — motion engine (shared)
   FLIP reordering, staggered reveal-on-scroll, animated count-up.
   All no-ops under prefers-reduced-motion.
   Exposes window.radarMotion { reveal, flip, countUp, wireReveals }.
   ========================================================================== */
(function () {
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Staggered reveal: any .reveal / [data-stagger] animates in on view ---
  function wireReveals(scope) {
    const root = scope || document;
    const targets = [];
    root.querySelectorAll(".reveal, .reveal-fade, .reveal-scale").forEach((el) => targets.push(el));
    root.querySelectorAll("[data-stagger]").forEach((group) => {
      const step = +group.dataset.stagger || 45;
      Array.from(group.children).forEach((child, i) => { child.style.animationDelay = `${i * step}ms`; targets.push(child); });
    });
    if (reduce) { targets.forEach((el) => el.classList.add("is-in")); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { threshold: 0.08, rootMargin: "0px 0px -8% 0px" });
    targets.forEach((el) => io.observe(el));
  }

  // ---- FLIP: call before mutating the DOM order, then after ---------------
  function flip(container, mutate) {
    if (reduce || !container) { mutate(); return; }
    const kids = Array.from(container.children);
    const first = new Map(kids.map((k) => [k, k.getBoundingClientRect()]));
    mutate();
    const now = Array.from(container.children);
    now.forEach((k) => {
      const a = first.get(k); if (!a) { return; }
      const b = k.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) return;
      k.style.transition = "none";
      k.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        k.classList.add("flip-move");
        k.style.transform = "";
        k.addEventListener("transitionend", () => { k.classList.remove("flip-move"); k.style.transition = ""; }, { once: true });
      });
    });
  }

  // ---- Count-up: animate [data-count] numerals ----------------------------
  function countUp(scope) {
    (scope || document).querySelectorAll("[data-count]").forEach((el) => {
      if (el.dataset.counted) return; el.dataset.counted = "1";
      const target = parseFloat(el.dataset.count);
      if (isNaN(target)) return;
      const prefix = el.dataset.prefix || "", suffix = el.dataset.suffix || "";
      const decimals = (el.dataset.decimals && +el.dataset.decimals) || 0;
      const fmt = (n) => prefix + (el.dataset.group ? Math.round(n).toLocaleString("en-IN") : n.toFixed(decimals)) + suffix;
      if (reduce) { el.textContent = fmt(target); return; }
      const dur = 760, t0 = performance.now();
      function step(t) {
        const p = Math.min(1, (t - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(target * eased);
        if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(target);
      }
      requestAnimationFrame(step);
    });
  }

  window.radarMotion = { reveal: wireReveals, wireReveals, flip, countUp };
  document.addEventListener("DOMContentLoaded", () => { wireReveals(document); countUp(document); });
})();
