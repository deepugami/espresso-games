(function () {
  const promptEl = document.getElementById('prompt');
  const inputEl = document.getElementById('hiddenInput');
  const wpmEl = document.getElementById('wpm');
  const accEl = document.getElementById('acc');
  const timeEl = document.getElementById('time');
  const bestEl = document.getElementById('best');
  const time30Btn = document.getElementById('time30');
  const time60Btn = document.getElementById('time60');
  const resetBtn = document.getElementById('resetBtn');
  const overlayEl = document.getElementById('overlay');
  const resWpmEl = document.getElementById('resWpm');
  const resAccEl = document.getElementById('resAcc');
  const playAgainBtn = document.getElementById('playAgain');

  const TEST_WINDOWS = [30, 60];
  let testSeconds = TEST_WINDOWS[0];
  let timeLeft = testSeconds;
  let running = false;

  // Build a shuffled deck for each round to avoid repeating during a run.
  const basePassages = Array.isArray(window.TYPE_ESPRESSO_TEXTS) && window.TYPE_ESPRESSO_TEXTS.length > 0
    ? window.TYPE_ESPRESSO_TEXTS.slice()
    : ["Type to begin. Texts are hardcoded in texts.js."];
  let deck = shuffle(basePassages.slice());
  function nextPassage() {
    if (deck.length === 0) deck = shuffle(basePassages.slice());
    return (deck.shift() || '').trim();
  }

  let current = nextPassage();
  let index = 0;
  let correct = 0;
  let total = 0;
  let bestWpm = Number(localStorage.getItem('type_best_wpm') || 0);
  let typed = "";
  let startAtMs = null;

  function renderPrompt() {
    const escaped = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tokens = current.split(/(\s+)/);
    let pos = 0;
    let beforeHtml = "";
    const typedLen = typed.length;
    for (const tok of tokens) {
      if (pos >= typedLen) break;
      const len = tok.length;
      const take = Math.min(typedLen - pos, len);
      const part = tok.slice(0, take);
      if (/^\s+$/.test(tok)) {
        // whitespace
        beforeHtml += `<span class="c-correct">${escaped(part)}</span>`;
      } else {
        const tseg = typed.slice(pos, pos + take);
        let mismatch = false;
        for (let i = 0; i < tseg.length; i++) { if (tseg[i] !== tok[i]) { mismatch = true; break; } }
        const klass = mismatch ? 'w-wrong' : 'c-correct';
        beforeHtml += `<span class="${klass}">${escaped(part)}</span>`;
      }
      pos += len;
    }
    const currentChar = current.charAt(typedLen) || ' ';
    const after = current.slice(typedLen + 1);
    promptEl.innerHTML =
      `${beforeHtml}<span class="c-current">${escaped(currentChar)}</span>` +
      `<span>${escaped(after)}</span>` +
      `<div class="meta">Press Space/Type to start • Backspace deletes</div>`;
  }

  function reset() {
    timeLeft = testSeconds;
    running = false;
    index = 0; correct = 0; total = 0;
    current = nextPassage();
    typed = "";
    startAtMs = null;
    updateStats();
    timeEl.textContent = `${timeLeft}s`;
    renderPrompt();
    hideOverlay();
  }

  function start() {
    if (running) return;
    running = true;
    startAtMs = performance.now();
    tick();
  }

  function end() {
    running = false;
    const wpm = computeWpm();
    if (wpm > bestWpm) {
      bestWpm = wpm;
      localStorage.setItem('type_best_wpm', String(bestWpm));
    }
    updateStats();
    showOverlay(wpm, total > 0 ? Math.round((correct / total) * 100) : 100);
  }

  function computeWpm() {
    let minutes;
    if (running && startAtMs != null) {
      minutes = (performance.now() - startAtMs) / 60000;
    } else {
      minutes = (testSeconds - timeLeft) / 60;
    }
    if (minutes <= 0) return 0;
    const words = correct / 5; // standard WPM calculation
    return Math.round(words / minutes);
  }

  function updateStats() {
    const wpm = computeWpm();
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 100;
    wpmEl.textContent = String(wpm);
    accEl.textContent = `${accuracy}%`;
    bestEl.textContent = String(bestWpm);
  }

  function tick() {
    if (!running) return;
    setTimeout(() => {
      timeLeft = Math.max(0, timeLeft - 1);
      timeEl.textContent = `${timeLeft}s`;
      if (timeLeft <= 0) end();
      else tick();
    }, 1000);
  }

  document.addEventListener('keydown', (e) => {
    if (!(document.activeElement === inputEl)) inputEl.focus();
    if (!running && e.key.length === 1 || e.code === 'Space') start();
    if (!running && e.key === 'Enter') { reset(); return; }
    if (!running) return;

    if (e.key === 'Backspace') {
      e.preventDefault();
      if (index > 0) {
        const removedChar = typed.slice(-1);
        const expectedPrev = current.charAt(index - 1);
        if (removedChar === expectedPrev) {
          correct = Math.max(0, correct - 1);
        }
        index--;
        total = Math.max(0, total - 1);
        typed = typed.slice(0, -1);
      }
      renderPrompt(); updateStats();
      return;
    }

    if (e.key.length === 1 || e.key === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      const expected = current.charAt(index);
      const ch = e.key === 'Enter' ? '\n' : (e.code === 'Space' ? ' ' : e.key);
      typed += ch;
      if (ch === expected) { index++; correct++; total++; }
      else { index++; total++; }
      if (index >= current.length) { // cycle to next passage
        current = nextPassage();
        index = 0;
        typed = "";
      }
      renderPrompt(); updateStats();
    }
  });

  // Choose test length
  function setWindow(sec) {
    testSeconds = sec;
    timeLeft = sec;
    timeEl.textContent = `${sec}s`;
    time30Btn.setAttribute('aria-pressed', String(sec === 30));
    time60Btn.setAttribute('aria-pressed', String(sec === 60));
    running = false;
  }
  time30Btn.addEventListener('click', () => { setWindow(30); reset(); });
  time60Btn.addEventListener('click', () => { setWindow(60); reset(); });

  resetBtn.addEventListener('click', () => reset());

  // Allow paste to replace passages quickly
  promptEl.addEventListener('paste', async (e) => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text');
    if (!t) return;
    const parts = t
      .replace(/\r\n/g, '\n')
      .split(/\n\s*\n/g)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) { passages = parts; reset(true); }
  });

  renderPrompt();
  updateStats();

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Modal helpers
  function showOverlay(wpm, acc) {
    resWpmEl.textContent = String(wpm);
    resAccEl.textContent = `${acc}%`;
    overlayEl.classList.add('show');
    overlayEl.setAttribute('aria-hidden', 'false');
  }
  function hideOverlay() {
    overlayEl.classList.remove('show');
    overlayEl.setAttribute('aria-hidden', 'true');
  }
  playAgainBtn.addEventListener('click', () => { reset(); inputEl.focus(); });
})();


