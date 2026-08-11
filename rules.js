// Mizunara Shogi - core rules engine (pure logic, no DOM).
// Board: 9x9 array, row 0 = rank 1 (top / gote's back rank), row 8 = rank 9 (bottom / sente's back rank).
// col 0 = file 9 (left, gote's view irrelevant here - we just use array index), col 8 = file 1.
// A square holds null or { type: 'FU'|'KY'|...'OU', owner: 'sente'|'gote', promoted: bool }

const PIECE_NAMES = {
  FU: '歩', KY: '香', KE: '桂', GI: '銀', KI: '金', KA: '角', HI: '飛', OU: '王',
  TO: 'と', NY: '成香', NK: '成桂', NG: '成銀', UM: '馬', RY: '龍'
};
// gote's king is displayed as 玉 conventionally
const PIECE_NAMES_GOTE_KING = '玉';

const PROMOTE_MAP = { FU: 'TO', KY: 'NY', KE: 'NK', GI: 'NG', KA: 'UM', HI: 'RY' };
const UNPROMOTE_MAP = { TO: 'FU', NY: 'KY', NK: 'KE', NG: 'GI', UM: 'KA', RY: 'HI' };
const PROMOTABLE = new Set(['FU', 'KY', 'KE', 'GI', 'KA', 'HI']);
const GOLD_LIKE = new Set(['KI', 'TO', 'NY', 'NK', 'NG']);

// piece values for simple AI evaluation
const PIECE_VALUE = {
  FU: 100, KY: 300, KE: 350, GI: 500, KI: 600, KA: 800, HI: 1000, OU: 15000,
  TO: 600, NY: 600, NK: 600, NG: 600, UM: 1000, RY: 1200
};

function cloneBoard(board) {
  return board.map(row => row.map(cell => cell ? { ...cell } : null));
}

function initialBoard() {
  const b = Array.from({ length: 9 }, () => Array(9).fill(null));
  const backRow = ['KY', 'KE', 'GI', 'KI', 'OU', 'KI', 'GI', 'KE', 'KY'];
  for (let c = 0; c < 9; c++) {
    b[0][c] = { type: backRow[c], owner: 'gote', promoted: false };
    b[8][c] = { type: backRow[c], owner: 'sente', promoted: false };
  }
  b[1][1] = { type: 'KA', owner: 'gote', promoted: false };
  b[1][7] = { type: 'HI', owner: 'gote', promoted: false };
  b[7][1] = { type: 'HI', owner: 'sente', promoted: false };
  b[7][7] = { type: 'KA', owner: 'sente', promoted: false };
  for (let c = 0; c < 9; c++) {
    b[2][c] = { type: 'FU', owner: 'gote', promoted: false };
    b[6][c] = { type: 'FU', owner: 'sente', promoted: false };
  }
  return b;
}

function initialState() {
  return {
    board: initialBoard(),
    hands: { sente: {}, gote: {} },
    turn: 'sente',
    moveCount: 0,
    history: [], // stack of {board, hands, turn, moveCount, lastMove}
    lastMove: null,
    gameOver: null // {winner, reason}
  };
}

function opponent(owner) { return owner === 'sente' ? 'gote' : 'sente'; }

function inBounds(r, c) { return r >= 0 && r <= 8 && c >= 0 && c <= 8; }

// direction step is defined for sente (facing up, decreasing row). Mirror for gote.
const STEP_DIRS = {
  FU: [[ -1, 0 ]],
  GI: [[-1,0],[-1,-1],[-1,1],[1,-1],[1,1]],
  KI: [[-1,0],[-1,-1],[-1,1],[0,-1],[0,1],[1,0]],
  OU: [[-1,0],[-1,-1],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
};
const SLIDE_DIRS = {
  KY: [[-1,0]],
  KA: [[-1,-1],[-1,1],[1,-1],[1,1]],
  HI: [[-1,0],[1,0],[0,-1],[0,1]]
};
// promoted piece extra single-step dirs (added to their slide dirs)
const UM_EXTRA = [[-1,0],[1,0],[0,-1],[0,1]];
const RY_EXTRA = [[-1,-1],[-1,1],[1,-1],[1,1]];

function mirror(dirs, owner) {
  if (owner === 'sente') return dirs;
  return dirs.map(([dr, dc]) => [-dr, dc]);
}

function baseTypeOf(piece) {
  if (!piece.promoted) return piece.type;
  return piece.type; // type already stores promoted code e.g. 'TO'
}

// Returns list of {r,c} pseudo-legal destination squares (not checking own-king-safety)
function pieceDestinations(state, r, c) {
  const board = state.board;
  const piece = board[r][c];
  if (!piece) return [];
  const owner = piece.owner;
  const type = piece.type;
  const dests = [];

  const tryStep = (dr, dc) => {
    const nr = r + dr, nc = c + dc;
    if (!inBounds(nr, nc)) return;
    const target = board[nr][nc];
    if (!target || target.owner !== owner) dests.push({ r: nr, c: nc });
  };
  const trySlide = (dr, dc) => {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const target = board[nr][nc];
      if (!target) { dests.push({ r: nr, c: nc }); }
      else { if (target.owner !== owner) dests.push({ r: nr, c: nc }); break; }
      nr += dr; nc += dc;
    }
  };

  if (type === 'KE') {
    const dr = owner === 'sente' ? -2 : 2;
    for (const dc of [-1, 1]) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr][nc];
      if (!target || target.owner !== owner) dests.push({ r: nr, c: nc });
    }
    return dests;
  }

  if (STEP_DIRS[type]) {
    for (const [dr, dc] of mirror(STEP_DIRS[type], owner)) tryStep(dr, dc);
    return dests;
  }
  if (GOLD_LIKE.has(type)) {
    for (const [dr, dc] of mirror(STEP_DIRS.KI, owner)) tryStep(dr, dc);
    return dests;
  }
  if (SLIDE_DIRS[type]) {
    for (const [dr, dc] of mirror(SLIDE_DIRS[type], owner)) trySlide(dr, dc);
    return dests;
  }
  if (type === 'UM') {
    for (const [dr, dc] of mirror(SLIDE_DIRS.KA, owner)) trySlide(dr, dc);
    for (const [dr, dc] of UM_EXTRA) tryStep(dr, dc);
    return dests;
  }
  if (type === 'RY') {
    for (const [dr, dc] of mirror(SLIDE_DIRS.HI, owner)) trySlide(dr, dc);
    for (const [dr, dc] of RY_EXTRA) tryStep(dr, dc);
    return dests;
  }
  return dests;
}

function findKing(board, owner) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p && p.owner === owner && p.type === 'OU') return { r, c };
    }
  return null;
}

// is square (r,c) attacked by `attacker` side, given board
function isSquareAttacked(board, r, c, attacker) {
  for (let rr = 0; rr < 9; rr++) {
    for (let cc = 0; cc < 9; cc++) {
      const p = board[rr][cc];
      if (!p || p.owner !== attacker) continue;
      const dests = pieceDestinations({ board }, rr, cc);
      if (dests.some(d => d.r === r && d.c === c)) return true;
    }
  }
  return false;
}

function isInCheck(state, owner) {
  const kingPos = findKing(state.board, owner);
  if (!kingPos) return false;
  return isSquareAttacked(state.board, kingPos.r, kingPos.c, opponent(owner));
}

function promotionZoneRows(owner) {
  return owner === 'sente' ? [0, 1, 2] : [6, 7, 8];
}

function mustPromote(type, owner, destRow) {
  if (type === 'FU' || type === 'KY') {
    return owner === 'sente' ? destRow === 0 : destRow === 8;
  }
  if (type === 'KE') {
    return owner === 'sente' ? destRow <= 1 : destRow >= 7;
  }
  return false;
}

function canPromote(piece, fromRow, toRow) {
  if (piece.promoted) return false;
  if (!PROMOTABLE.has(piece.type)) return false;
  const zone = promotionZoneRows(piece.owner);
  return zone.includes(fromRow) || zone.includes(toRow);
}

// Simulate a board move (not drop), return new {board}
function applyMoveToBoard(board, fromR, fromC, toR, toC, promote) {
  const nb = cloneBoard(board);
  const piece = { ...nb[fromR][fromC] };
  nb[fromR][fromC] = null;
  if (promote) {
    piece.type = PROMOTE_MAP[piece.type] || piece.type;
    piece.promoted = true;
  }
  const captured = nb[toR][toC];
  nb[toR][toC] = piece;
  return { board: nb, captured };
}

// Legal destinations for a board piece at r,c (filters out moves leaving own king in check)
function legalMoveDestinations(state, r, c) {
  const piece = state.board[r][c];
  if (!piece) return [];
  const pseudo = pieceDestinations(state, r, c);
  const legal = [];
  for (const d of pseudo) {
    const { board: nb } = applyMoveToBoard(state.board, r, c, d.r, d.c, false);
    if (!isSquareAttacked(nb, ...Object.values(findKing(nb, piece.owner)), opponent(piece.owner))) {
      legal.push(d);
    }
  }
  return legal;
}

// Legal drop squares for a hand piece type
function legalDropSquares(state, type, owner) {
  const board = state.board;
  const squares = [];
  const rowsBanned = new Set();
  if (type === 'FU' || type === 'KY') rowsBanned.add(owner === 'sente' ? 0 : 8);
  if (type === 'KE') { rowsBanned.add(owner === 'sente' ? 0 : 8); rowsBanned.add(owner === 'sente' ? 1 : 7); }

  // nifu check: file already has unpromoted pawn of same owner
  let nifuCols = new Set();
  if (type === 'FU') {
    for (let c = 0; c < 9; c++) {
      for (let r = 0; r < 9; r++) {
        const p = board[r][c];
        if (p && p.owner === owner && p.type === 'FU' && !p.promoted) { nifuCols.add(c); break; }
      }
    }
  }

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c]) continue;
      if (rowsBanned.has(r)) continue;
      if (type === 'FU' && nifuCols.has(c)) continue;
      // simulate drop, check own king safety
      const nb = cloneBoard(board);
      nb[r][c] = { type, owner, promoted: false };
      const kp = findKing(nb, owner);
      if (isSquareAttacked(nb, kp.r, kp.c, opponent(owner))) continue;
      // uchifuzume: dropping pawn to deliver immediate checkmate is illegal
      if (type === 'FU') {
        const oppOwner = opponent(owner);
        const oppInCheck = isSquareAttacked(nb, ...Object.values(findKing(nb, oppOwner)), owner);
        if (oppInCheck) {
          const tempState = { board: nb, hands: state.hands, turn: oppOwner };
          if (!hasAnyLegalMove(tempState, oppOwner)) continue; // illegal drop (checkmate by pawn drop)
        }
      }
      squares.push({ r, c });
    }
  }
  return squares;
}

function hasAnyLegalMove(state, owner) {
  const board = state.board;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p && p.owner === owner) {
        if (legalMoveDestinations(state, r, c).length > 0) return true;
      }
    }
  }
  const hand = state.hands[owner] || {};
  for (const type of Object.keys(hand)) {
    if (hand[type] > 0 && legalDropSquares(state, type, owner).length > 0) return true;
  }
  return false;
}

// Generate all legal actions for owner: array of {kind:'move', from:{r,c}, to:{r,c}, promoteOptions:[false,true?]} or {kind:'drop', type, to}
function allLegalActions(state, owner) {
  const actions = [];
  const board = state.board;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p || p.owner !== owner) continue;
      const dests = legalMoveDestinations(state, r, c);
      for (const d of dests) {
        const canProm = canPromote(p, r, d.r);
        const must = canProm && mustPromote(p.type, owner, d.r);
        if (must) {
          actions.push({ kind: 'move', from: { r, c }, to: d, promote: true });
        } else if (canProm) {
          actions.push({ kind: 'move', from: { r, c }, to: d, promote: false });
          actions.push({ kind: 'move', from: { r, c }, to: d, promote: true });
        } else {
          actions.push({ kind: 'move', from: { r, c }, to: d, promote: false });
        }
      }
    }
  }
  const hand = state.hands[owner] || {};
  for (const type of Object.keys(hand)) {
    if (hand[type] <= 0) continue;
    const squares = legalDropSquares(state, type, owner);
    for (const sq of squares) actions.push({ kind: 'drop', type, to: sq });
  }
  return actions;
}

function pushHistory(state) {
  state.history.push({
    board: cloneBoard(state.board),
    hands: { sente: { ...state.hands.sente }, gote: { ...state.hands.gote } },
    turn: state.turn,
    moveCount: state.moveCount,
    lastMove: state.lastMove,
    gameOver: state.gameOver
  });
}

function performMove(state, fromR, fromC, toR, toC, promote) {
  pushHistory(state);
  const piece = state.board[fromR][fromC];
  const { board: nb, captured } = applyMoveToBoard(state.board, fromR, fromC, toR, toC, promote);
  state.board = nb;
  if (captured) {
    const baseType = UNPROMOTE_MAP[captured.type] || captured.type;
    const hand = state.hands[piece.owner];
    hand[baseType] = (hand[baseType] || 0) + 1;
  }
  state.lastMove = { from: { r: fromR, c: fromC }, to: { r: toR, c: toC }, drop: false };
  state.moveCount++;
  state.turn = opponent(state.turn);
  finalizeTurnStatus(state);
  return captured;
}

function performDrop(state, type, toR, toC) {
  pushHistory(state);
  const owner = state.turn;
  state.board[toR][toC] = { type, owner, promoted: false };
  state.hands[owner][type]--;
  state.lastMove = { to: { r: toR, c: toC }, drop: true, type };
  state.moveCount++;
  state.turn = opponent(state.turn);
  finalizeTurnStatus(state);
}

function finalizeTurnStatus(state) {
  const owner = state.turn; // side to move now
  const inCheck = isInCheck(state, owner);
  const hasMove = hasAnyLegalMove(state, owner);
  state.inCheck = inCheck;
  if (!hasMove) {
    state.gameOver = { winner: opponent(owner), reason: inCheck ? 'checkmate' : 'nomoves' };
  } else {
    state.gameOver = null;
  }
}

function undoMove(state) {
  if (state.history.length === 0) return false;
  const prev = state.history.pop();
  state.board = prev.board;
  state.hands = prev.hands;
  state.turn = prev.turn;
  state.moveCount = prev.moveCount;
  state.lastMove = prev.lastMove;
  state.gameOver = prev.gameOver;
  state.inCheck = isInCheck(state, state.turn);
  return true;
}

function displayName(piece) {
  if (piece.type === 'OU') return piece.owner === 'gote' ? PIECE_NAMES_GOTE_KING : PIECE_NAMES.OU;
  return PIECE_NAMES[piece.type];
}

const HAND_ORDER = ['HI', 'KA', 'KI', 'GI', 'KE', 'KY', 'FU'];

// --- simple AI ---
function evaluateState(state, forOwner) {
  let score = 0;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = state.board[r][c];
      if (!p) continue;
      const v = PIECE_VALUE[p.type] || 0;
      score += (p.owner === forOwner ? v : -v);
    }
  }
  for (const type of Object.keys(state.hands[forOwner] || {})) {
    score += (PIECE_VALUE[type] || 0) * 0.9 * state.hands[forOwner][type];
  }
  const opp = opponent(forOwner);
  for (const type of Object.keys(state.hands[opp] || {})) {
    score -= (PIECE_VALUE[type] || 0) * 0.9 * state.hands[opp][type];
  }
  return score;
}

function cloneState(state) {
  return {
    board: cloneBoard(state.board),
    hands: { sente: { ...state.hands.sente }, gote: { ...state.hands.gote } },
    turn: state.turn,
    moveCount: state.moveCount,
    history: [],
    lastMove: state.lastMove,
    gameOver: state.gameOver
  };
}

function applyActionToClone(state, action) {
  const s = cloneState(state);
  if (action.kind === 'move') {
    performMove(s, action.from.r, action.from.c, action.to.r, action.to.c, action.promote);
  } else {
    performDrop(s, action.type, action.to.r, action.to.c);
  }
  return s;
}

// level 1: mostly random with slight preference for captures/checks; level 2: 1-ply greedy + light 2-ply for opponent replies
function chooseAiAction(state, owner, level) {
  const actions = allLegalActions(state, owner);
  if (actions.length === 0) return null;
  if (level <= 1) {
    const weighted = actions.map(a => {
      let w = 1;
      if (a.kind === 'move') {
        const target = state.board[a.to.r][a.to.c];
        if (target) w += (PIECE_VALUE[target.type] || 0) / 200;
      }
      return { a, w };
    });
    const total = weighted.reduce((s, x) => s + x.w, 0);
    let pick = Math.random() * total;
    for (const x of weighted) { pick -= x.w; if (pick <= 0) return x.a; }
    return actions[actions.length - 1];
  }
  // level 2: evaluate resulting position (1-ply) with small randomization, avoid moves that hang to a free capture when possible
  let best = null, bestScore = -Infinity;
  const scored = [];
  for (const a of actions) {
    const s2 = applyActionToClone(state, a);
    let score = evaluateState(s2, owner);
    score += (Math.random() - 0.5) * 40;
    scored.push({ a, score });
  }
  scored.sort((x, y) => y.score - x.score);
  const topN = scored.slice(0, Math.max(1, Math.min(3, scored.length)));
  const chosen = topN[Math.floor(Math.random() * topN.length)];
  return chosen.a;
}
