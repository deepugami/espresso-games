(function () {
  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  // HUD elements
  const scoreEl = document.getElementById('score');
  const comboEl = document.getElementById('combo');
  const waveEl = document.getElementById('wave');
  const bestEl = document.getElementById('best');
  const orderIconsEl = document.getElementById('orderIcons');
  const orderTitleEl = document.getElementById('orderTitle');
  const orderNoteEl = document.getElementById('orderNote');
  const badgeEl = document.getElementById('badge');
  const muteBtn = document.getElementById('muteBtn');
  const resetBtn = document.getElementById('resetBtn');

  // Audio (simple beeps)
  const audio = new (window.AudioContext || window.webkitAudioContext)();
  let muted = false;
  function ensureAudio() { if (audio.state === 'suspended') audio.resume(); }
  function sfx(type) {
    if (muted) return;
    ensureAudio();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.connect(gain).connect(audio.destination);
    const now = audio.currentTime;
    if (type === 'ok') { osc.type = 'triangle'; osc.frequency.value = 880; }
    else if (type === 'alt') { osc.type = 'sine'; osc.frequency.value = 520; }
    else { osc.type = 'sawtooth'; osc.frequency.value = 180; }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(type === 'fail' ? 0.06 : 0.04, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (type === 'fail' ? 0.28 : 0.18));
    osc.start(now); osc.stop(now + 0.3);
  }

  // Resize
  function resize() {
    const { innerWidth: w, innerHeight: h } = window;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // Colors
  const colors = {
    bg0: '#120a04',
    bg1: '#2a160a',
    crema: '#e9c49a',
    green: '#2fd27a',
    greenDark: '#1aa15a',
    miss: '#ff5a5f',
    edge: '#1c120b'
  };

  // Ingredients and icons (keep tiny)
  const ING = ['ESP', 'MLK', 'SYR', 'BEN', 'CRM'];
  const ICON_BG = {
    ESP: '#6b3a1f', MLK: '#d9e3f0', SYR: '#b85c2f', BEN: '#3a2316', CRM: '#fff3e0'
  };
  const ICON_FG = { ESP: '#e9c49a', MLK: '#203040', SYR: '#fff', BEN: '#d4b48a', CRM: '#6b3a1f' };

  // Game state
  let running = true;
  let score = 0;
  let combo = 0;
  let best = Number(localStorage.getItem('order_stack_best') || 0);
  let wave = 1; // difficulty wave
  let showFlash = 0; // -1 fail, +1 exact, +0.5 alt
  let forcedFail = false;
  let exactStreak = 0; // for badge
  let multiplierLeft = 0; // next-N-orders 1.5x

  // Reels
  const reelCount = 3;
  /** @type {Array<{items:string[], speed:number, pos:number, spinning:boolean, highlight:boolean}>} */
  const reels = new Array(reelCount).fill(0).map((_, i) => ({
    items: shuffle(ING.slice()),
    speed: 5 + i * 0.5,
    pos: 0,
    spinning: true,
    highlight: i === 0
  }));
  let highlighted = 0;

  // Current order and accepted alternatives
  /** @type {{name:string, recipe:string[], alts:string[][], time:number}} */
  let order = makeOrder(wave);

  // Input
  canvas.addEventListener('pointerdown', (e) => {
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    const cx = e.clientX; const cy = e.clientY;
    const layout = computeLayout(w, h);
    for (let i = 0; i < reelCount; i++) {
      const r = layout.reelRects[i];
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
        stopReel(i); break;
      }
    }
  }, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      stopReel(highlighted);
    }
    if (e.code === 'Digit1' || e.code === 'Numpad1') { stopReel(0); }
    if (e.code === 'Digit2' || e.code === 'Numpad2') { stopReel(1); }
    if (e.code === 'Digit3' || e.code === 'Numpad3') { stopReel(2); }
    if (e.key === 'ArrowRight' || e.key === 'Tab') {
      highlighted = (highlighted + 1) % reelCount;
      updateHighlight();
    }
    if (e.key === 'ArrowLeft') {
      highlighted = (highlighted + reelCount - 1) % reelCount;
      updateHighlight();
    }
  });
  function updateHighlight() {
    for (let i = 0; i < reelCount; i++) reels[i].highlight = (i === highlighted);
  }

  if (muteBtn) muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = `Sound: ${muted ? 'Off' : 'On'}`;
    muteBtn.setAttribute('aria-pressed', String(muted));
  });
  if (resetBtn) resetBtn.addEventListener('click', () => resetGame());

  function stopReel(i) {
    const r = reels[i];
    if (!r.spinning) return;
    r.spinning = false;
    highlighted = (i + 1) % reelCount;
    updateHighlight();
    if (reels.every((rr) => !rr.spinning)) evaluateOrder();
  }

  function evaluateOrder() {
    if (forcedFail) {
      exactStreak = 0;
      combo = 0;
      score = Math.max(0, score - 25);
      showFlash = -1;
      sfx('fail');
      bump(orderNoteEl);
      forcedFail = false;
      persistBest(); updateHud(); setTimeout(nextRound, 450);
      return;
    }
    const pick = reels.map((r) => r.items[Math.floor(r.pos) % r.items.length]);
    const exact = arraysEqual(pick, order.recipe);
    const alt = !exact && order.alts.some((a) => arraysEqual(a, pick));
    let gained = 0;
    if (exact) {
      exactStreak += 1;
      combo += 1;
      if (exactStreak === 3 && multiplierLeft === 0) { multiplierLeft = 3; }
      gained = 100 + Math.round(Math.max(0, (timeLeft / Math.max(1, timeLimit)) * 50));
      if (multiplierLeft > 0) { gained = Math.round(gained * 1.5); multiplierLeft -= 1; }
      score += gained;
      showFlash = 1;
      sfx('ok');
      bump(bestEl); bump(scoreEl); bump(comboEl);
      if (exactStreak % 10 === 0) showBadge();
    } else if (alt) {
      exactStreak = 0;
      combo = Math.max(0, combo); // keep combo but no increment
      gained = 50;
      if (multiplierLeft > 0) { gained = Math.round(gained * 1.5); multiplierLeft -= 1; }
      score += gained;
      showFlash = 0.6;
      sfx('alt');
      bump(scoreEl);
    } else {
      exactStreak = 0;
      combo = 0;
      score = Math.max(0, score - 25);
      showFlash = -1;
      sfx('fail');
      bump(orderNoteEl);
    }
    persistBest();
    updateHud();
    setTimeout(nextRound, 450);
  }

  function nextRound() {
    advanceWave();
    order = makeOrder(wave);
    renderOrder();
    for (let i = 0; i < reelCount; i++) {
      reels[i].items = shuffle(ING.slice());
      reels[i].pos = Math.random() * reels[i].items.length;
      reels[i].spinning = true;
      reels[i].speed = baseSpeedForWave(wave) + i * 0.5 + Math.random() * 0.5;
    }
    highlighted = 0; updateHighlight();
  }

  function resetGame() {
    score = 0; combo = 0; exactStreak = 0; multiplierLeft = 0; wave = 1;
    order = makeOrder(wave);
    for (let i = 0; i < reelCount; i++) {
      reels[i].items = shuffle(ING.slice());
      reels[i].pos = Math.random() * reels[i].items.length;
      reels[i].spinning = true;
      reels[i].speed = baseSpeedForWave(wave) + i * 0.5;
    }
    highlighted = 0; updateHighlight();
    setLimitsForWave();
    updateHud(); renderOrder();
  }

  function setLimitsForWave() {
    // Not time-based: keep untimed and do nothing here.
  }
  function baseSpeedForWave(w) { return 4.5 + Math.min(3, (w - 1) * 0.9); }

  function advanceWave() {
    // Increase difficulty every 3 orders
    const targetWave = 1 + Math.floor(score / 300);
    if (targetWave !== wave) { wave = targetWave; setLimitsForWave(); bump(waveEl); }
  }

  // Orders
  function makeOrder(w) {
    const base = randomRecipe();
    // Allowed alternatives decrease as waves go up
    const altCount = w <= 1 ? 3 : (w === 2 ? 1 : 0);
    const alts = [];
    const used = new Set([base.join(',')]);
    for (let i = 0; i < altCount; i++) {
      const a = mutateRecipe(base);
      const k = a.join(',');
      if (!used.has(k)) { used.add(k); alts.push(a); }
    }
    setLimitsForWave();
    const name = nameForRecipe(base);
    return { name, recipe: base, alts, time: 0 };
  }

  function randomRecipe() {
    // Ensure diversity; sometimes require rare ingredient on reel 2 in later waves
    const rareOn2 = wave >= 4 && Math.random() < 0.35;
    const r = [pick(ING), pick(ING), pick(ING)];
    if (rareOn2) r[1] = 'BEN'; // coffee bean metaphor
    return r;
  }
  function mutateRecipe(base) {
    // generate a simple alternative: swap adjacent or replace one with compatible
    const a = base.slice();
    if (Math.random() < 0.5) {
      const i = (Math.random() * 2) | 0; const j = i + 1;
      [a[i], a[j]] = [a[j], a[i]];
    } else {
      const i = (Math.random() * 3) | 0;
      const pool = compatibleFor(a[i]);
      a[i] = pick(pool);
    }
    return a;
  }
  function compatibleFor(x) {
    switch (x) {
      case 'ESP': return ['ESP', 'BEN'];
      case 'MLK': return ['MLK', 'CRM'];
      case 'SYR': return ['SYR'];
      case 'BEN': return ['BEN', 'ESP'];
      case 'CRM': return ['CRM', 'MLK'];
    }
    return [x];
  }
  function nameForRecipe(r) {
    const map = { ESP: 'Espresso', MLK: 'Milk', SYR: 'Syrup', BEN: 'Bean', CRM: 'Cream' };
    return `${map[r[0]]} → ${map[r[1]]} → ${map[r[2]]}`;
  }

  // HUD and order render
  function renderOrder() {
    orderTitleEl.textContent = `Order`;
    orderIconsEl.innerHTML = '';
    for (const it of order.recipe) {
      const el = document.createElement('div');
      el.className = 'icon ic-' + it;
      el.textContent = it;
      orderIconsEl.appendChild(el);
    }
    orderNoteEl.textContent = `Exact match = finalized rollup`;
  }
  function updateHud() {
    scoreEl.textContent = String(score);
    comboEl.textContent = multiplierLeft > 0 ? `${combo} (x1.5:${multiplierLeft})` : String(combo);
    waveEl.textContent = String(wave);
    bestEl.textContent = String(best);
  }
  function persistBest() {
    if (score > best) { best = score; localStorage.setItem('order_stack_best', String(best)); }
  }

  // Badge
  function showBadge() { badgeEl.classList.add('show'); setTimeout(() => badgeEl.classList.remove('show'), 1600); }

  function bump(el) {
    if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  // Main loop
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(1 / 30, (now - lastT) / 1000);
    lastT = now;
    if (running) { update(dt); draw(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function update(dt) {
    // reels
    for (const r of reels) {
      if (r.spinning) r.pos = (r.pos + r.speed * dt) % r.items.length;
    }
    // no timer mechanics
    // flash decay
    if (showFlash > 0) showFlash = Math.max(0, showFlash - dt * 2.2);
    if (showFlash < 0) showFlash = Math.min(0, showFlash + dt * 2.2);
  }

  function draw() {
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    // clear only; leave canvas transparent so mugs below are visible outside the strip
    ctx.clearRect(0, 0, w, h);

    const layout = computeLayout(w, h);
    // conveyor strip
    roundRect(layout.strip.x, layout.strip.y, layout.strip.w, layout.strip.h, 14);
    const sg = ctx.createLinearGradient(0, layout.strip.y, 0, layout.strip.y + layout.strip.h);
    sg.addColorStop(0, '#3c2416'); sg.addColorStop(1, '#2a160a');
    ctx.fillStyle = sg; ctx.fill();

    // reels
    for (let i = 0; i < reelCount; i++) {
      drawReel(i, layout.reelRects[i]);
    }

    // feedback text
    ctx.font = '600 18px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (showFlash > 0.9) { ctx.fillStyle = colors.crema; ctx.fillText('Exact match! Confirmed', w/2, layout.strip.y - 20); }
    else if (showFlash > 0) { ctx.fillStyle = colors.green; ctx.fillText('Accepted alternative', w/2, layout.strip.y - 20); }
    else if (showFlash < 0) { ctx.fillStyle = colors.miss; ctx.fillText('Incompatible — Reorg', w/2, layout.strip.y - 20); }
  }

  function computeLayout(w, h) {
    const stripW = Math.min(760, Math.max(360, w * 0.86));
    const stripH = Math.min(260, Math.max(180, h * 0.36));
    const stripX = (w - stripW) / 2; const stripY = h * 0.52 - stripH / 2;
    const reelW = Math.min(200, Math.max(100, stripW / 3 - 20));
    const reelH = stripH - 30;
    const pad = 15; // inner horizontal padding inside the strip
    const available = stripW - pad * 2 - reelW * 3;
    const gap = Math.max(8, available / 2);
    const r0x = stripX + pad, r0y = stripY + 15;
    const rects = [
      { x: r0x, y: r0y, w: reelW, h: reelH },
      { x: r0x + reelW + gap, y: r0y, w: reelW, h: reelH },
      { x: r0x + (reelW + gap) * 2, y: r0y, w: reelW, h: reelH },
    ];
    return { strip: { x: stripX, y: stripY, w: stripW, h: stripH }, reelRects: rects };
  }

  function drawReel(i, rect) {
    // frame
    roundRect(rect.x, rect.y, rect.w, rect.h, 16);
    const rg = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
    rg.addColorStop(0, '#8a4b2a'); rg.addColorStop(1, '#4a2b17');
    ctx.fillStyle = rg; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = colors.edge; ctx.stroke();

    const r = reels[i];
    const itemH = Math.min(64, Math.max(32, rect.h / 3.6));
    // visible slots: center plus neighbors
    for (let k = -1; k <= 1; k++) {
      const idx = mod(Math.floor(r.pos) + k, r.items.length);
      const it = r.items[idx];
      const y = rect.y + rect.h / 2 + k * (itemH + 10);
      drawIcon(it, rect.x + rect.w / 2, y, itemH);
    }
    // highlight
    if (r.highlight) {
      ctx.globalAlpha = 0.16;
      roundRect(rect.x - 6, rect.y - 6, rect.w + 12, rect.h + 12, 20);
      ctx.fillStyle = colors.green; ctx.fill(); ctx.globalAlpha = 1;
    }
  }

  function drawIcon(code, cx, cy, size) {
    const bg = ICON_BG[code] || '#666';
    const fg = ICON_FG[code] || '#fff';
    const s = size;
    roundRect(cx - s/2, cy - s/2, s, s, 8);
    const ig = ctx.createLinearGradient(0, cy - s/2, 0, cy + s/2);
    ig.addColorStop(0, bg); ig.addColorStop(1, shade(bg, -0.25));
    ctx.fillStyle = ig; ctx.fill();
    // tiny label
    ctx.font = `800 ${Math.round(s*0.28)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = fg; ctx.fillText(code, cx, cy + 1);
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  

  function arraysEqual(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function mod(n, m) { return ((n % m) + m) % m; }
  function shade(hex, amt) {
    // naive shade for bg
    const c = parseInt(hex.slice(1), 16);
    let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    r = Math.max(0, Math.min(255, r + amt * 255));
    g = Math.max(0, Math.min(255, g + amt * 255));
    b = Math.max(0, Math.min(255, b + amt * 255));
    const v = (r<<16)|(g<<8)|b; return '#' + v.toString(16).padStart(6, '0');
  }
  

  // init
  resetGame();
})();



