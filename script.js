// Mizunara Shogi - UI layer
(() => {
  const STORAGE_KEY = 'mizunara-state-v1';
  const SETTINGS_KEY = 'mizunara-settings-v1';

  let settings = loadSettings();
  let state = null;
  let selected = null; // { kind:'board', r, c, legal:[...] } or { kind:'hand', type, owner, legal:[...] }
  let pendingPromotion = null; // {from, to} awaiting user choice
  let aiThinking = false;

  const boardEl = document.getElementById('board');
  const handGoteEl = document.getElementById('hand-gote');
  const handSenteEl = document.getElementById('hand-sente');
  const turnIndicator = document.getElementById('turn-indicator');
  const checkIndicator = document.getElementById('check-indicator');
  const moveCountEl = document.getElementById('move-count');
  const promoteModal = document.getElementById('promote-modal');
  const resultModal = document.getElementById('result-modal');
  const resultText = document.getElementById('result-text');
  const menuModal = document.getElementById('menu-modal');
  const toastEl = document.getElementById('toast');

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { mode: 'cpu', level: 1 };
  }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function serializeState(s) {
    return JSON.stringify({
      board: s.board, hands: s.hands, turn: s.turn, moveCount: s.moveCount,
      lastMove: s.lastMove, gameOver: s.gameOver, inCheck: s.inCheck
    });
  }
  function saveGame() {
    try { localStorage.setItem(STORAGE_KEY, serializeState(state)); } catch (e) {}
  }
  function loadGame() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const s = initialState();
      s.board = data.board; s.hands = data.hands; s.turn = data.turn;
      s.moveCount = data.moveCount; s.lastMove = data.lastMove;
      s.gameOver = data.gameOver; s.inCheck = data.inCheck;
      return s;
    } catch (e) { return null; }
  }

  function newGame() {
    state = initialState();
    state.inCheck = false;
    selected = null;
    saveGame();
    render();
    maybeTriggerAi();
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.add('hidden'), 1600);
  }

  // ---------- rendering ----------
  function render() {
    renderBoard();
    renderHands();
    renderStatus();
  }

  function renderStatus() {
    const isSente = state.turn === 'sente';
    turnIndicator.textContent = isSente ? '先手番' : '後手番';
    turnIndicator.className = 'turn-indicator ' + (isSente ? 'sente' : 'gote');
    checkIndicator.classList.toggle('hidden', !state.inCheck || !!state.gameOver);
    moveCountEl.textContent = '手数: ' + state.moveCount;
  }

  function squareKey(r, c) { return r + '_' + c; }

  function renderBoard() {
    boardEl.innerHTML = '';
    const legalSet = new Set();
    if (selected) {
      for (const d of selected.legal) legalSet.add(squareKey(d.r, d.c));
    }
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = r; cell.dataset.c = c;
        const piece = state.board[r][c];

        if (state.lastMove) {
          const lm = state.lastMove;
          if (lm.to && lm.to.r === r && lm.to.c === c) cell.classList.add('last-to');
          if (!lm.drop && lm.from && lm.from.r === r && lm.from.c === c) cell.classList.add('last-from');
        }
        if (selected && selected.kind === 'board' && selected.r === r && selected.c === c) {
          cell.classList.add('selected');
        }
        if (legalSet.has(squareKey(r, c))) {
          cell.classList.add(piece ? 'legal-capture' : 'legal-move');
        }
        if (piece && piece.type === 'OU' && state.inCheck && piece.owner === state.turn) {
          cell.classList.add('king-check');
        }

        if (piece) {
          const pieceEl = document.createElement('div');
          pieceEl.className = 'piece ' + piece.owner + (piece.promoted ? ' promoted' : '');
          pieceEl.textContent = displayName(piece);
          cell.appendChild(pieceEl);
        }
        cell.addEventListener('click', onCellClick);
        boardEl.appendChild(cell);
      }
    }
  }

  function renderHands() {
    handGoteEl.innerHTML = '';
    handSenteEl.innerHTML = '';
    renderHandFor('gote', handGoteEl);
    renderHandFor('sente', handSenteEl);
  }

  function renderHandFor(owner, container) {
    const hand = state.hands[owner];
    let any = false;
    for (const type of HAND_ORDER) {
      const n = hand[type] || 0;
      if (n <= 0) continue;
      any = true;
      const item = document.createElement('div');
      item.className = 'hand-piece ' + owner;
      if (selected && selected.kind === 'hand' && selected.owner === owner && selected.type === type) {
        item.classList.add('selected');
      }
      item.innerHTML = '<span class="hp-name">' + PIECE_NAMES[type] + '</span>' +
        (n > 1 ? '<span class="hp-count">' + n + '</span>' : '');
      item.addEventListener('click', () => onHandClick(owner, type));
      container.appendChild(item);
    }
    if (!any) {
      const empty = document.createElement('div');
      empty.className = 'hand-empty';
      container.appendChild(empty);
    }
  }

  // ---------- interaction ----------
  function humanCanAct() {
    if (state.gameOver) return false;
    if (aiThinking) return false;
    if (settings.mode === 'cpu' && state.turn === 'gote') return false;
    return true;
  }

  function onCellClick(e) {
    if (!humanCanAct()) return;
    const r = +e.currentTarget.dataset.r, c = +e.currentTarget.dataset.c;
    const piece = state.board[r][c];

    if (selected) {
      const dest = selected.legal.find(d => d.r === r && d.c === c);
      if (dest) {
        executeSelectedAction(r, c);
        return;
      }
      // clicking another own piece re-selects
      if (piece && piece.owner === state.turn) {
        selectBoardPiece(r, c);
      } else {
        selected = null;
        renderBoard();
      }
      return;
    }
    if (piece && piece.owner === state.turn) {
      selectBoardPiece(r, c);
    }
  }

  function selectBoardPiece(r, c) {
    const legal = legalMoveDestinations(state, r, c);
    selected = { kind: 'board', r, c, legal };
    render();
  }

  function onHandClick(owner, type) {
    if (!humanCanAct()) return;
    if (owner !== state.turn) return;
    const legal = legalDropSquares(state, type, owner);
    selected = { kind: 'hand', owner, type, legal };
    render();
  }

  function executeSelectedAction(toR, toC) {
    if (selected.kind === 'board') {
      const { r, c } = selected;
      const piece = state.board[r][c];
      const canProm = canPromote(piece, r, toR);
      const must = canProm && mustPromote(piece.type, piece.owner, toR);
      selected = null;
      if (must) {
        finishMove(r, c, toR, toC, true);
      } else if (canProm) {
        pendingPromotion = { r, c, toR, toC };
        promoteModal.classList.remove('hidden');
      } else {
        finishMove(r, c, toR, toC, false);
      }
    } else {
      const { type, owner } = selected;
      selected = null;
      performDrop(state, type, toR, toC);
      afterMove();
    }
  }

  function finishMove(r, c, toR, toC, promote) {
    performMove(state, r, c, toR, toC, promote);
    afterMove();
  }

  function afterMove() {
    selected = null;
    saveGame();
    render();
    checkGameOver();
    maybeTriggerAi();
  }

  promoteModal.querySelector('#promote-yes').addEventListener('click', () => {
    const p = pendingPromotion; pendingPromotion = null;
    promoteModal.classList.add('hidden');
    finishMove(p.r, p.c, p.toR, p.toC, true);
  });
  promoteModal.querySelector('#promote-no').addEventListener('click', () => {
    const p = pendingPromotion; pendingPromotion = null;
    promoteModal.classList.add('hidden');
    finishMove(p.r, p.c, p.toR, p.toC, false);
  });

  function checkGameOver() {
    if (!state.gameOver) return;
    const winnerLabel = state.gameOver.winner === 'sente' ? '先手' : '後手';
    const reasonLabel = state.gameOver.reason === 'checkmate' ? '詰み' : '指し手なし';
    resultText.textContent = winnerLabel + 'の勝ち（' + reasonLabel + '）';
    resultModal.classList.remove('hidden');
  }

  function maybeTriggerAi() {
    if (state.gameOver) return;
    if (settings.mode !== 'cpu') return;
    if (state.turn !== 'gote') return;
    aiThinking = true;
    render();
    const delay = 350 + Math.random() * 450;
    setTimeout(() => {
      const action = chooseAiAction(state, 'gote', settings.level);
      aiThinking = false;
      if (!action) { render(); return; }
      if (action.kind === 'move') {
        performMove(state, action.from.r, action.from.c, action.to.r, action.to.c, action.promote);
      } else {
        performDrop(state, action.type, action.to.r, action.to.c);
      }
      saveGame();
      render();
      checkGameOver();
    }, delay);
  }

  // ---------- top bar buttons ----------
  document.getElementById('btn-undo').addEventListener('click', () => {
    if (aiThinking) return;
    const steps = settings.mode === 'cpu' ? 2 : 1;
    let ok = false;
    for (let i = 0; i < steps; i++) {
      if (undoMove(state)) ok = true; else break;
    }
    if (ok) {
      selected = null;
      resultModal.classList.add('hidden');
      saveGame();
      render();
      toast('待った');
    }
  });

  document.getElementById('btn-new').addEventListener('click', () => {
    if (confirm('新しい対局を始めますか？')) newGame();
  });

  document.getElementById('btn-menu').addEventListener('click', () => {
    syncMenuUi();
    menuModal.classList.remove('hidden');
  });
  document.getElementById('menu-close').addEventListener('click', () => {
    menuModal.classList.add('hidden');
  });
  document.getElementById('menu-apply').addEventListener('click', () => {
    menuModal.classList.add('hidden');
    saveSettings();
    newGame();
  });

  function syncMenuUi() {
    document.querySelectorAll('#mode-seg .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === settings.mode);
    });
    document.querySelectorAll('#level-seg .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.level === String(settings.level));
    });
  }
  document.querySelectorAll('#mode-seg .seg-btn').forEach(b => {
    b.addEventListener('click', () => { settings.mode = b.dataset.mode; syncMenuUi(); });
  });
  document.querySelectorAll('#level-seg .seg-btn').forEach(b => {
    b.addEventListener('click', () => { settings.level = +b.dataset.level; syncMenuUi(); });
  });

  document.getElementById('result-close').addEventListener('click', () => {
    resultModal.classList.add('hidden');
  });
  document.getElementById('result-new').addEventListener('click', () => {
    resultModal.classList.add('hidden');
    newGame();
  });

  // ---------- boot ----------
  const restored = loadGame();
  if (restored) {
    state = restored;
  } else {
    state = initialState();
    state.inCheck = false;
  }
  render();
  maybeTriggerAi();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
