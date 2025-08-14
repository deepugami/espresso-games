(function () {
  // Only initialize on Brew & Boost page
  if (!/\/brew-boost\/index\.html$/.test(location.pathname)) return;
  if (window.__bgAudioInit) return; window.__bgAudioInit = true;

  const STYLE = `
  .bg-audio-toggle { position: fixed; bottom: 12px; left: 12px; z-index: 9999; }
  .bg-audio-toggle button {
    display: grid; place-items: center;
    width: 38px; height: 38px; border-radius: 12px;
    border: 1px solid color-mix(in oklab, var(--espresso-4, #8a4b2a), black 30%);
    background: linear-gradient(180deg,
      color-mix(in oklab, var(--espresso-4, #8a4b2a), black 20%),
      var(--espresso-2, #4a2b17)
    );
    color: var(--text, #f5efe9);
    cursor: pointer; font-size: 16px; padding: 0;
    box-shadow: 0 8px 20px rgba(0,0,0,.25);
    backdrop-filter: blur(4px);
  }
  .bg-audio-toggle button:hover {
    border-color: color-mix(in oklab, var(--accent, #2fd27a), black 35%);
    box-shadow: 0 10px 26px rgba(0,0,0,.3);
  }
  .bg-audio-toggle button:active { transform: translateY(1px); }
  .bg-audio-toggle .icon { display: grid; place-items: center; width: 100%; height: 100%; line-height: 1; text-align: center; }
  `;

  // Inject style
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  // Build relative path to root audio file
  function audioPath() {
    const pathname = (window.location.pathname || '').replace(/\\/g, '/');
    const parts = pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    const isFile = /\.[a-z0-9]+$/i.test(last);
    const baseDirs = isFile ? (parts.length - 1) : parts.length;
    const prefix = '../'.repeat(Math.max(0, baseDirs));
    return prefix + 'audio.mp3';
  }

  const storageKey = 'bgAudioMuted';
  const mutedInitial = localStorage.getItem(storageKey) === '1';

  const audio = document.createElement('audio');
  audio.id = 'bg-music';
  audio.src = audioPath();
  audio.loop = true;
  audio.preload = 'auto';
  audio.muted = mutedInitial;
  audio.volume = 0.4;
  audio.autoplay = true;
  audio.setAttribute('playsinline', '');
  audio.style.display = 'none';
  document.body.appendChild(audio);

  const wrap = document.createElement('div');
  wrap.className = 'bg-audio-toggle';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', mutedInitial ? 'Unmute music' : 'Mute music');
  btn.innerHTML = `<span class="icon">${mutedInitial ? '🔇' : '🔊'}</span>`;
  btn.addEventListener('click', () => {
    audio.muted = !audio.muted;
    localStorage.setItem(storageKey, audio.muted ? '1' : '0');
    btn.setAttribute('aria-label', audio.muted ? 'Unmute music' : 'Mute music');
    btn.querySelector('.icon').textContent = audio.muted ? '🔇' : '🔊';
    if (!audio.muted) {
      tryPlay();
    }
  });
  wrap.appendChild(btn);
  document.body.appendChild(wrap);

  // Hint UI if playback is blocked
  const hint = document.createElement('div');
  hint.className = 'bg-audio-hint';
  hint.textContent = 'Tap to enable sound';
  hint.style.cssText = 'position:fixed;bottom:58px;left:12px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.2);color:#fff;padding:6px 10px;border-radius:10px;font-size:12px;z-index:9999;display:none;';
  document.body.appendChild(hint);

  let retries = 0;
  let playing = false;
  function tryPlay() {
    if (audio.muted || playing) return;
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(() => { playing = true; hideHint(); detachResumeListeners(); })
       .catch(() => { showHint(); scheduleRetry(); });
    }
  }
  function scheduleRetry() {
    if (retries++ > 5) return; // give up after a few retries until user interacts
    setTimeout(() => { tryPlay(); }, 800);
  }
  function showHint() { hint.style.display = 'block'; }
  function hideHint() { hint.style.display = 'none'; }

  function resumeOnce() { tryPlay(); }
  function attachResumeListeners() {
    const opts = { capture: true };
    window.addEventListener('pointerdown', resumeOnce, opts);
    window.addEventListener('pointerup', resumeOnce, opts);
    window.addEventListener('click', resumeOnce, opts);
    window.addEventListener('touchstart', resumeOnce, opts);
    window.addEventListener('mousedown', resumeOnce, opts);
    window.addEventListener('keydown', resumeOnce, opts);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tryPlay(); }, opts);
    window.addEventListener('pageshow', tryPlay, opts);
  }
  function detachResumeListeners() {
    const opts = { capture: true };
    window.removeEventListener('pointerdown', resumeOnce, opts);
    window.removeEventListener('pointerup', resumeOnce, opts);
    window.removeEventListener('click', resumeOnce, opts);
    window.removeEventListener('touchstart', resumeOnce, opts);
    window.removeEventListener('mousedown', resumeOnce, opts);
    window.removeEventListener('keydown', resumeOnce, opts);
    window.removeEventListener('pageshow', tryPlay, opts);
  }

  // Attempt autoplay; if blocked, show hint and wait for interaction
  attachResumeListeners();
  tryPlay();
})();


