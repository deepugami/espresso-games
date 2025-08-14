/* Brew & Boost - Match-3 Core */
(() => {
  const gridEl = document.getElementById('grid');
  const scoreEl = document.getElementById('score');
  const movesEl = document.getElementById('moves');
  const levelEl = document.getElementById('level');
  const targetEl = document.getElementById('target');
  const overlayEl = document.getElementById('overlay');
  const resultTitleEl = document.getElementById('resultTitle');
  const resultDescEl = document.getElementById('resultDesc');
  const nextBtn = document.getElementById('nextBtn');
  const retryBtn = document.getElementById('retryBtn');
  const undoBtn = document.getElementById('undoBtn');
  const assistInput = document.getElementById('assist');

  const GRID_SIZE = 8;
  const TILE_TYPES = ['cup', 'mug', 'glass', 'kettle', 'paper', 'grinder', 'hot'];
  const BASE_POINTS = 100;
  const MAX_UNDOS = 1;
  const Booster = { None: 0, Double: 2, Triple: 3 };
  const BoosterArea = { None: 0, Row: 1, Col: 2, Area3: 3 };

  const LevelDefs = [
    { id: 1, type: 'collectAny', target: 20, moves: 20 },
    { id: 2, type: 'score', target: 20000, moves: 25 },
    { id: 3, type: 'score', target: 40000, moves: 25 },
  ];

  let levelIndex = 0;
  let state = null;
  let undoState = null;

  function createInitialState() {
    const level = LevelDefs[levelIndex];
    const grid = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      grid[r] = [];
      for (let c = 0; c < GRID_SIZE; c++) {
        grid[r][c] = randomTile();
      }
    }
    // Resolve any immediate matches at start by re-rolling cells involved
    fixInitialMatches(grid);
    ensurePotentialMoves(grid, requiredPotentialSwaps(), { animate: false });
    return {
      levelId: level.id,
      movesLeft: level.moves,
      score: 0,
      comboIndex: 0,
      grid,
      selected: null,
      busy: false,
      history: [],
      collectRemaining: level.type === 'collectAny' ? level.target : 0,
    };
  }

  function randomTile() {
    const type = TILE_TYPES[Math.floor(Math.random() * TILE_TYPES.length)];
    return { type, booster: Booster.None, createdBy: null };
  }

  function fixInitialMatches(grid) {
    // Re-roll tiles that form immediate 3+ matches to avoid freebies
    const hasAny = () => findAllMatches(grid).length > 0;
    let guard = 0;
    while (hasAny() && guard++ < 50) {
      const matches = findAllMatches(grid);
      for (const group of matches) {
        for (const { r, c } of group.cells) {
          grid[r][c] = randomTile();
        }
      }
    }
  }

  function mountGrid() {
    gridEl.style.setProperty('--size', GRID_SIZE);
    sizeGridToViewport();
    gridEl.innerHTML = '';
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const tileEl = document.createElement('button');
        tileEl.className = 'tile';
        tileEl.setAttribute('data-r', String(r));
        tileEl.setAttribute('data-c', String(c));
        tileEl.addEventListener('click', onTileClick);
        tileEl.addEventListener('pointerdown', onPointerDown);
        gridEl.appendChild(tileEl);
      }
    }
    render();
  }

  function sizeGridToViewport() {
    const gap = 6;
    const padding = 24; // grid padding horizontal total (12px left + 12px right)
    const headerHeight = 24; // fixed HUD pinned to top-right with minimal height footprint
    // Controls are now fixed near top-left under HUD; exclude their height from grid calc
    const controlsEl = document.querySelector('.controls');
    const controlsHeight = 0;
    const verticalMargins = 6; // minimal breathing space
    const vw = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
    const vh = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight);
    const maxWidth = vw - 24; // side paddings
    const maxHeight = vh - headerHeight - verticalMargins;

    // Compute tile size from width and height constraints
    const tileFromWidth = Math.floor((maxWidth - padding - (GRID_SIZE - 1) * gap) / GRID_SIZE);
    const tileFromHeight = Math.floor((maxHeight - padding - (GRID_SIZE - 1) * gap) / GRID_SIZE);
    const tile = Math.max(40, Math.min(110, Math.min(tileFromWidth, tileFromHeight)));
    gridEl.style.setProperty('--tile', tile + 'px');
    gridEl.style.setProperty('--gap', gap + 'px');
    // Provide fall step for animation based on tile+gap
    const step = tile + gap;
    document.documentElement.style.setProperty('--fallStep', step + 'px');

    // Pin controls under HUD precisely
    if (controlsEl) {
      controlsEl.style.top = (12 + 8) + 'px';
    }
  }

  function makeIconEl(type) {
    const wrap = document.createElement('div');
    wrap.className = 'icon';
    const img = document.createElement('img');
    img.alt = type;
    img.src = `./icons/${type}.svg`;
    wrap.appendChild(img);
    return wrap;
  }

  function render() {
    const level = LevelDefs[levelIndex];
    levelEl.textContent = String(level.id);
    targetEl.textContent = level.type === 'score'
      ? String(level.target)
      : `${state.collectRemaining}/${level.target}`;
    scoreEl.textContent = String(state.score);
    movesEl.textContent = String(state.movesLeft);
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const tile = state.grid[r][c];
        const el = cellEl(r, c);
        el.classList.toggle('selected', state.selected && state.selected.r === r && state.selected.c === c);
        const boosterType = tile ? tile.booster : Booster.None;
        el.classList.toggle('dbl', boosterType === Booster.Double);
        el.classList.toggle('tri', boosterType === Booster.Triple);
        el.innerHTML = '';
        if (tile) {
          el.appendChild(makeIconEl(tile.type));
          if (boosterType === Booster.Double) {
            const b = document.createElement('div'); b.className = 'badge'; b.textContent = '×2'; el.appendChild(b);
          } else if (boosterType === Booster.Triple) {
            const b = document.createElement('div'); b.className = 'badge'; b.textContent = '×3'; el.appendChild(b);
          }
        }
        el.disabled = state.busy;
      }
    }
  }

  function cellEl(r, c) {
    return gridEl.children[r * GRID_SIZE + c];
  }

  function onTileClick(e) {
    if (state.busy) return;
    const el = e.currentTarget;
    const r = Number(el.getAttribute('data-r'));
    const c = Number(el.getAttribute('data-c'));
    const sel = state.selected;
    if (!sel) {
      state.selected = { r, c };
      render();
      return;
    }
    if (sel.r === r && sel.c === c) {
      state.selected = null;
      render();
      return;
    }
    if (isAdjacent(sel, { r, c })) {
      trySwap(sel, { r, c });
    } else {
      state.selected = { r, c };
      render();
    }
  }

  let dragFrom = null;
  function onPointerDown(e) {
    if (state.busy) return;
    const el = e.currentTarget;
    dragFrom = { r: Number(el.getAttribute('data-r')), c: Number(el.getAttribute('data-c')) };
    const onMove = (ev) => {
      if (!dragFrom) return;
      const dx = ev.movementX;
      const dy = ev.movementY;
      if (Math.abs(dx) + Math.abs(dy) < 12) return;
      let to = null;
      if (Math.abs(dx) > Math.abs(dy)) {
        to = { r: dragFrom.r, c: clamp(dragFrom.c + (dx > 0 ? 1 : -1), 0, GRID_SIZE - 1) };
      } else {
        to = { r: clamp(dragFrom.r + (dy > 0 ? 1 : -1), 0, GRID_SIZE - 1), c: dragFrom.c };
      }
      if (to && isAdjacent(dragFrom, to)) {
        trySwap(dragFrom, to);
        dragFrom = null;
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    const onUp = () => {
      dragFrom = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function isAdjacent(a, b) {
    return (a.r === b.r && Math.abs(a.c - b.c) === 1) || (a.c === b.c && Math.abs(a.r - b.r) === 1);
  }

  async function trySwap(a, b) {
    if (state.movesLeft <= 0) return;
    // Proactively ensure potential moves before allowing a swap (non-scoring)
    if (!ensurePotentialMoves(state.grid, requiredPotentialSwaps(), { animate: true })) {
      return; // wait one frame; render will re-enable
    }
    const grid = state.grid;
    // Preview validity
    swap(grid, a, b);
    const afterMatches = findAllMatches(grid);
    const involves = afterMatches.length > 0;
    // Check booster manual activation opportunity
    const preCreatedDirection = detectDirection(a, b);
    const boosterAtB = grid[b.r][b.c].booster && grid[b.r][b.c].booster !== Booster.None;
    const boosterAtA = grid[a.r][a.c].booster && grid[a.r][a.c].booster !== Booster.None;
    // Revert temp swap for animation
    swap(grid, a, b);
    // Animate swap
    state.busy = true;
    await animateSwap(a, b);
    // Apply real swap if valid or booster activation
    swap(grid, a, b);
    const canProceed = involves || boosterAtA || boosterAtB;
    if (!canProceed) {
      // No match and no boosters, revert
      await animateSwap(b, a); // animate back
      swap(grid, a, b);
      state.selected = null;
      state.busy = false;
      render();
      return;
    }
    pushUndo();
    state.selected = null;
    state.movesLeft -= 1;
    render();
    const createdDirection = preCreatedDirection;
    if (involves) {
      resolveBoard(findAllMatches(grid), { lastSwap: b, createdDirection })
        .then(() => {
          state.busy = false;
          checkWinLose();
          render();
        });
    } else {
      // Activate the booster that was swapped
      const pos = boosterAtB ? b : a;
      const comboMultiplier = 1; // First activation within a move
      activateBooster(pos, comboMultiplier).then(() => {
        const moves = applyGravity(state.grid);
        render();
        animateFalls(moves);
        return triggerChainedBoosters(comboMultiplier);
      }).then(() => {
        ensurePotentialMoves(state.grid, requiredPotentialSwaps(), { animate: true });
        state.busy = false;
        checkWinLose();
        render();
      });
    }
  }

  function detectDirection(a, b) {
    if (a.r === b.r) return 'h';
    if (a.c === b.c) return 'v';
    return 'h';
  }

  function swap(grid, a, b) {
    const tmp = grid[a.r][a.c];
    grid[a.r][a.c] = grid[b.r][b.c];
    grid[b.r][b.c] = tmp;
  }

  function findAllMatches(grid) {
    const visited = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(false));
    const groups = [];

    // Horizontal
    for (let r = 0; r < GRID_SIZE; r++) {
      let c = 0;
      while (c < GRID_SIZE) {
        const start = c;
        const type = grid[r][c].type;
        while (c < GRID_SIZE && grid[r][c].type === type) c++;
        const len = c - start;
        if (len >= 3) {
          const group = { dir: 'h', cells: [] };
          for (let k = start; k < c; k++) group.cells.push({ r, c: k });
          groups.push(group);
        }
      }
    }

    // Vertical
    for (let c = 0; c < GRID_SIZE; c++) {
      let r = 0;
      while (r < GRID_SIZE) {
        const start = r;
        const type = grid[r][c].type;
        while (r < GRID_SIZE && grid[r][c].type === type) r++;
        const len = r - start;
        if (len >= 3) {
          const group = { dir: 'v', cells: [] };
          for (let k = start; k < r; k++) group.cells.push({ r: k, c });
          groups.push(group);
        }
      }
    }

    // Merge overlapping groups (L/T shapes)
    // Simple union by cells
    const key = (p) => `${p.r},${p.c}`;
    const mark = new Set();
    const merged = [];
    for (const g of groups) {
      const ids = g.cells.map(key);
      let existing = null;
      for (let i = 0; i < merged.length; i++) {
        const s = merged[i].set;
        if (ids.some((id) => s.has(id))) { existing = i; break; }
      }
      if (existing == null) {
        merged.push({ cells: g.cells.slice(), set: new Set(ids) });
      } else {
        for (const cell of g.cells) {
          const k = key(cell);
          if (!merged[existing].set.has(k)) {
            merged[existing].cells.push(cell);
            merged[existing].set.add(k);
          }
        }
      }
    }
    return merged.map((m) => ({ cells: m.cells }));
  }

  async function resolveBoard(initialGroups, ctx) {
    // 1) Score and clear matches; 2) Create boosters (priority on first cascade: last swap); 3) Gravity; 4) Chain boosters; 5) Cascades
    let groups = initialGroups;
    let cascade = 0;
    do {
      cascade += 1;
      const comboMultiplier = 1 + 0.2 * (cascade - 1);

      // Booster creation plan
      const creationPlan = planBoosterCreation(groups, ctx, cascade);

      // Animate clearing
      await animateClears(groups);
      // Score base clears
      const clearedSet = new Set(groups.map((g) => g.cells).flat().map((p) => `${p.r},${p.c}`));
      const tilesCleared = clearedSet.size;
      if (tilesCleared > 0) {
        const points = Math.round(BASE_POINTS * tilesCleared * comboMultiplier);
        state.score += points;
      }
      if (tilesCleared > 0) onTilesCleared(clearedSet);

      // Actually clear
      for (const id of clearedSet) {
        const [r, c] = id.split(',').map(Number);
        state.grid[r][c] = null;
      }

      // Place boosters (avoid placing into null that is about to be filled; we place after clears, before gravity)
      for (const b of creationPlan) {
        const orient = inferGroupOrientation(b.group);
        const createdBy = orient || ctx.createdDirection || 'h';
        const { r, c } = b.pos;
        const baseType = state.grid[r][c] && state.grid[r][c].type ? state.grid[r][c].type : randomTile().type;
        state.grid[r][c] = { type: baseType, booster: b.booster, createdBy };
      }

      render();
      await wait(120);

      // Gravity after matches and placements
      const moves = applyGravity(state.grid);
      render();
      animateFalls(moves);
      await wait(160);

      // Activate boosters chained by inclusion in clears or matches
      await triggerChainedBoosters(comboMultiplier);

      groups = findAllMatches(state.grid);
    } while (groups.length > 0);
    // Ensure board has potential moves
    ensurePotentialMoves(state.grid, requiredPotentialSwaps());
  }

  function planBoosterCreation(groups, ctx, cascade) {
    const results = [];
    if (groups.length === 0) return results;
    if (cascade === 1) {
      // First cascade: at most one booster at lastSwap with priority 5+ over 4
      let best = null;
      for (const g of groups) {
        const len = g.cells.length;
        if (len >= 5) { best = { booster: Booster.Triple, group: g }; break; }
        if (len === 4 && !best) { best = { booster: Booster.Double, group: g }; }
      }
      if (best) {
        results.push({ ...best, pos: { r: ctx.lastSwap.r, c: ctx.lastSwap.c } });
      }
    } else {
      // Cascades: create boosters for each qualifying group and place at group's center cell
      for (const g of groups) {
        const len = g.cells.length;
        if (len >= 5) results.push({ booster: Booster.Triple, group: g, pos: centerOfCells(g.cells) });
        else if (len === 4) results.push({ booster: Booster.Double, group: g, pos: centerOfCells(g.cells) });
      }
    }
    return results;
  }

  function centerOfCells(cells) {
    // Pick median cell by row+col
    const sorted = cells.slice().sort((a, b) => (a.r - b.r) || (a.c - b.c));
    const mid = sorted[Math.floor(sorted.length / 2)];
    return { r: mid.r, c: mid.c };
  }

  function inferGroupOrientation(group) {
    // Return 'h' if any row has >=4 contiguous cells; 'v' if any column has >=4 contiguous; else 'h'
    const byRow = new Map();
    const byCol = new Map();
    for (const p of group.cells) {
      if (!byRow.has(p.r)) byRow.set(p.r, []);
      byRow.get(p.r).push(p.c);
      if (!byCol.has(p.c)) byCol.set(p.c, []);
      byCol.get(p.c).push(p.r);
    }
    for (const [r, cols] of byRow) {
      cols.sort((a, b) => a - b);
      let run = 1;
      for (let i = 1; i < cols.length; i++) {
        run = (cols[i] === cols[i - 1] + 1) ? run + 1 : 1;
        if (run >= 4) return 'h';
      }
    }
    for (const [c, rows] of byCol) {
      rows.sort((a, b) => a - b);
      let run = 1;
      for (let i = 1; i < rows.length; i++) {
        run = (rows[i] === rows[i - 1] + 1) ? run + 1 : 1;
        if (run >= 4) return 'v';
      }
    }
    return 'h';
  }

  async function triggerChainedBoosters(comboMultiplier) {
    // First, boosters that are part of a 3+ match
    const triggered = collectTriggeredBoosters(state.grid);
    for (const t of triggered) {
      await activateBooster(t, comboMultiplier);
      applyGravity(state.grid);
      render();
      await wait(100);
    }
  }

  function pickBoosterCell(cells, lastSwap) {
    // Choose the cell closest to lastSwap; fallback to first
    let best = cells[0];
    let bestDist = 9999;
    for (const p of cells) {
      const d = Math.abs(p.r - lastSwap.r) + Math.abs(p.c - lastSwap.c);
      if (d < bestDist) { best = p; bestDist = d; }
    }
    return best;
  }

  function applyGravity(grid) {
    const falls = [];
    const spawns = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      let write = GRID_SIZE - 1;
      for (let r = GRID_SIZE - 1; r >= 0; r--) {
        if (grid[r][c] != null) {
          if (write !== r) {
            grid[write][c] = grid[r][c];
            grid[r][c] = null;
            falls.push({ r: write, c, dy: write - r });
          }
          write -= 1;
        }
      }
      for (let r = write; r >= 0; r--) {
        grid[r][c] = randomTile();
        spawns.push({ r, c, dy: r + 1 });
      }
    }
    return { falls, spawns };
  }

  function collectTriggeredBoosters(grid) {
    // If any booster is adjacent to 2 same-type tiles after gravity or got part of a match area, trigger them.
    // Simpler: trigger any booster that has at least two neighbors (N/E/S/W) of same type — or always allow manual activation via swap.
    const triggers = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const t = grid[r][c];
        if (!t || t.booster === Booster.None) continue;
        if (isPartOfMatch(grid, r, c)) {
          triggers.push({ r, c });
        }
      }
    }
    return triggers;
  }

  function isPartOfMatch(grid, r, c) {
    const type = grid[r][c].type;
    // check row
    let cs = 1;
    for (let k = c - 1; k >= 0 && grid[r][k] && grid[r][k].type === type; k--) cs++;
    for (let k = c + 1; k < GRID_SIZE && grid[r][k] && grid[r][k].type === type; k++) cs++;
    if (cs >= 3) return true;
    // check col
    cs = 1;
    for (let k = r - 1; k >= 0 && grid[k][c] && grid[k][c].type === type; k--) cs++;
    for (let k = r + 1; k < GRID_SIZE && grid[k][c] && grid[k][c].type === type; k++) cs++;
    return cs >= 3;
  }

  async function activateBooster(pos, comboMultiplier) {
    const t = state.grid[pos.r][pos.c];
    if (!t || t.booster === Booster.None) return;
    const cm = comboMultiplier == null ? 1 : comboMultiplier;
    let affected = [];
    if (t.booster === Booster.Double) {
      // Determine row/col based on createdBy, fallback to row
      if (t.createdBy === 'v') {
        // cleared by vertical creation: clear column
        for (let r = 0; r < GRID_SIZE; r++) affected.push({ r, c: pos.c });
      } else {
        for (let c = 0; c < GRID_SIZE; c++) affected.push({ r: pos.r, c });
      }
    } else if (t.booster === Booster.Triple) {
      // 3x3 area
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = pos.r + dr;
          const c = pos.c + dc;
          if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) affected.push({ r, c });
        }
      }
    }

    // Score with multiplier
    const unique = new Set(affected.map((p) => `${p.r},${p.c}`));
    // Chain boosters: collect other boosters included
    const chain = [];
    for (const id of unique) {
      const [r, c] = id.split(',').map(Number);
      if (r === pos.r && c === pos.c) continue;
      const tile = state.grid[r][c];
      if (tile && tile.booster && tile.booster !== Booster.None) {
        chain.push({ r, c });
      }
    }
    // Count tiles to clear excluding chained boosters to avoid double-activation removal
    let tilesCleared = 0;
    for (const id of unique) {
      const [r, c] = id.split(',').map(Number);
      if (chain.some((p) => p.r === r && p.c === c)) continue;
      tilesCleared++;
    }
    const boosterMult = t.booster; // 2 or 3
    const points = Math.round(BASE_POINTS * tilesCleared * cm * boosterMult);
    state.score += points;

    // Clear affected (excluding chained boosters)
    for (const id of unique) {
      const [r, c] = id.split(',').map(Number);
      if (chain.some((p) => p.r === r && p.c === c)) continue;
      state.grid[r][c] = null;
    }
    if (tilesCleared > 0) onTilesCleared(unique);
    // Remove the booster itself (already included)
    render();
    await wait(100);

    // Now sequentially trigger chained boosters
    for (const p of chain) {
      await activateBooster(p, cm);
    }
  }

  function checkWinLose() {
    const level = LevelDefs[levelIndex];
    if (level.type === 'score') {
      if (state.score >= level.target) {
        openOverlay(true, `You reached ${state.score.toLocaleString()} points!`);
        return;
      }
      if (state.movesLeft <= 0) {
        openOverlay(false, `Needed ${level.target.toLocaleString()}, got ${state.score.toLocaleString()}.`);
      }
    } else if (level.type === 'collectAny') {
      if (state.collectRemaining <= 0) {
        openOverlay(true, `Collected all icons! Score ${state.score.toLocaleString()}.`);
        return;
      }
      if (state.movesLeft <= 0) {
        openOverlay(false, `Remaining: ${state.collectRemaining}. Score ${state.score.toLocaleString()}.`);
      }
    }
  }

  function onTilesCleared(idSet) {
    const level = LevelDefs[levelIndex];
    if (level.type === 'collectAny') {
      state.collectRemaining = Math.max(0, state.collectRemaining - idSet.size);
    }
  }

  function requiredPotentialSwaps() {
    // Early levels are generous; later levels reduce potential swaps but never below 2
    const level = LevelDefs[levelIndex];
    const id = level?.id ?? (levelIndex + 1);
    return Math.max(2, 6 - id); // L1->5, L2->4, L3->3, L4+->2
  }

  // Potential moves and shuffling
  function findPotentialSwaps(grid) {
    const moves = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const dirs = [ { r: 0, c: 1 }, { r: 1, c: 0 } ];
        for (const d of dirs) {
          const r2 = r + d.r, c2 = c + d.c;
          if (r2 >= GRID_SIZE || c2 >= GRID_SIZE) continue;
          swap(grid, { r, c }, { r: r2, c: c2 });
          const matches = findAllMatches(grid);
          if (matches.length > 0) moves.push({ a: { r, c }, b: { r: r2, c: c2 } });
          swap(grid, { r, c }, { r: r2, c: c2 });
        }
      }
    }
    return moves;
  }

  function ensurePotentialMoves(grid, minCount, opts = { animate: false }) {
    const toast = document.getElementById('shuffleToast');
    let guard = 0;
    let moves = findPotentialSwaps(grid);
    if (moves.length >= minCount) return true;
    if (opts.animate) {
      state.busy = true;
      toast.classList.remove('hidden');
    }
    // Shuffle without scoring or move cost
    while (moves.length < minCount && guard++ < 80) {
      reshuffleGrid(grid);
      fixInitialMatches(grid);
      moves = findPotentialSwaps(grid);
    }
    render();
    if (opts.animate) {
      setTimeout(() => { toast.classList.add('hidden'); state.busy = false; }, 350);
    }
    return false;
  }

  function reshuffleGrid(grid) {
    const types = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const t = grid[r][c];
        if (t) types.push(t.type);
      }
    }
    // Fisher-Yates
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = types[i]; types[i] = types[j]; types[j] = tmp;
    }
    let idx = 0;
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const booster = Booster.None;
        grid[r][c] = { type: types[idx++], booster, createdBy: null };
      }
    }
  }

  // Animations
  async function animateSwap(a, b) {
    const step = 70; // px: tile 64 + gap 6
    const dx = (b.c - a.c) * step;
    const dy = (b.r - a.r) * step;
    const elA = cellEl(a.r, a.c);
    const elB = cellEl(b.r, b.c);
    elA.style.transition = 'transform 120ms ease';
    elB.style.transition = 'transform 120ms ease';
    elA.style.transform = `translate(${dx}px, ${dy}px)`;
    elB.style.transform = `translate(${-dx}px, ${-dy}px)`;
    await wait(130);
    elA.style.transition = '';
    elB.style.transition = '';
    elA.style.transform = '';
    elB.style.transform = '';
  }

  async function animateClears(groups) {
    const ids = new Set(groups.map((g) => g.cells).flat().map((p) => `${p.r},${p.c}`));
    ids.forEach((id) => {
      const [r, c] = id.split(',').map(Number);
      const el = cellEl(r, c);
      el.classList.add('clearing');
    });
    await wait(140);
    ids.forEach((id) => {
      const [r, c] = id.split(',').map(Number);
      const el = cellEl(r, c);
      el.classList.remove('clearing');
    });
  }

  function animateFalls(moves) {
    const step = 70;
    for (const f of moves.falls) {
      const el = cellEl(f.r, f.c);
      el.style.setProperty('--dy', String(f.dy));
      el.style.setProperty('--dur', `${Math.min(0.08 * f.dy + 0.1, 0.35)}s`);
      el.classList.add('falling');
      // clean up after animation
      setTimeout(() => { el.classList.remove('falling'); el.style.removeProperty('--dy'); el.style.removeProperty('--dur'); }, 400);
    }
    for (const s of moves.spawns) {
      const el = cellEl(s.r, s.c);
      el.classList.add('spawning');
      setTimeout(() => el.classList.remove('spawning'), 260);
    }
  }

  function openOverlay(win, desc) {
    resultTitleEl.textContent = win ? 'Level Clear!' : 'Out of Moves';
    resultDescEl.textContent = desc;
    overlayEl.classList.remove('hidden');
  }

  function closeOverlay() {
    overlayEl.classList.add('hidden');
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function wait(ms) { return new Promise((res) => setTimeout(res, ms)); }

  function pushUndo() {
    undoState = JSON.stringify({ grid: state.grid, score: state.score, movesLeft: state.movesLeft });
  }
  function popUndo() {
    if (!undoState) return false;
    const { grid, score, movesLeft } = JSON.parse(undoState, (k, v) => v);
    state.grid = grid.map((row) => row.map((t) => t ? { ...t } : null));
    state.score = score;
    state.movesLeft = movesLeft;
    undoState = null;
    render();
    return true;
  }

  // Assist: suggest a high-value swap
  function findBestSwap() {
    let best = null;
    let bestScore = -1;
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const dirs = [ { r: 0, c: 1 }, { r: 1, c: 0 } ];
        for (const d of dirs) {
          const r2 = r + d.r, c2 = c + d.c;
          if (r2 >= GRID_SIZE || c2 >= GRID_SIZE) continue;
          swap(state.grid, { r, c }, { r: r2, c: c2 });
          const matches = findAllMatches(state.grid);
          let value = 0;
          for (const g of matches) value += g.cells.length;
          if (value > bestScore) { bestScore = value; best = { a: { r, c }, b: { r: r2, c: c2 } }; }
          swap(state.grid, { r, c }, { r: r2, c: c2 });
        }
      }
    }
    return best;
  }

  // Event wiring
  nextBtn.addEventListener('click', () => {
    closeOverlay();
    levelIndex = Math.min(levelIndex + 1, LevelDefs.length - 1);
    state = createInitialState();
    render();
  });
  retryBtn.addEventListener('click', () => {
    closeOverlay();
    state = createInitialState();
    render();
  });
  undoBtn.addEventListener('click', () => {
    if (state.busy) return;
    if (popUndo()) {
      // undone
    }
  });

  // Init
  state = createInitialState();
  mountGrid();
  window.addEventListener('resize', () => sizeGridToViewport());

  // Idle hint
  let idleTimer = null;
  const tooltip = document.getElementById('tooltip');
  const scheduleHint = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (assistInput.checked) {
        const s = findBestSwap();
        if (s) {
          cellEl(s.a.r, s.a.c).classList.add('selected');
          cellEl(s.b.r, s.b.c).classList.add('selected');
          setTimeout(() => {
            cellEl(s.a.r, s.a.c).classList.remove('selected');
            cellEl(s.b.r, s.b.c).classList.remove('selected');
          }, 900);
        }
      }
      tooltip.classList.toggle('hidden', false);
      setTimeout(() => tooltip.classList.add('hidden'), 2200);
    }, 5000);
  };
  document.addEventListener('pointerdown', () => { tooltip.classList.add('hidden'); scheduleHint(); });
  scheduleHint();
})();


