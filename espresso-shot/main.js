/*
  Espresso Shot — single-button timing
  - One-meter timing: press Space/Click/Tap when the moving marker is inside the green zone
  - Scoring: perfect adds confirmed rollups (+combo), miss adds reorgs and resets combo
  - Variant: bridge modifier moves the green zone horizontally over time
  - Tech: vanilla JS, no external libs

  Files kept tiny and self-contained per request.
*/

(function () {
  /** @type {HTMLCanvasElement} */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  // HUD elements
  const confirmedEl = document.getElementById('confirmed');
  const reorgsEl = document.getElementById('reorgs');
  const comboEl = document.getElementById('combo');
  const bestEl = document.getElementById('best');
  const bestComboEl = document.getElementById('bestCombo');
  const toggleBridgeBtn = document.getElementById('toggleBridge');
  const muteBtn = document.getElementById('muteBtn');
  const resetBtn = document.getElementById('resetBtn');

  // Audio (simple, tiny synth via WebAudio; short steam/shot and fail click)
  const audio = new (window.AudioContext || window.webkitAudioContext)();
  let muted = false;
  function makeCtx() {
    if (audio.state === 'suspended') audio.resume();
  }
  function beepSuccess() {
    if (muted) return;
    makeCtx();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'triangle';
    o.frequency.value = 880;
    g.gain.value = 0.001;
    o.connect(g).connect(audio.destination);
    const now = audio.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o.start(now);
    o.stop(now + 0.2);
  }
  function beepFail() {
    if (muted) return;
    makeCtx();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 160;
    g.gain.value = 0.001;
    o.connect(g).connect(audio.destination);
    const now = audio.currentTime;
    g.gain.setValueAtTime(0.02, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    o.start(now);
    o.stop(now + 0.22);
  }
  // Gentle steam loop
  let steamNode = null, steamGain = null;
  function startSteam() {
    if (muted || steamNode) return;
    makeCtx();
    const n = audio.createOscillator();
    const g = audio.createGain();
    const f = audio.createBiquadFilter();
    n.type = 'noise' in OscillatorNode.prototype ? 'noise' : 'sawtooth';
    // Fake-noise: slight FM on sawtooth
    n.frequency.value = 40;
    f.type = 'lowpass';
    f.frequency.value = 600;
    g.gain.value = 0.005;
    n.connect(f).connect(g).connect(audio.destination);
    n.start();
    steamNode = n; steamGain = g;
  }
  function stopSteam() {
    if (!steamNode) return;
    try { steamNode.stop(); } catch (_) {}
    steamNode.disconnect();
    steamGain.disconnect();
    steamNode = null; steamGain = null;
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
    espresso: '#6b3a1f',
    crema: '#e9c49a',
    green: '#2fd27a',
    greenDark: '#1aa15a',
    miss: '#ff5a5f',
    bar: '#4a2b17',
    barEdge: '#8a4b2a'
  };

  // Game state
  let running = true;
  let time = 0;
  let markerPos = 0; // 0..1 along meter
  let markerDir = 1; // 1 forward, -1 backward
  let speed = 0.65; // cycles per second
  let greenCenter = 0.5;
  let greenWidth = 0.18; // proportion of meter length
  let confirmed = 0;
  let reorgs = 0;
  let combo = 0;
  let flash = 0; // flash intensity on success/miss
  let bridgeT = 0; // for variant movement
  let bridgeOn = true;
  let best = Number(localStorage.getItem('espresso_best') || 0);
  let bestCombo = Number(localStorage.getItem('espresso_best_combo') || 0);
  let shake = 0;
  /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number,color:string}>} */
  const particles = [];

  // Input
  let pressedThisFrame = false;
  function registerPress() {
    pressedThisFrame = true;
    if (audio.state === 'suspended') {
      audio.resume();
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      registerPress();
    }
  });
  window.addEventListener('pointerdown', registerPress, { passive: true });
  if (toggleBridgeBtn) toggleBridgeBtn.addEventListener('click', () => {
    bridgeOn = !bridgeOn;
    toggleBridgeBtn.textContent = `Bridge: ${bridgeOn ? 'On' : 'Off'}`;
    toggleBridgeBtn.setAttribute('aria-pressed', String(bridgeOn));
  });
  if (muteBtn) muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = `Sound: ${muted ? 'Off' : 'On'}`;
    muteBtn.setAttribute('aria-pressed', String(muted));
    if (muted) stopSteam(); else startSteam();
  });
  if (resetBtn) resetBtn.addEventListener('click', resetGame);

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function update(dt) {
    time += dt;

    // Move marker 0..1..0 with ping-pong motion
    markerPos += markerDir * speed * dt;
    if (markerPos > 1) { markerPos = 1 - (markerPos - 1); markerDir = -1; }
    if (markerPos < 0) { markerPos = -markerPos; markerDir = 1; }

    // Bridge variant: green zone slides left-right; difficulty scales with confirmed
    // Speed up movement and shrink width as confirmed increases (width never reaches zero)
    const difficultyFactor = 1 + Math.min(1.5, confirmed / 200); // 1..2.5x
    const minGreenWidth = 0.06;
    const baseGreenWidth = Math.max(minGreenWidth, 0.18 - Math.min(0.12, confirmed * 0.001));
    if (bridgeOn) {
      bridgeT += dt * 0.35 * difficultyFactor;
      greenCenter = 0.5 + Math.sin(bridgeT * 0.9) * 0.18;
      greenWidth = clamp(baseGreenWidth + (Math.sin(bridgeT * 1.7) * 0.04), minGreenWidth, 0.26);
    } else {
      greenWidth = baseGreenWidth;
    }
    greenCenter = clamp(greenCenter, 0.15, 0.85);

    // Handle press
    if (pressedThisFrame) {
      const left = greenCenter - greenWidth * 0.5;
      const right = greenCenter + greenWidth * 0.5;
      const inZone = markerPos >= left && markerPos <= right;
      if (inZone) {
        const centerDist = Math.abs(markerPos - greenCenter) / (greenWidth * 0.5);
        const perfect = centerDist < 0.33; // central third
        const base = perfect ? 3 : 1;
        combo = combo + 1;
        const gained = base * combo;
        confirmed += gained;
        speed = clamp(speed + 0.02, 0.4, 1.5);
        flash = 1;
        beepSuccess();
        spawnParticles('success');
        shake = Math.min(1, shake + (perfect ? 0.6 : 0.35));
        animateBump(document.getElementById('confirmedBox'));
      } else {
        reorgs += 1;
        combo = 0;
        speed = clamp(speed - 0.05, 0.4, 1.2);
        flash = -1;
        beepFail();
        spawnParticles('fail');
        shake = Math.min(1, shake + 0.5);
        animateBump(document.getElementById('reorgsBox'));
      }
      pressedThisFrame = false;
      updateHud();
      persistBest();
    }

    // Fade flash
    if (flash > 0) flash = Math.max(0, flash - dt * 2.2);
    if (flash < 0) flash = Math.min(0, flash + dt * 2.2);

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * 60 * dt;
      p.y += p.vy * 60 * dt;
      p.vy += 0.03; // slight gravity
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Shake decay
    shake *= Math.pow(0.001, dt);
  }

  function updateHud() {
    confirmedEl.textContent = String(confirmed);
    reorgsEl.textContent = String(reorgs);
    comboEl.textContent = 'x' + String(combo);
    if (bestEl) bestEl.textContent = String(best);
    if (bestComboEl) bestComboEl.textContent = 'x' + String(bestCombo);
  }

  function draw() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    // Background crema vignette
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, colors.bg1);
    g.addColorStop(1, colors.bg0);
    ctx.fillStyle = g;
    // Screen shake
    const sx = (Math.random() * 2 - 1) * 6 * shake;
    const sy = (Math.random() * 2 - 1) * 4 * shake;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.fillRect(0, 0, w, h);

    // Barista placeholder block
    const bx = w * 0.5 - 50;
    const by = h * 0.22 - 50;
    roundedRect(bx, by, 100, 100, 18);
    const bg2 = ctx.createLinearGradient(0, by, 0, by + 100);
    bg2.addColorStop(0, colors.crema);
    bg2.addColorStop(1, colors.espresso);
    ctx.fillStyle = bg2;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#1c120b';
    ctx.stroke();

    // Meter area
    const meterW = Math.min(640, Math.max(320, w * 0.8));
    const meterH = 26;
    const meterX = (w - meterW) / 2;
    const meterY = h * 0.72;
    // Bar base
    roundedRect(meterX, meterY, meterW, meterH, 14);
    const barGrad = ctx.createLinearGradient(meterX, meterY, meterX, meterY + meterH);
    barGrad.addColorStop(0, colors.barEdge);
    barGrad.addColorStop(1, colors.bar);
    ctx.fillStyle = barGrad;
    ctx.fill();
    // Green zone
    const gzX = meterX + (greenCenter - greenWidth * 0.5) * meterW;
    const gzW = greenWidth * meterW;
    roundedRect(gzX, meterY + 3, gzW, meterH - 6, 10);
    const zoneGrad = ctx.createLinearGradient(gzX, meterY, gzX + gzW, meterY);
    zoneGrad.addColorStop(0, colors.greenDark);
    zoneGrad.addColorStop(1, colors.green);
    ctx.fillStyle = zoneGrad;
    ctx.fill();
    // Marker
    const markerX = meterX + markerPos * meterW;
    const markerW = 6;
    // trail
    for (let i = 0; i < 6; i++) {
      const t = i / 6;
      const tx = meterX + ((markerPos - markerDir * t * 0.03) * meterW);
      roundedRect(tx - markerW / 2, meterY - 6, markerW, meterH + 12, 6);
      ctx.globalAlpha = 0.12 * (1 - t);
      ctx.fillStyle = colors.crema;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    roundedRect(markerX - markerW / 2, meterY - 6, markerW, meterH + 12, 6);
    ctx.fillStyle = flash < 0 ? colors.miss : colors.crema;
    ctx.fill();
    // Top gloss
    ctx.globalAlpha = 0.08;
    roundedRect(meterX + 2, meterY + 2, meterW - 4, 8, 8);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.globalAlpha = 1;

    // Feedback text
    ctx.font = '600 18px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (flash > 0) {
      ctx.fillStyle = colors.crema;
      ctx.fillText('Perfect extraction!', w / 2, meterY - 24);
    } else if (flash < 0) {
      ctx.fillStyle = colors.miss;
      ctx.fillText('Over/Under — Reorg!', w / 2, meterY - 24);
    }

    // Particles draw
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      roundedRect(p.x, p.y, 3, 3, 1);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function roundedRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function spawnParticles(kind) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const meterW = Math.min(640, Math.max(320, w * 0.8));
    const meterX = (w - meterW) / 2;
    const meterY = h * 0.72;
    const markerX = meterX + markerPos * meterW;
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = kind === 'success' ? 1.8 : 1.2;
      particles.push({
        x: markerX,
        y: meterY + 8,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - (kind === 'success' ? 0.6 : 0.2),
        life: 0.6 + Math.random() * 0.4,
        color: kind === 'success' ? colors.crema : colors.miss,
      });
    }
  }

  function animateBump(el) {
    if (!el) return;
    el.classList.remove('bump');
    // force reflow
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function persistBest() {
    if (confirmed > best) {
      best = confirmed;
      localStorage.setItem('espresso_best', String(best));
      animateBump(bestEl);
    }
    if (combo > bestCombo) {
      bestCombo = combo;
      localStorage.setItem('espresso_best_combo', String(bestCombo));
      animateBump(bestComboEl);
    }
  }

  function resetGame() {
    markerPos = 0;
    markerDir = 1;
    speed = 0.65;
    greenCenter = 0.5;
    greenWidth = 0.18;
    confirmed = 0;
    reorgs = 0;
    combo = 0;
    flash = 0;
    bridgeT = 0;
    particles.length = 0;
    updateHud();
  }

  // Main loop
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(1 / 30, (now - lastT) / 1000);
    lastT = now;
    if (running) {
      update(dt);
      draw();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  updateHud();
  bestEl && (bestEl.textContent = String(best));
  bestComboEl && (bestComboEl.textContent = 'x' + String(bestCombo));
  startSteam();
})();


