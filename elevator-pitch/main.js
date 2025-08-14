/* Minimal MVP loader wiring the sentences file and basic UI hooks. */
(function () {
  const sentences = (window.ELEVATOR_PITCH_SENTENCES || []).slice();
  let currentIndex = 0;
  let score = 0;
  let timerId = null;
  let remaining = 30;
  let placed = [];
  let trayTiles = [];
  let wrongSubmissions = 0;
  let consecutivePerfects = 0;
  let lockedIndices = new Set();

  const els = {
    clock: document.getElementById('clock'),
    score: document.getElementById('score'),
    level: document.getElementById('level'),
    workspace: document.getElementById('workspace'),
    tray: document.getElementById('tray'),
    submit: document.getElementById('submit'),
    shuffle: document.getElementById('shuffle'),
    hint: document.getElementById('hint'),
    undo: document.getElementById('undo'),
    modal: document.getElementById('result'),
    resultTitle: document.getElementById('result-title'),
    resultDetail: document.getElementById('result-detail'),
    next: document.getElementById('next'),
    replay: document.getElementById('replay')
  };

  function padTime(n) {
    return String(n).padStart(2, '0');
  }

  function startLevel() {
    const text = sentences[currentIndex] || 'Nice job.';
    els.level.textContent = String(currentIndex + 1);
    setupBoard(text);
    setupTimer(text);
    render();
  }

  function setupBoard(text) {
    lockedIndices = new Set();
    // Pre-fill and lock all spaces; only letters/punct are to be solved
    placed = Array.from(text).map((ch, i) => {
      if (ch === ' ') { lockedIndices.add(i); return ' '; }
      return null;
    });
    // Tray contains only non-space characters
    trayTiles = shuffle(Array.from(text).filter((ch) => ch !== ' '));

    // Ensure at least one pre-placed (locked) letter per word
    const wordRanges = [];
    for (let i = 0; i < text.length;) {
      while (i < text.length && text[i] === ' ') i++;
      if (i >= text.length) break;
      const start = i;
      while (i < text.length && text[i] !== ' ') i++;
      const end = i - 1;
      wordRanges.push([start, end]);
    }
    for (const [start, end] of wordRanges) {
      // pick the first alphabetic in the word if possible; else the start
      let pick = start;
      for (let j = start; j <= end; j++) {
        if (/^[A-Za-z]$/.test(text[j])) { pick = j; break; }
      }
      prePlaceAt(pick, text);
    }

    // Additional hints: ~30% of non-space characters (including punctuation)
    const nonSpaceIndices = Array.from(text).map((_, i) => i).filter((i) => text[i] !== ' ' && !lockedIndices.has(i));
    shuffle(nonSpaceIndices);
    const totalNonSpace = text.replace(/\s/g, '').length;
    const targetHintCount = Math.max(1, Math.floor(totalNonSpace * 0.45));
    let currentHintCount = Array.from(lockedIndices).filter((i) => text[i] !== ' ').length;
    for (let k = 0; currentHintCount < targetHintCount && k < nonSpaceIndices.length; k++) {
      const i = nonSpaceIndices[k];
      prePlaceAt(i, text);
      currentHintCount++;
    }

    wrongSubmissions = 0;
  }

  function prePlaceAt(i, text) {
    if (i == null || lockedIndices.has(i)) return;
    const ch = text[i];
    const tIdx = trayTiles.findIndex((c) => c === ch);
    if (tIdx >= 0) trayTiles.splice(tIdx, 1);
    placed[i] = ch;
    lockedIndices.add(i);
  }

  function setupTimer(text) {
    const len = text.length;
    const seconds = Math.min(150, Math.max(10, Math.round(8 + len * 1.6)));
    remaining = seconds;
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      remaining -= 1;
      updateClock();
      if (remaining <= 0) {
        clearInterval(timerId);
        autoSubmit();
      }
    }, 1000);
    updateClock();
    updateTimebar();
  }

  function updateClock() {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    els.clock.textContent = `${padTime(m)}:${padTime(s)}`;
    updateTimebar();
  }

  function updateTimebar() {
    const fill = document.getElementById('timefill');
    if (!fill) return;
    const text = sentences[currentIndex] || '';
    const total = Math.min(150, Math.max(10, Math.round(8 + text.length * 1.6)));
    const ratio = Math.max(0, Math.min(1, remaining / total));
    fill.style.width = `${Math.round(ratio * 100)}%`;
  }

  function render() {
    // workspace slots
    els.workspace.innerHTML = '';
    placed.forEach((ch, idx) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.index = String(idx);
      slot.textContent = ch ?? '';
      if (lockedIndices.has(idx)) slot.classList.add('locked');
      if (placed[idx] === ' ') slot.classList.add('space');
      slot.addEventListener('click', () => removeAt(idx));
      els.workspace.appendChild(slot);
    });
    // tray tiles
    els.tray.innerHTML = '';
    trayTiles.forEach((ch, i) => {
      const t = document.createElement('div');
      t.className = 'tile';
      t.textContent = ch;
      t.addEventListener('click', () => placeNextFromTray(i));
      t.draggable = true;
      t.addEventListener('dragstart', (e) => onDragStart(e, i));
      els.tray.appendChild(t);
    });

    // enable drop on slots
    Array.from(els.workspace.children).forEach((slotEl) => {
      slotEl.addEventListener('dragover', onDragOver);
      slotEl.addEventListener('drop', (e) => onDrop(e, Number(slotEl.dataset.index)));
    });
  }

  function firstEmptyIndex() {
    return placed.findIndex((v) => v == null);
  }

  function placeNextFromTray(trayIndex) {
    const idx = firstEmptyIndex();
    if (idx < 0) return;
    const [ch] = trayTiles.splice(trayIndex, 1);
    placed[idx] = ch;
    render();
  }

  function onDragStart(ev, trayIndex) {
    ev.dataTransfer.setData('text/plain', String(trayIndex));
    ev.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(ev) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
  }
  function onDrop(ev, slotIndex) {
    ev.preventDefault();
    const data = ev.dataTransfer.getData('text/plain');
    const trayIndex = Number(data);
    if (Number.isNaN(trayIndex)) return;
    if (lockedIndices.has(slotIndex)) return; // cannot drop on locked slots
    if (placed[slotIndex] != null) {
      // push existing char back to tray first
      trayTiles.push(placed[slotIndex]);
    }
    const [ch] = trayTiles.splice(trayIndex, 1);
    placed[slotIndex] = ch;
    render();
  }

  function removeAt(idx) {
    if (lockedIndices.has(idx)) return;
    const ch = placed[idx];
    if (ch == null) return;
    trayTiles.push(ch);
    placed[idx] = null;
    render();
  }

  function computeScore(text, isCorrect) {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const base = 100 * words;
    const timeBonus = Math.max(0, remaining) * 10;
    const hintPenalty = 0; // tracked per-level if expanded
    let total = base + (isCorrect ? timeBonus : 0) - hintPenalty - (wrongSubmissions * 20);
    if (isCorrect && wrongSubmissions === 0) {
      const multiplier = 1 + 0.05 * consecutivePerfects;
      total = Math.round(total * multiplier);
    }
    return Math.max(0, total);
  }

  function submit() {
    const text = sentences[currentIndex];
    const answer = placed.map((c) => c ?? ' ').join('');
    const isFull = placed.every((c) => c != null);
    const isCorrect = isFull && answer === text;
    if (!isFull || !isCorrect) {
      els.workspace.classList.remove('shake');
      // trigger reflow to restart animation
      void els.workspace.offsetWidth;
      els.workspace.classList.add('shake');
      wrongSubmissions += 1;
      remaining = Math.max(0, remaining - 5);
      updateClock();
    }
    const gained = computeScore(text, isCorrect);
    if (isCorrect) { score += gained; consecutivePerfects += (wrongSubmissions === 0 ? 1 : 0); } else { score = Math.max(0, score - 20); consecutivePerfects = 0; }
    els.score.textContent = String(score);
    showResult(isCorrect, gained);
    clearInterval(timerId);
  }

  function autoSubmit() {
    submit();
  }

  function showResult(ok, gained) {
    els.resultTitle.textContent = ok ? 'Correct!' : 'Time up / Incorrect';
    els.resultDetail.textContent = ok ? `+${gained} points` : `-${20} penalty`;
    els.modal.hidden = false;
  }

  function next() {
    currentIndex = (currentIndex + 1) % Math.max(1, sentences.length);
    els.modal.hidden = true;
    startLevel();
  }

  function replay() {
    els.modal.hidden = true;
    startLevel();
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // controls
  els.submit.addEventListener('click', submit);
  els.shuffle.addEventListener('click', () => { trayTiles = shuffle(trayTiles); render(); });
  els.undo.addEventListener('click', () => {
    const idx = placed.slice().reverse().findIndex((c) => c != null);
    if (idx >= 0) removeAt(placed.length - 1 - idx);
  });
  els.hint.addEventListener('click', () => {
    const text = sentences[currentIndex];
    // find first incorrect or empty slot and place correct char (simple hint)
    for (let i = 0; i < placed.length; i++) {
      if (lockedIndices.has(i)) continue;
      if (placed[i] !== text[i]) {
        // if already placed but wrong, push it back to tray
        if (placed[i] != null) trayTiles.push(placed[i]);
        // take a matching char from tray if available; else insert from thin air
        const tIdx = trayTiles.findIndex((c) => c === text[i]);
        if (tIdx >= 0) {
          trayTiles.splice(tIdx, 1);
        }
        placed[i] = text[i];
        lockedIndices.add(i); // lock hinted letter
        break;
      }
    }
    render();
  });

  // keyboard controls
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') {
      const lastIdx = placed.slice().reverse().findIndex((c) => c != null);
      if (lastIdx >= 0) removeAt(placed.length - 1 - lastIdx);
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') { submit(); return; }
    if (e.key.toLowerCase() === 's') { trayTiles = shuffle(trayTiles); render(); return; }
    if (e.key.toLowerCase() === 'h') { els.hint.click(); return; }
    if (/^[0-9]$/.test(e.key)) {
      const idx = Number(e.key);
      if (idx >= 0 && idx < placed.length) {
        // focus-like behavior: remove if occupied
        if (placed[idx] != null) removeAt(idx);
      }
      return;
    }
    const ch = e.key.length === 1 ? e.key : '';
    if (ch) {
      const ti = trayTiles.findIndex(c => c === ch);
      if (ti >= 0) placeNextFromTray(ti);
    }
  });

  els.next.addEventListener('click', next);
  els.replay.addEventListener('click', replay);

  // Randomize sentence order for each session
  shuffle(sentences);
  // kick off
  startLevel();
})();


