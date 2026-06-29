/* GeoGame — name the neighboring countries.
   Relies on window.COUNTRIES (data.js) and an inlined #worldmap SVG
   whose top-level <g> ids are ISO-3166 alpha-2 codes. */
(function () {
  const COUNTRIES = window.COUNTRIES;
  const mapWrap = document.getElementById("map-wrap");
  // Inject the map (shipped as a string in map.js so file:// works w/o fetch).
  mapWrap.innerHTML = window.WORLD_SVG;
  const svg = document.getElementById("worldmap");
  const input = document.getElementById("guess");
  const sugg = document.getElementById("suggestions");
  const foundList = document.getElementById("found-list");
  const scoreEl = document.getElementById("score");
  const streakEl = document.getElementById("streak");
  const mistakesEl = document.getElementById("mistakes");
  const hideMapToggle = document.getElementById("hide-map-toggle");
  const targetEl = document.getElementById("target-name");
  const revealBtn = document.getElementById("reveal-btn");
  const nextBtn = document.getElementById("next-btn");
  const aside = document.querySelector("aside");

  // Streak = consecutive rounds finished with zero wrong guesses (no give-ups).
  // Persisted so it survives reloads; we also keep an all-time best.
  let streak = 0, bestStreak = 0;
  try {
    streak = parseInt(localStorage.getItem("geogame-streak"), 10) || 0;
    bestStreak = parseInt(localStorage.getItem("geogame-best-streak"), 10) || 0;
  } catch (e) { /* localStorage unavailable */ }

  function saveStreak() {
    try {
      localStorage.setItem("geogame-streak", String(streak));
      localStorage.setItem("geogame-best-streak", String(bestStreak));
    } catch (e) { /* ignore */ }
  }

  // Normalize a string for forgiving matching: lowercase, strip accents/punct.
  const norm = (s) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");

  // All countries that exist as a <g> in the SVG (so we can render them).
  const renderable = new Set(
    Array.from(svg.querySelectorAll("g[id]"))
      .map((g) => g.id)
      .filter((id) => /^[A-Z]{2}$/.test(id))
  );

  // Playable targets: have at least one neighbor and exist on the map.
  const targets = Object.keys(COUNTRIES).filter(
    (c) => renderable.has(c) && COUNTRIES[c].neighbors.length > 0
  );

  // Autocomplete pool: every named country (so the count never leaks answers).
  const pool = Object.keys(COUNTRIES)
    .filter((c) => renderable.has(c))
    .map((c) => ({ code: c, name: COUNTRIES[c].name, key: norm(COUNTRIES[c].name) }));

  let state = null; // { code, neighbors:[], found:Set, over:bool, wrong:int }

  function gEl(code) { return svg.getElementById(code); }

  function clearMap() {
    svg.querySelectorAll("g[id]").forEach((g) => {
      g.classList.remove("region", "target", "found", "missed");
    });
    document.querySelectorAll(".map-label").forEach((l) => l.remove());
  }

  // Union bounding box (in SVG user units) of a set of country codes.
  function regionBBox(codes) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    codes.forEach((code) => {
      const g = gEl(code);
      if (!g) return;
      const b = g.getBBox();
      if (!b.width && !b.height) return;
      x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height);
    });
    if (x1 === Infinity) return null;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  const FULL = { x: 0, y: 0, w: 1000, h: 507.209 };

  // Frame the map on target + neighbors with padding. Clamp against runaway
  // boxes (e.g. countries with far-flung territories) by capping the size.
  function frameRegion() {
    // Bail while the map is collapsed (hard mode): it has no layout, so
    // getBBox/dimensions are meaningless. It gets reframed when revealed.
    if (!mapWrap.clientWidth || !mapWrap.clientHeight) return;
    const codes = [state.code, ...state.neighbors];
    let box = regionBBox(codes);
    if (!box) { setViewBox(FULL); return; }
    const pad = Math.max(box.w, box.h) * 0.18 + 4;
    box = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };

    // Clamp: if the region spans most of the world (sprawling territories),
    // re-frame on the target's mainland-ish core only.
    if (box.w > FULL.w * 0.7 || box.h > FULL.h * 0.7) {
      const tb = regionBBox([state.code]);
      if (tb) {
        const p = Math.max(tb.w, tb.h) * 0.6 + 8;
        box = { x: tb.x - p, y: tb.y - p, w: tb.w + p * 2, h: tb.h + p * 2 };
      }
    }
    setViewBox(box);
  }

  function setViewBox(b) {
    // Match the SVG aspect ratio to the map container to avoid distortion.
    const cr = mapWrap.clientWidth / mapWrap.clientHeight;
    let { x, y, w, h } = b;
    if (w / h < cr) { const nw = h * cr; x -= (nw - w) / 2; w = nw; }
    else { const nh = w / cr; y -= (nh - h) / 2; h = nh; }
    svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    placeLabels();
  }

  // Place HTML labels over countries, converting SVG coords -> screen coords.
  function placeLabels() {
    document.querySelectorAll(".map-label").forEach((l) => l.remove());
    if (!mapWrap.clientWidth || !mapWrap.clientHeight) return; // map collapsed
    const show = [{ code: state.code, cls: "target" }];
    state.neighbors.forEach((n) => {
      if (state.found.has(n)) show.push({ code: n, cls: "found" });
      else if (state.over) show.push({ code: n, cls: "missed" });
    });
    show.forEach(({ code, cls }) => {
      const g = gEl(code);
      if (!g) return;
      const b = g.getBBox();
      const pt = svgToScreen(b.x + b.width / 2, b.y + b.height / 2);
      if (!pt) return;
      const el = document.createElement("div");
      el.className = "map-label " + cls;
      el.textContent = COUNTRIES[code] ? COUNTRIES[code].name : code;
      el.style.left = pt.x + "px";
      el.style.top = pt.y + "px";
      mapWrap.appendChild(el);
    });
  }

  function svgToScreen(ux, uy) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = svg.createSVGPoint();
    p.x = ux; p.y = uy;
    const s = p.matrixTransform(ctm);
    const wrapRect = mapWrap.getBoundingClientRect();
    return { x: s.x - wrapRect.left, y: s.y - wrapRect.top };
  }

  function paint() {
    clearMap();
    state.neighbors.forEach((n) => {
      const g = gEl(n);
      if (!g) return;
      if (state.found.has(n)) g.classList.add("found");
      else if (state.over) g.classList.add("missed");
      else g.classList.add("region");
    });
    const t = gEl(state.code);
    if (t) t.classList.add("target");
  }

  function renderSidebar() {
    const total = state.neighbors.length;
    const got = state.found.size;
    scoreEl.innerHTML = `<b>${got}</b> / ${total} found`;
    foundList.innerHTML = "";
    const ordered = [...state.neighbors].sort((a, b) =>
      COUNTRIES[a].name.localeCompare(COUNTRIES[b].name)
    );
    ordered.forEach((n) => {
      const li = document.createElement("li");
      const shown = state.found.has(n);
      if (shown) li.className = "found";
      else if (state.over) li.className = "missed";
      const label = (shown || state.over) ? COUNTRIES[n].name : "•••";
      const tag = shown ? "✓" : (state.over ? "missed" : "");
      li.innerHTML = `<span>${label}</span><span class="tag">${tag}</span>`;
      foundList.appendChild(li);
    });
  }

  function renderStats() {
    const wrong = state ? state.wrong : 0;
    streakEl.innerHTML = `🔥 <b>${streak}</b> streak` +
      (bestStreak ? ` · best ${bestStreak}` : "");
    mistakesEl.innerHTML = `✗ <b>${wrong}</b> wrong`;
  }

  // Hard mode: collapse the whole map area while a round is in progress (so
  // the input rises to the top — handy on mobile), then reveal it once the
  // round is over so the answer is still visible.
  function applyMapVisibility() {
    const hide = hideMapToggle.checked && !(state && state.over);
    document.body.classList.toggle("map-hidden", hide);
  }

  function newRound() {
    const code = targets[Math.floor(Math.random() * targets.length)];
    state = {
      code,
      neighbors: COUNTRIES[code].neighbors.filter((n) => renderable.has(n)),
      found: new Set(),
      over: false,
      wrong: 0,
      wrongSet: new Set(), // distinct countries already counted as a miss
    };
    targetEl.textContent = COUNTRIES[code].name;
    input.value = "";
    input.disabled = false;
    closeSuggestions();
    revealBtn.disabled = false;
    nextBtn.style.display = "none";
    paint();
    frameRegion();
    renderSidebar();
    renderStats();
    applyMapVisibility();
    input.focus();
  }

  function submitGuess(code) {
    if (!state || state.over) return;

    // A correct neighbor: progress. Re-picking an already-found one (or the
    // target country itself) is benign — clear the box, no penalty.
    if (state.neighbors.includes(code)) {
      if (!state.found.has(code)) {
        state.found.add(code);
        paint();
        placeLabels();
        renderSidebar();
        if (state.found.size === state.neighbors.length) endRound(false);
      }
      input.value = "";
      closeSuggestions();
      return;
    }
    if (code === state.code) {
      input.value = "";
      closeSuggestions();
      return;
    }

    // Genuinely wrong country -> shake. Count it once per distinct country so
    // repeating the same wrong guess doesn't stack up misses.
    if (!state.wrongSet.has(code)) {
      state.wrongSet.add(code);
      state.wrong++;
      renderStats();
    }
    aside.classList.add("flash-wrong");
    setTimeout(() => aside.classList.remove("flash-wrong"), 320);
  }

  function endRound(gaveUp) {
    state.over = true;
    input.disabled = true;
    revealBtn.disabled = true;
    nextBtn.style.display = "block";

    // A "perfect" round: every neighbor found with no wrong guesses and no
    // give-up. Perfect rounds extend the streak; anything else resets it.
    if (!gaveUp && state.wrong === 0) {
      streak++;
      if (streak > bestStreak) bestStreak = streak;
    } else {
      streak = 0;
    }
    saveStreak();

    closeSuggestions();
    paint();
    applyMapVisibility();
    placeLabels();
    renderSidebar();
    renderStats();
  }

  // ---- Autocomplete (substring match on normalized names) ----
  let activeIdx = -1, matches = [];
  function updateSuggestions() {
    const q = norm(input.value);
    if (!q) return closeSuggestions();
    matches = pool.filter((c) => c.key.includes(q)).slice(0, 8);
    if (!matches.length) return closeSuggestions();
    activeIdx = 0;
    sugg.innerHTML = "";
    matches.forEach((m, i) => {
      const d = document.createElement("div");
      d.textContent = m.name;
      if (i === activeIdx) d.classList.add("active");
      d.addEventListener("mousedown", (e) => { e.preventDefault(); submitGuess(m.code); });
      sugg.appendChild(d);
    });
    sugg.classList.add("open");
  }
  function closeSuggestions() { sugg.classList.remove("open"); sugg.innerHTML = ""; matches = []; activeIdx = -1; }
  function highlightActive() {
    [...sugg.children].forEach((c, i) => c.classList.toggle("active", i === activeIdx));
  }

  input.addEventListener("input", updateSuggestions);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && matches.length) { e.preventDefault(); activeIdx = (activeIdx + 1) % matches.length; highlightActive(); }
    else if (e.key === "ArrowUp" && matches.length) { e.preventDefault(); activeIdx = (activeIdx - 1 + matches.length) % matches.length; highlightActive(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (matches.length && activeIdx >= 0) submitGuess(matches[activeIdx].code);
    } else if (e.key === "Escape") closeSuggestions();
  });
  document.addEventListener("click", (e) => { if (!aside.contains(e.target)) closeSuggestions(); });

  revealBtn.addEventListener("click", () => endRound(true));
  nextBtn.addEventListener("click", newRound);
  hideMapToggle.addEventListener("change", () => {
    applyMapVisibility();
    // Revealing the map again needs a fresh frame (and labels) for the now
    // laid-out container; while hidden these no-op via their size guards.
    if (state) frameRegion();
  });
  window.addEventListener("resize", () => { if (state) frameRegion(); });

  newRound();
})();
