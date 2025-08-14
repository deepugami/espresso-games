(function () {
  'use strict';

  // --- Config ---
  const IMAGE_LIST = [
    '1127.png','1692.png','2036.png','2143.png','2185.png','3075.png',
    '314.png','3575.png','4294.png','4318.png','749.png','865.png','874.png'
  ];
  const HINTS_MAX = 3;
  const TIMER_SECONDS = 180; // 3 minutes; can randomize to 5 for harder
  const SNAP_THRESHOLD_RATIO = 0.4; // portion of piece size

  // --- State ---
  let imagePath = '';
  let imageElement = null;
  let cols = 5, rows = 5; // 25 pieces default; may switch to 4x5
  let boardWidth = 600, boardHeight = 600;
  let cellWidth = 120, cellHeight = 120;
  let startTimestamp = 0;
  let timerRemaining = TIMER_SECONDS;
  let timerInterval = null;
  let placedCount = 0;
  let hintsUsed = 0;
  let isGameOver = false;
  let pieces = []; // array of piece objects
  let dragState = null;
  let placedByPlayerCount = 0;
  let isInitializing = false;

  // --- Elements ---
  const board = document.getElementById('board');
  const boardWrap = document.getElementById('boardWrap');
  const piecesTray = document.getElementById('pieces');
  const guideOverlay = document.getElementById('guideOverlay');
  const timeEl = document.getElementById('time');
  const timerFill = document.getElementById('timerFill');
  const scoreEl = document.getElementById('score');
  const hintsLeftEl = document.getElementById('hintsLeft');
  const hintBtn = document.getElementById('hintBtn');
  const restartBtn = document.getElementById('restartBtn');
  const nextImgBtn = document.getElementById('nextImgBtn');
  const modal = document.getElementById('modal');
  const modalReplay = document.getElementById('modalReplay');
  const modalNew = document.getElementById('modalNew');
  const resultTimeEl = document.getElementById('resultTime');
  const resultScoreEl = document.getElementById('resultScore');
  const beanRatingEl = document.getElementById('beanRating');

  // --- Simple SFX via WebAudio ---
  const Audio = (function () {
    let ctx = null;
    function getCtx() {
      if (!ctx) {
        // Lazily create on first user input to satisfy autoplay policies
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      return ctx;
    }
    function envGain(duration = 0.12, curve = 'exp', start = 0.0001, peak = 0.12) {
      const ac = getCtx();
      const g = ac.createGain();
      g.gain.setValueAtTime(start, ac.currentTime);
      if (curve === 'exp') {
        g.gain.exponentialRampToValueAtTime(peak, ac.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(start, ac.currentTime + duration);
      } else {
        g.gain.linearRampToValueAtTime(peak, ac.currentTime + 0.01);
        g.gain.linearRampToValueAtTime(start, ac.currentTime + duration);
      }
      return g;
    }
    function click() {
      const ac = getCtx();
      const osc = ac.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, ac.currentTime);
      const g = envGain(0.09, 'exp', 0.0001, 0.2);
      osc.connect(g).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.1);
    }
    function drip() {
      const ac = getCtx();
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(380, ac.currentTime);
      const g = envGain(0.04, 'exp', 0.0001, 0.05);
      osc.connect(g).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.05);
    }
    function ding() {
      const ac = getCtx();
      const g = envGain(0.6, 'exp', 0.0001, 0.3);
      const o1 = ac.createOscillator(); o1.type = 'sine'; o1.frequency.setValueAtTime(880, ac.currentTime);
      const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.setValueAtTime(1320, ac.currentTime);
      const o3 = ac.createOscillator(); o3.type = 'sine'; o3.frequency.setValueAtTime(1760, ac.currentTime);
      o1.connect(g); o2.connect(g); o3.connect(g); g.connect(ac.destination);
      o1.start(); o2.start(); o3.start();
      const t = ac.currentTime + 0.5; o1.stop(t); o2.stop(t); o3.stop(t);
    }
    function unlockOnFirstGesture() {
      const resume = () => { try { getCtx().resume(); } catch (e) {} cleanup(); };
      const cleanup = () => {
        window.removeEventListener('pointerdown', resume, true);
        window.removeEventListener('keydown', resume, true);
        window.removeEventListener('touchstart', resume, true);
      };
      window.addEventListener('pointerdown', resume, true);
      window.addEventListener('keydown', resume, true);
      window.addEventListener('touchstart', resume, true);
    }
    return { click, drip, ding, unlockOnFirstGesture };
  })();

  // --- Utils ---
  function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  function computeFinalScore() {
    const totalPieces = cols * rows;
    return (totalPieces * 100) + (timerRemaining * 50) - (hintsUsed * 150);
  }
  function computeLiveScore() {
    return (placedByPlayerCount * 100) - (hintsUsed * 150);
  }
  function rateBeans(score) {
    const totalPieces = cols * rows;
    const maxScore = (totalPieces * 100) + (TIMER_SECONDS * 50);
    const p = score / Math.max(1, maxScore);
    if (p >= 0.8) return 3;
    if (p >= 0.5) return 2;
    return 1;
  }

  // --- Layout / Board sizing ---
  function computeBoardSize(naturalW, naturalH) {
    const maxW = Math.min(window.innerWidth * 0.92, 760);
    const hudSpace = 220; // approximate vertical space for header + hud
    const maxH = Math.min(window.innerHeight - hudSpace, 760);
    const scale = Math.min(maxW / naturalW, maxH / naturalH);
    return { w: Math.floor(naturalW * scale), h: Math.floor(naturalH * scale) };
  }

  function setTimeUI() {
    timeEl.textContent = fmtTime(timerRemaining);
    const pct = clamp(timerRemaining / TIMER_SECONDS, 0, 1);
    timerFill.style.height = `${Math.round(pct * 100)}%`;
  }

  function updateScoreUI() {
    scoreEl.textContent = `${computeLiveScore()}`;
  }

  function clearBoard() {
    board.innerHTML = '';
    piecesTray.innerHTML = '';
    pieces = [];
    placedCount = 0;
    dragState = null;
  }

  function setupPieces() {
    // Random difficulty: 4x5 (20) or 5x5 (25)
    const opts = [ [4,5], [5,5] ];
    [cols, rows] = choice(opts);

    const natW = imageElement.naturalWidth;
    const natH = imageElement.naturalHeight;
    const size = computeBoardSize(natW, natH);
    boardWidth = size.w; boardHeight = size.h;
    board.style.width = `${boardWidth}px`;
    board.style.height = `${boardHeight}px`;
    board.style.setProperty('--cell-w', `${boardWidth / cols}px`);
    board.style.setProperty('--cell-h', `${boardHeight / rows}px`);

    guideOverlay.style.backgroundImage = `url(${imagePath})`;
    guideOverlay.style.backgroundSize = `${boardWidth}px ${boardHeight}px`;

    // Cell size
    cellWidth = Math.floor(boardWidth / cols);
    cellHeight = Math.floor(boardHeight / rows);

    const bgSize = `${boardWidth}px ${boardHeight}px`;

    isInitializing = true;
    // Create piece elements
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ix = r * cols + c;
        const px = c * cellWidth;
        const py = r * cellHeight;
        const el = document.createElement('div');
        el.className = 'piece';
        el.style.width = `${cellWidth}px`;
        el.style.height = `${cellHeight}px`;
        el.style.backgroundImage = `url(${imagePath})`;
        el.style.setProperty('--bg-w', `${boardWidth}px`);
        el.style.setProperty('--bg-h', `${boardHeight}px`);
        el.style.backgroundSize = bgSize;
        el.style.backgroundPosition = `${-px}px ${-py}px`;
        el.setAttribute('draggable', 'false');
        el.setAttribute('aria-grabbed', 'false');
        el.dataset.index = `${ix}`;
        el.dataset.correctX = `${px}`;
        el.dataset.correctY = `${py}`;
        applyPieceMask(el, c, r);
        // Random scatter in tray area initially
        const trayW = piecesTray.clientWidth || boardWidth;
        const trayH = Math.max(120, piecesTray.clientHeight);
        const rx = Math.floor(Math.random() * Math.max(1, trayW - cellWidth));
        const ry = Math.floor(Math.random() * Math.max(1, trayH - cellHeight));
        el.style.left = `${rx}px`;
        el.style.top = `${ry}px`;
        piecesTray.appendChild(el);
        pieces.push({ el, placed: false, correctX: px, correctY: py });
        attachDrag(el);
      }
    }

    // Pre-place 3-5 random pieces correctly and lock them
    const mustPlace = Math.floor(Math.random() * 3) + 3; // 3..5
    const indices = Array.from({ length: pieces.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const selected = indices.slice(0, mustPlace);
    selected.forEach((idx) => {
      const p = pieces[idx];
      lockPiece(p.el);
    });
    isInitializing = false;
    updateScoreUI();
  }

  function lockPiece(el) {
    const correctX = parseInt(el.dataset.correctX, 10);
    const correctY = parseInt(el.dataset.correctY, 10);
    el.classList.add('locked');
    el.style.left = `${correctX}px`;
    el.style.top = `${correctY}px`;
    if (el.parentElement !== board) {
      board.appendChild(el);
    }
    const ix = parseInt(el.dataset.index, 10);
    const pObj = pieces[ix];
    if (pObj && !pObj.placed) {
      pObj.placed = true;
      placedCount += 1;
      if (!isInitializing) {
        placedByPlayerCount += 1;
      }
      updateScoreUI();
    }
  }

  function applyPieceMask(el, col, row) {
    // Create an inward-notch jigsaw-like mask using SVG (stays within the tile bounds)
    const w = cellWidth; const h = cellHeight;
    const notchR = Math.floor(Math.min(w, h) * 0.14);
    const cx = Math.floor(w / 2); const cy = Math.floor(h / 2);
    const topInterior = row > 0;
    const bottomInterior = row < (rows - 1);
    const leftInterior = col > 0;
    const rightInterior = col < (cols - 1);

    const rect = `<rect x="0" y="0" width="${w}" height="${h}" rx="${Math.max(4, Math.floor(Math.min(w,h)*0.08))}" ry="${Math.max(4, Math.floor(Math.min(w,h)*0.08))}" fill="#fff"/>`;
    const holes = [
      topInterior ? `<circle cx="${cx}" cy="0" r="${notchR}" fill="#000"/>` : '',
      bottomInterior ? `<circle cx="${cx}" cy="${h}" r="${notchR}" fill="#000"/>` : '',
      leftInterior ? `<circle cx="0" cy="${cy}" r="${notchR}" fill="#000"/>` : '',
      rightInterior ? `<circle cx="${w}" cy="${cy}" r="${notchR}" fill="#000"/>` : ''
    ].join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${rect}${holes}</svg>`;
    const encoded = encodeURIComponent(svg)
      .replace(/'/g, '%27')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
    const url = `url("data:image/svg+xml;utf8,${encoded}")`;
    el.style.webkitMaskImage = url;
    el.style.maskImage = url;
    el.style.webkitMaskRepeat = 'no-repeat';
    el.style.maskRepeat = 'no-repeat';
    el.style.webkitMaskSize = '100% 100%';
    el.style.maskSize = '100% 100%';
  }

  function attachDrag(el) {
    const onDown = (ev) => {
      if (isGameOver) return;
      const target = el;
      if (target.classList.contains('locked')) return;
      const isPointer = ev instanceof PointerEvent;
      const ptX = isPointer ? ev.clientX : (ev.touches ? ev.touches[0].clientX : 0);
      const ptY = isPointer ? ev.clientY : (ev.touches ? ev.touches[0].clientY : 0);
      const rect = target.getBoundingClientRect();
      target.setAttribute('aria-grabbed', 'true');
      target.style.zIndex = '10';
      dragState = {
        target,
        offsetX: ptX - rect.left,
        offsetY: ptY - rect.top,
        fromTray: target.parentElement === piecesTray
      };
      target.setPointerCapture && target.setPointerCapture(ev.pointerId || 0);
      ev.preventDefault();
    };
    const onMove = (ev) => {
      if (!dragState || dragState.target !== el) return;
      const isPointer = ev instanceof PointerEvent;
      const ptX = isPointer ? ev.clientX : (ev.touches ? ev.touches[0].clientX : 0);
      const ptY = isPointer ? ev.clientY : (ev.touches ? ev.touches[0].clientY : 0);
      const parentRect = (dragState.fromTray ? piecesTray : board).getBoundingClientRect();
      const x = clamp(ptX - parentRect.left - dragState.offsetX, -2000, 2000);
      const y = clamp(ptY - parentRect.top - dragState.offsetY, -2000, 2000);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };
    const onUp = (ev) => {
      if (!dragState || dragState.target !== el) return;
      el.setAttribute('aria-grabbed', 'false');
      el.style.zIndex = '';
      const correctX = parseInt(el.dataset.correctX, 10);
      const correctY = parseInt(el.dataset.correctY, 10);
      // Compute current position relative to board
      const currentParent = el.parentElement;
      let curX = parseFloat(el.style.left) || 0;
      let curY = parseFloat(el.style.top) || 0;
      if (currentParent === piecesTray) {
        // Translate tray coords to board coords to test snapping
        const trayRect = piecesTray.getBoundingClientRect();
        const boardRect = board.getBoundingClientRect();
        curX = (curX + trayRect.left) - boardRect.left;
        curY = (curY + trayRect.top) - boardRect.top;
      }
      const dx = Math.abs(curX - correctX);
      const dy = Math.abs(curY - correctY);
      if (dx <= cellWidth * SNAP_THRESHOLD_RATIO && dy <= cellHeight * SNAP_THRESHOLD_RATIO) {
        // Snap into board
        lockPiece(el);
        Audio.click();
        if (placedCount >= cols * rows) {
          win();
        }
      }
      dragState = null;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    // Touch support fallback
    el.addEventListener('touchstart', onDown, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onUp, { passive: false });
  }

  // --- Game flow ---
  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (isGameOver) return;
      timerRemaining -= 1;
      setTimeUI();
      if (timerRemaining % 1 === 0) { Audio.drip(); }
      if (timerRemaining <= 0) {
        timerRemaining = 0;
        setTimeUI();
        lose();
      }
    }, 1000);
  }

  function showHint() {
    if (isGameOver) return;
    if (hintsUsed >= HINTS_MAX) return;
    hintsUsed += 1;
    hintsLeftEl.textContent = `${HINTS_MAX - hintsUsed}`;
    guideOverlay.style.opacity = '0.6';
    setTimeout(() => { guideOverlay.style.opacity = '0'; }, 1200);
    updateScoreUI();
  }

  function win() {
    if (isGameOver) return;
    isGameOver = true;
    clearInterval(timerInterval);
    const score = computeFinalScore();
    resultScoreEl.textContent = `${score}`;
    resultTimeEl.textContent = fmtTime(TIMER_SECONDS - timerRemaining);
    const beans = rateBeans(score);
    beanRatingEl.textContent = '☕'.repeat(beans);
    document.getElementById('modalTitle').textContent = 'Brew-tiful! You completed the puzzle!';
    modal.setAttribute('aria-hidden', 'false');
    Audio.ding();
    // Reflect final score in HUD too
    scoreEl.textContent = `${score}`;
  }

  function lose() {
    if (isGameOver) return;
    isGameOver = true;
    clearInterval(timerInterval);
    const score = computeFinalScore();
    resultScoreEl.textContent = `${score}`;
    resultTimeEl.textContent = fmtTime(TIMER_SECONDS);
    beanRatingEl.textContent = '☕';
    document.getElementById('modalTitle').textContent = 'Out of time! Give it another brew.';
    modal.setAttribute('aria-hidden', 'false');
  }

  function resetState() {
    isGameOver = false;
    placedCount = 0;
    placedByPlayerCount = 0;
    hintsUsed = 0;
    hintsLeftEl.textContent = `${HINTS_MAX}`;
    timerRemaining = TIMER_SECONDS;
    setTimeUI();
    // Show 0 at start
    scoreEl.textContent = '0';
  }

  function loadImageAndSetup(src) {
    imageElement = new Image();
    imageElement.onload = () => {
      resetState();
      clearBoard();
      setupPieces();
      startTimestamp = performance.now();
      startTimer();
    };
    imageElement.onerror = () => {
      console.error('Failed to load image', src);
    };
    imageElement.src = src;
  }

  function startNewGame(newRandomImage) {
    if (newRandomImage) {
      imagePath = `images/${choice(IMAGE_LIST)}`;
    }
    loadImageAndSetup(imagePath);
  }

  function init() {
    Audio.unlockOnFirstGesture();
    imagePath = `images/${choice(IMAGE_LIST)}`;
    startNewGame(false);
    // Controls
    hintBtn.addEventListener('click', showHint);
    restartBtn.addEventListener('click', () => startNewGame(false));
    nextImgBtn.addEventListener('click', () => { imagePath = `images/${choice(IMAGE_LIST)}`; startNewGame(false); });
    modalReplay.addEventListener('click', () => { modal.setAttribute('aria-hidden', 'true'); startNewGame(false); });
    modalNew.addEventListener('click', () => { modal.setAttribute('aria-hidden', 'true'); imagePath = `images/${choice(IMAGE_LIST)}`; startNewGame(false); });
    // Resize handling: recompute board and reposition locked pieces
    window.addEventListener('resize', () => {
      if (!imageElement || !imageElement.naturalWidth) return;
      // Recreate from scratch to simplify responsive logic
      const prevImage = imagePath;
      startNewGame(false);
      imagePath = prevImage;
    });
  }

  // Start
  init();
})();


