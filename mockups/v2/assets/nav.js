/* ============================================================================
   Radar v2 — shared shell (direction-aware). One structure, three skins.
   A page authors only its content:
     <body data-dir="command|spatial|focus" data-screen="leads" data-title="Leads">
       <div class="v2-app"><div class="v2-main">
         <main class="v2-content">…</main>
       </div></div>
   nav.js injects: .v2-rail (nav), .v2-topbar (⌘K + title + switchers), and the
   wayfinding strip. CSS per direction restyles it dramatically.
   ========================================================================== */
(function () {
  const dir = document.body.dataset.dir || "command";
  const screen = document.body.dataset.screen || "";
  const title = document.body.dataset.title || "Radar";

  const I = {
    dashboard:'<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z"/>',
    leads:'<path d="M3 7l9 6 9-6"/><rect x="3" y="5" width="18" height="14" rx="2"/>',
    pipeline:'<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="8" rx="1"/>',
    contacts:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
    vendors:'<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/>',
    interview:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    signals:'<path d="M4 12a8 8 0 0 1 8-8M4 12a8 8 0 0 0 8 8"/><circle cx="12" cy="12" r="1.5"/>',
    mappings:'<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M8.5 6.8 15.5 11M8.5 17.2 15.5 13"/>',
    holding:'<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/>',
    catalogue:'<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6 8l5 8M18 8l-5 8"/>',
  };
  const ic = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[k]||""}</svg>`;
  const NAV = [
    { group:"Operate", items:[["dashboard","Dashboard"],["leads","Leads"],["pipeline","Pipeline"],["contacts","Contacts"]] },
    { group:"Build", items:[["vendors","Vendors"],["interview","SIA Interview"],["signals","Signals"],["mappings","Mappings"],["catalogue","Catalogue"],["holding","Holding pool"]] },
  ];
  function counts() {
    const R = window.RADAR; if (!R) return {};
    return { signals: R.signals.filter((s)=>s.status==="proposed").length, leads: R.leads.filter((l)=>l.heat==="hot").length, holding: R.holding.length };
  }
  const c = counts();

  function railHTML() {
    const nav = NAV.map((sec)=>`<div class="nav-section"><div class="eyebrow">${sec.group}</div>${
      sec.items.map(([id,label])=>{
        const n=c[id]; const badge=n?`<span class="count ${id==="signals"?"alert":""}">${n}</span>`:"";
        return `<a class="nav-item" href="${id}.html" ${id===screen?'aria-current="page"':""}>${ic(id)}<span>${label}</span>${badge}</a>`;
      }).join("")
    }</div>`).join("");
    return `<a class="brand" href="dashboard.html"><span class="brand-mark">R</span><span class="brand-name">Radar<small>lead intelligence</small></span></a>
      <nav class="nav">${nav}</nav>
      <div class="rail-foot"><div class="nav-item" style="cursor:default"><span class="brand-mark" style="width:24px;height:24px;font-size:11px;background:var(--surface-inset);color:var(--text-muted)">OP</span><span style="font-size:var(--text-sm)">Operator</span></div></div>`;
  }

  function topbarHTML() {
    return `
      <button class="icon-btn rail-toggle" data-rail-toggle aria-label="Menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg></button>
      <button class="cmdk-trigger" data-cmdk-open><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg><span>Search or jump to…</span><span class="spacer"></span><kbd>⌘K</kbd></button>
      <h1 class="v2-title">${title}</h1>
      <div class="v2-actions">
        <div class="seg" role="group" aria-label="Theme">${[["slate","Slate"],["paper","Paper"],["observatory","Obs"]].map(([t,l])=>`<button data-set-theme="${t}">${l}</button>`).join("")}</div>
        <button class="icon-btn" data-toggle-mode aria-label="Light/dark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>
      </div>`;
  }

  function cmdkHTML() {
    const items = NAV.flatMap((s)=>s.items).map(([id,label])=>({id,label,href:`${id}.html`,kind:"Go to"}));
    return `<div class="cmdk-overlay" data-cmdk>
      <div class="cmdk-panel" role="dialog" aria-label="Command menu">
        <input class="cmdk-input" placeholder="Search screens, leads, signals…" aria-label="Command input"/>
        <div class="cmdk-list" id="cmdk-list">${items.map((it,i)=>cmdkItem(it,i)).join("")}</div>
      </div></div>`;
  }
  const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  function cmdkItem(it,i){ return `<div class="cmdk-item" role="option" data-href="${it.href}" data-label="${it.label.toLowerCase()}" aria-selected="${i===0}"><span class="ic">${ic(it.id)||arrow}</span><span>${it.label}</span><span class="hint">${it.kind}</span></div>`; }

  function mount() {
    const app = document.querySelector(".v2-app"); if (!app) return;
    const rail = document.createElement("aside"); rail.className = "v2-rail"; rail.innerHTML = railHTML();
    app.insertBefore(rail, app.firstChild);
    const main = app.querySelector(".v2-main");
    const top = document.createElement("header"); top.className = "v2-topbar"; top.innerHTML = topbarHTML();
    main.insertBefore(top, main.firstChild);
    const way = document.createElement("div"); way.className = "v2-wayslot";
    main.insertBefore(way, main.querySelector(".v2-content"));
    if (window.radarRenderWayfind) { const strip = document.createElement("div"); way.appendChild(strip); window.radarRenderWayfind(strip); }
    app.insertAdjacentHTML("beforeend", cmdkHTML());

    // direction switch: same screen, other folder; remember preference
    rail.parentElement.querySelectorAll("[data-dir-go]").forEach((b)=>b.addEventListener("click",()=>{
      const d=b.dataset.dirGo; try{localStorage.setItem("radar.dir",d);}catch(e){}
      location.href = `../${d}/${screen}.html${location.search}`;
    }));
    rail.querySelectorAll(".nav-item[href]").forEach((a)=>a.addEventListener("click",()=>app.removeAttribute("data-rail-open")));
    document.querySelectorAll("[data-rail-toggle]").forEach((b)=>b.addEventListener("click",()=>app.toggleAttribute("data-rail-open")));
    wireCmdk();

    if (window.radarWire) window.radarWire(document);
    if (window.radarMotion) { window.radarMotion.wireReveals(document); window.radarMotion.countUp(document); }
  }

  function wireCmdk() {
    const overlay = document.querySelector("[data-cmdk]"); if (!overlay) return;
    const input = overlay.querySelector(".cmdk-input"); const list = overlay.querySelector("#cmdk-list");
    const open=()=>{ overlay.dataset.open="true"; input.value=""; filter(""); input.focus(); };
    const close=()=>{ overlay.dataset.open="false"; };
    document.querySelectorAll("[data-cmdk-open]").forEach((b)=>b.addEventListener("click",open));
    document.addEventListener("keydown",(e)=>{
      if ((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){ e.preventDefault(); overlay.dataset.open==="true"?close():open(); }
      if (e.key==="Escape") close();
    });
    overlay.addEventListener("click",(e)=>{ if (e.target===overlay) close(); });
    function visible(){ return Array.from(list.querySelectorAll(".cmdk-item")).filter((i)=>i.style.display!=="none"); }
    function filter(q){ list.querySelectorAll(".cmdk-item").forEach((i)=>{ i.style.display = i.dataset.label.includes(q)?"":"none"; i.setAttribute("aria-selected","false"); }); const v=visible(); if(v[0])v[0].setAttribute("aria-selected","true"); }
    input.addEventListener("input",()=>filter(input.value.toLowerCase().trim()));
    input.addEventListener("keydown",(e)=>{
      const v=visible(); let idx=v.findIndex((i)=>i.getAttribute("aria-selected")==="true");
      if(e.key==="ArrowDown"){e.preventDefault(); if(idx<v.length-1){v[idx].setAttribute("aria-selected","false"); v[idx+1].setAttribute("aria-selected","true"); v[idx+1].scrollIntoView({block:"nearest"});}}
      else if(e.key==="ArrowUp"){e.preventDefault(); if(idx>0){v[idx].setAttribute("aria-selected","false"); v[idx-1].setAttribute("aria-selected","true"); v[idx-1].scrollIntoView({block:"nearest"});}}
      else if(e.key==="Enter"){ const sel=v.find((i)=>i.getAttribute("aria-selected")==="true"); if(sel) location.href=sel.dataset.href; }
    });
    list.querySelectorAll(".cmdk-item").forEach((i)=>i.addEventListener("click",()=>location.href=i.dataset.href));
  }

  mount();
})();
