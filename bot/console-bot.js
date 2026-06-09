/*
 * console-bot.js — マインスイーパー自動攻略ロボット（コンソール貼り付け版）
 *
 * 使い方：
 *   1) マインスイーパーのページを開く（https://pon10s.github.io/minesweeper/ など）
 *   2) ブラウザの開発者ツール → コンソール を開く（PCなら F12 / Mac は Cmd+Opt+I）
 *   3) このファイルの中身を全部コピーして貼り付け、Enter
 *   4) ロボットが人間と同じ操作（タップ＝開く／長押し＝旗）で高速に解き始める
 *   5) 止めるには  msBot.stop()  と打って Enter
 *
 * 仕様：
 *   - 本体（ゲーム）には一切手を加えず、画面（DOM）を読んで合成イベントで操作する。
 *   - まず確実な手（基本ルール→定石＝部分集合の法則）を処理。確実な手が尽きたら
 *     「地雷の確率が一番低いマス」を推測で開く（当たって砕けろ）。
 *   - 地雷を踏んだら自動でリセットして再挑戦（勝つまで）。
 *   - クリアしたら停止（名前登録は人が判断。ロボットは何も送信しない）。
 */
(function () {
  'use strict';

  // すでに動いていたら止めてから入れ替え（多重起動防止）
  if (window.msBot && window.msBot.running) {
    window.msBot.stop();
  }
  // 世代トークン：貼り直すたびに増やし、古いbotは「自分が最新でない」と気づいて停止する
  var myGen = (window.__msBotGen = (window.__msBotGen || 0) + 1);

  var STEP_MS = 70;        // 1手ごとの間隔（人間風に速い）
  var FLAG_HOLD_MS = 200;  // 旗の長押し時間（本体のしきい値120msを超える）
  var RETRY_PAUSE_MS = 400; // 負けてから再挑戦するまでの一拍

  var running = false;
  var timer = null;
  var attempts = 1;

  function log() {
    var args = ['🤖[msBot]'].concat([].slice.call(arguments));
    console.log.apply(console, args);
  }

  // ---- 盤面を読む（可視情報だけ） ----
  function cellElAt(r, c) {
    return document.querySelector('.ms-cell[data-r="' + r + '"][data-c="' + c + '"]');
  }

  function readBoard() {
    var cells = document.querySelectorAll('.ms-cell[data-r][data-c]');
    var rows = 0, cols = 0;
    cells.forEach(function (el) {
      var r = parseInt(el.dataset.r, 10), c = parseInt(el.dataset.c, 10);
      if (r + 1 > rows) rows = r + 1;
      if (c + 1 > cols) cols = c + 1;
    });
    var grid = [];
    for (var r = 0; r < rows; r++) {
      grid[r] = [];
      for (var c = 0; c < cols; c++) grid[r][c] = { state: 'hidden', n: 0 };
    }
    cells.forEach(function (el) {
      var r = parseInt(el.dataset.r, 10), c = parseInt(el.dataset.c, 10);
      var txt = (el.textContent || '').trim();
      if (el.classList.contains('revealed')) {
        if (txt === '💣') grid[r][c] = { state: 'mine', n: 0 };
        else if (/^[1-8]$/.test(txt)) grid[r][c] = { state: 'num', n: parseInt(txt, 10) };
        else grid[r][c] = { state: 'blank', n: 0 }; // 開封済みの空白(0)
      } else {
        if (txt === '🚩') grid[r][c] = { state: 'flag', n: 0 };
        else grid[r][c] = { state: 'hidden', n: 0 };
      }
    });
    return { grid: grid, rows: rows, cols: cols };
  }

  function readStatus() {
    var face = document.getElementById('faceBtn');
    var t = face ? (face.textContent || '').trim() : '';
    if (t === '😎') return 'won';
    if (t === '😵') return 'lost';
    return 'playing';
  }

  function minesRemaining() {
    var el = document.getElementById('mineCounter');
    var n = el ? parseInt(el.textContent, 10) : NaN;
    return isNaN(n) ? 0 : n;
  }

  function neighbors(r, c, rows, cols) {
    var res = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        var nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) res.push([nr, nc]);
      }
    }
    return res;
  }

  function key(rc) { return rc[0] + ',' + rc[1]; }
  function includesCell(list, rc) {
    for (var i = 0; i < list.length; i++) if (list[i][0] === rc[0] && list[i][1] === rc[1]) return true;
    return false;
  }
  function isSubset(small, big) {
    for (var i = 0; i < small.length; i++) if (!includesCell(big, small[i])) return false;
    return true;
  }
  function diffCells(big, small) {
    var res = [];
    for (var i = 0; i < big.length; i++) if (!includesCell(small, big[i])) res.push(big[i]);
    return res;
  }

  // ---- ソルバー（基本→定石→確率推測） ----
  function solve(board) {
    var grid = board.grid, rows = board.rows, cols = board.cols;
    var constraints = [];
    var basicMine = null;

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var cell = grid[r][c];
        if (cell.state !== 'num') continue; // 数字(1-8)だけ
        var ns = neighbors(r, c, rows, cols);
        var hidden = [], flags = 0;
        for (var i = 0; i < ns.length; i++) {
          var s = grid[ns[i][0]][ns[i][1]].state;
          if (s === 'hidden') hidden.push(ns[i]);
          else if (s === 'flag') flags++;
        }
        if (hidden.length === 0) continue;
        var need = cell.n - flags;
        // 基本ルールA（安全）：必要地雷が0 → 残りは安全
        if (need === 0) return { action: 'open', cells: hidden, why: 'basic-safe' };
        // 基本ルールB（地雷）：必要地雷＝未開封数 → 全部地雷
        if (need === hidden.length && !basicMine) {
          basicMine = { action: 'flag', cells: hidden, why: 'basic-mine' };
        }
        constraints.push({ cells: hidden, need: need });
      }
    }
    if (basicMine) return basicMine;

    // 定石（部分集合の法則）
    var subsetMine = null;
    for (var a = 0; a < constraints.length; a++) {
      for (var b = 0; b < constraints.length; b++) {
        if (a === b) continue;
        var A = constraints[a], B = constraints[b];
        if (A.cells.length >= B.cells.length) continue;
        if (!isSubset(A.cells, B.cells)) continue;
        var diff = diffCells(B.cells, A.cells);
        if (diff.length === 0) continue;
        var diffNeed = B.need - A.need;
        if (diffNeed === 0) return { action: 'open', cells: diff, why: 'subset-safe' };
        if (diffNeed === diff.length && !subsetMine) subsetMine = { action: 'flag', cells: diff, why: 'subset-mine' };
      }
    }
    if (subsetMine) return subsetMine;

    // 確率推測：一番安全そうな未開封マスを1つ開く
    var prob = {};     // "r,c" -> 制約から見た地雷っぽさ（最大密度）
    var hiddenAll = [];
    for (var rr = 0; rr < rows; rr++) {
      for (var cc = 0; cc < cols; cc++) {
        if (grid[rr][cc].state === 'hidden') hiddenAll.push([rr, cc]);
      }
    }
    if (hiddenAll.length === 0) return null;

    for (var ci = 0; ci < constraints.length; ci++) {
      var con = constraints[ci];
      var density = con.need / con.cells.length;
      for (var k = 0; k < con.cells.length; k++) {
        var kk = key(con.cells[k]);
        if (prob[kk] === undefined || density > prob[kk]) prob[kk] = density;
      }
    }
    var globalDensity = hiddenAll.length > 0 ? minesRemaining() / hiddenAll.length : 1;

    var best = null, bestP = Infinity;
    for (var h = 0; h < hiddenAll.length; h++) {
      var p = prob[key(hiddenAll[h])];
      if (p === undefined) p = globalDensity; // どの数字にも接していないマスは全体密度
      if (p < bestP) { bestP = p; best = hiddenAll[h]; }
    }
    return { action: 'guess', cell: best, p: bestP };
  }

  // ---- 操作（人間と同じ合成イベント） ----
  function dispatchPointer(el, type, x, y) {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  }
  function tap(r, c) {
    var el = cellElAt(r, c); if (!el) return;
    var b = el.getBoundingClientRect();
    var x = b.left + b.width / 2, y = b.top + b.height / 2;
    dispatchPointer(el, 'pointerdown', x, y);
    dispatchPointer(el, 'pointerup', x, y);
  }
  function longPress(r, c) {
    return new Promise(function (resolve) {
      var el = cellElAt(r, c); if (!el) return resolve();
      var b = el.getBoundingClientRect();
      var x = b.left + b.width / 2, y = b.top + b.height / 2;
      dispatchPointer(el, 'pointerdown', x, y);
      setTimeout(function () {
        dispatchPointer(el, 'pointerup', x, y);
        resolve();
      }, FLAG_HOLD_MS);
    });
  }
  function clickReset() {
    var face = document.getElementById('faceBtn');
    if (face) face.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  // ---- メインループ ----
  function schedule(ms) { timer = setTimeout(step, ms === undefined ? STEP_MS : ms); }

  function step() {
    if (!running) return;
    if (myGen !== window.__msBotGen) { stop(); return; } // 新しいbotが来たら古い自分は終了
    var status = readStatus();
    if (status === 'won') {
      log('🎉 クリア！（' + attempts + '回目の挑戦で成功）停止します。登録するかは自分で判断してね。');
      stop();
      return;
    }
    if (status === 'lost') {
      attempts++;
      log('💥 地雷を踏んだのでリセットして再挑戦（' + attempts + '回目）');
      clickReset();
      schedule(RETRY_PAUSE_MS);
      return;
    }
    var board = readBoard();
    var move = solve(board);
    if (!move) { log('打てる手が見つからないので停止。'); stop(); return; }

    if (move.action === 'flag') {
      longPress(move.cells[0][0], move.cells[0][1]).then(function () { schedule(); });
    } else {
      var cell = move.action === 'guess' ? move.cell : move.cells[0];
      if (move.action === 'guess') {
        log('🤔 確実な手なし → 一番安全そうなマス(' + cell[0] + ',' + cell[1] + ') 地雷確率およそ' +
          Math.round(move.p * 100) + '% を開く');
      }
      tap(cell[0], cell[1]);
      schedule();
    }
  }

  function start() {
    if (running) return;
    running = true;
    window.msBot.running = true;
    log('スタート！止めるには  msBot.stop()  と入力してね。');
    schedule(0);
  }
  function stop() {
    running = false;
    if (window.msBot) window.msBot.running = false;
    if (timer) { clearTimeout(timer); timer = null; }
    log('停止しました。');
  }

  window.msBot = { start: start, stop: stop, running: false, solve: solve, readBoard: readBoard };
  start();
})();
