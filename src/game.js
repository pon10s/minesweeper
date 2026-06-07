/*
 * game.js — マインスイーパーのコアロジック（画面なし・テスト可能な純粋ロジック中心）
 *
 * 盤面データ構造、地雷配置、周囲地雷数の計算、開く（連鎖オープン＝flood fill）、
 * 旗の立て下げ、和音クリック、勝敗判定を提供する。
 *
 * グローバル `window.MS` に関数群を公開する（ビルド不要・モジュールなし方針のため）。
 */
(function (global) {
  'use strict';

  // セルの状態
  var HIDDEN = 'hidden';     // 未開封
  var REVEALED = 'revealed'; // 開封済み
  var FLAGGED = 'flagged';   // 旗

  // ゲームの状態
  var READY = 'ready';   // 開始前（1手目待ち。地雷未配置）
  var PLAYING = 'playing';
  var WON = 'won';
  var LOST = 'lost';

  /**
   * 空の盤面を作る（地雷はまだ置かない＝最初のクリック安全のため）。
   */
  function createGame(rows, cols, mineCount) {
    if (mineCount >= rows * cols) {
      throw new Error('地雷数が多すぎます: ' + mineCount + ' >= ' + rows * cols);
    }
    var cells = [];
    for (var r = 0; r < rows; r++) {
      var row = [];
      for (var c = 0; c < cols; c++) {
        row.push({ mine: false, adjacent: 0, state: HIDDEN });
      }
      cells.push(row);
    }
    return {
      rows: rows,
      cols: cols,
      mineCount: mineCount,
      cells: cells,
      status: READY,
      minesPlaced: false,
      flagsCount: 0,
      revealedCount: 0
    };
  }

  /** 周囲8マスの座標を返す（盤面内のみ）。 */
  function neighborCoords(r, c, rows, cols) {
    var result = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        var nr = r + dr;
        var nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          result.push([nr, nc]);
        }
      }
    }
    return result;
  }

  /**
   * 地雷をランダムに配置する。safeR/safeC のマスには置かない（最初のクリック安全）。
   * rng は 0〜1 の乱数生成関数（テスト時に差し替え可能）。
   */
  function placeMines(game, safeR, safeC, rng) {
    rng = rng || Math.random;
    var placed = 0;
    var total = game.rows * game.cols;
    while (placed < game.mineCount) {
      var idx = Math.floor(rng() * total);
      if (idx >= total) idx = total - 1; // rng()===1 対策
      var r = Math.floor(idx / game.cols);
      var c = idx % game.cols;
      if (r === safeR && c === safeC) continue;
      if (game.cells[r][c].mine) continue;
      game.cells[r][c].mine = true;
      placed++;
    }
  }

  /** 各マスの周囲地雷数を計算して adjacent に入れる。 */
  function computeAdjacents(game) {
    for (var r = 0; r < game.rows; r++) {
      for (var c = 0; c < game.cols; c++) {
        if (game.cells[r][c].mine) { game.cells[r][c].adjacent = 0; continue; }
        var count = 0;
        var ns = neighborCoords(r, c, game.rows, game.cols);
        for (var i = 0; i < ns.length; i++) {
          if (game.cells[ns[i][0]][ns[i][1]].mine) count++;
        }
        game.cells[r][c].adjacent = count;
      }
    }
  }

  /**
   * テスト用ヘルパー：地雷座標 [[r,c],...] を直接セットして盤面を確定させる。
   * 乱数に依存せず決まった盤面を作れる。
   */
  function setMines(game, coords) {
    for (var i = 0; i < coords.length; i++) {
      game.cells[coords[i][0]][coords[i][1]].mine = true;
    }
    computeAdjacents(game);
    game.minesPlaced = true;
    game.status = PLAYING;
    return game;
  }

  /** 連鎖オープン（flood fill）。空白(0)マスから周囲へ広げる。 */
  function floodReveal(game, r, c) {
    var stack = [[r, c]];
    while (stack.length) {
      var cur = stack.pop();
      var cr = cur[0], cc = cur[1];
      var cell = game.cells[cr][cc];
      if (cell.state !== HIDDEN) continue;
      if (cell.mine) continue; // 地雷は開かない
      cell.state = REVEALED;
      game.revealedCount++;
      if (cell.adjacent === 0) {
        var ns = neighborCoords(cr, cc, game.rows, game.cols);
        for (var i = 0; i < ns.length; i++) {
          var ncell = game.cells[ns[i][0]][ns[i][1]];
          if (ncell.state === HIDDEN && !ncell.mine) {
            stack.push([ns[i][0], ns[i][1]]);
          }
        }
      }
    }
  }

  /** 全地雷を開封表示（負け時用）。 */
  function revealAllMines(game) {
    for (var r = 0; r < game.rows; r++) {
      for (var c = 0; c < game.cols; c++) {
        if (game.cells[r][c].mine) game.cells[r][c].state = REVEALED;
      }
    }
  }

  /** 勝利判定：地雷でない全マスが開封済みか。 */
  function checkWin(game) {
    return game.revealedCount === game.rows * game.cols - game.mineCount;
  }

  /** 勝利時：未開封の地雷を自動で旗にする（残り地雷カウンターが0になる）。 */
  function flagRemainingMines(game) {
    for (var r = 0; r < game.rows; r++) {
      for (var c = 0; c < game.cols; c++) {
        var cell = game.cells[r][c];
        if (cell.mine && cell.state === HIDDEN) {
          cell.state = FLAGGED;
          game.flagsCount++;
        }
      }
    }
  }

  /**
   * マスを開く。1手目なら安全に地雷を配置してから開く。
   * rng はテスト用に差し替え可能。
   */
  function reveal(game, r, c, rng) {
    if (game.status === WON || game.status === LOST) return game;
    var cell = game.cells[r][c];
    if (cell.state !== HIDDEN) return game; // 旗・開封済みは無視

    if (!game.minesPlaced) {
      placeMines(game, r, c, rng);
      computeAdjacents(game);
      game.minesPlaced = true;
      game.status = PLAYING;
    }

    if (cell.mine) {
      cell.state = REVEALED;
      cell.exploded = true; // 踏んだ地雷（赤く表示する目印）
      game.status = LOST;
      revealAllMines(game);
      return game;
    }

    floodReveal(game, r, c);
    if (checkWin(game)) {
      game.status = WON;
      flagRemainingMines(game);
    }
    return game;
  }

  /** 旗を立てる／外す。未開封↔旗のみ切り替える。 */
  function toggleFlag(game, r, c) {
    if (game.status === WON || game.status === LOST) return game;
    var cell = game.cells[r][c];
    if (cell.state === HIDDEN) {
      cell.state = FLAGGED;
      game.flagsCount++;
    } else if (cell.state === FLAGGED) {
      cell.state = HIDDEN;
      game.flagsCount--;
    }
    return game;
  }

  /**
   * 和音クリック：開封済みの数字マスで、周囲の旗の数がその数字と一致していれば、
   * 周囲の未開封（旗でない）マスをまとめて開く。
   */
  function chord(game, r, c, rng) {
    if (game.status === WON || game.status === LOST) return game;
    var cell = game.cells[r][c];
    if (cell.state !== REVEALED || cell.adjacent === 0) return game;
    var ns = neighborCoords(r, c, game.rows, game.cols);
    var flags = 0;
    for (var i = 0; i < ns.length; i++) {
      if (game.cells[ns[i][0]][ns[i][1]].state === FLAGGED) flags++;
    }
    if (flags !== cell.adjacent) return game;
    for (var j = 0; j < ns.length; j++) {
      var ncell = game.cells[ns[j][0]][ns[j][1]];
      if (ncell.state === HIDDEN) {
        reveal(game, ns[j][0], ns[j][1], rng);
        if (game.status === LOST) return game;
      }
    }
    return game;
  }

  /** 残り地雷数（カウンター表示用）：総地雷数 − 立てた旗の数。 */
  function minesRemaining(game) {
    return game.mineCount - game.flagsCount;
  }

  global.MS = {
    // 定数
    HIDDEN: HIDDEN, REVEALED: REVEALED, FLAGGED: FLAGGED,
    READY: READY, PLAYING: PLAYING, WON: WON, LOST: LOST,
    // 関数
    createGame: createGame,
    neighborCoords: neighborCoords,
    placeMines: placeMines,
    computeAdjacents: computeAdjacents,
    setMines: setMines,
    revealAllMines: revealAllMines,
    checkWin: checkWin,
    flagRemainingMines: flagRemainingMines,
    reveal: reveal,
    toggleFlag: toggleFlag,
    chord: chord,
    minesRemaining: minesRemaining
  };

  // Node 等でも require できるように（任意）
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.MS;
  }
})(typeof window !== 'undefined' ? window : this);
