/*
 * test.js — game.js のロジック検証（簡易ユニットテスト）
 * tests/test.html をブラウザで開くと結果が表示される。
 */
(function () {
  'use strict';

  var results = [];
  var passCount = 0;
  var failCount = 0;

  function check(name, cond) {
    if (cond) { passCount++; results.push({ ok: true, name: name }); }
    else { failCount++; results.push({ ok: false, name: name }); }
  }

  function eq(name, actual, expected) {
    check(name + ' (期待:' + expected + ' / 実際:' + actual + ')', actual === expected);
  }

  // 開封済みマスの数を数える
  function countRevealed(game) {
    var n = 0;
    for (var r = 0; r < game.rows; r++)
      for (var c = 0; c < game.cols; c++)
        if (game.cells[r][c].state === MS.REVEALED) n++;
    return n;
  }

  // ---- テスト本体 ----

  function run() {
    // 1. createGame の初期状態
    (function () {
      var g = MS.createGame(9, 9, 10);
      eq('createGame: 行数', g.rows, 9);
      eq('createGame: 列数', g.cols, 9);
      eq('createGame: 地雷数', g.mineCount, 10);
      eq('createGame: 初期ステータス', g.status, MS.READY);
      eq('createGame: 地雷未配置', g.minesPlaced, false);
      eq('createGame: 旗0', g.flagsCount, 0);
    })();

    // 2. 周囲地雷数の計算
    (function () {
      // 3x3、中央(1,1)以外の四隅に地雷4つ → 中央の adjacent は 4
      var g = MS.createGame(3, 3, 4);
      MS.setMines(g, [[0, 0], [0, 2], [2, 0], [2, 2]]);
      eq('adjacent: 中央(1,1)=4', g.cells[1][1].adjacent, 4);
      eq('adjacent: 辺(0,1)=2', g.cells[0][1].adjacent, 2);
      eq('adjacent: 地雷マスは0', g.cells[0][0].adjacent, 0);
    })();

    // 3. flood fill（連鎖オープン）
    (function () {
      // 5x5、地雷は (0,0) の1つだけ → 角(4,4)を開くとほぼ全面が開く
      var g = MS.createGame(5, 5, 1);
      MS.setMines(g, [[0, 0]]);
      MS.reveal(g, 4, 4);
      // 地雷でない24マスのうち、(0,1)(1,0)(1,1)は数字1で開く。全非地雷=24マスが開くはず
      eq('flood: 非地雷24マスが開く', countRevealed(g), 24);
      // 全非地雷を開くと勝ち → 残り地雷は自動で旗になる（開封はされない）
      eq('flood: 地雷は開かれない(勝ちで旗に)', g.cells[0][0].state, MS.FLAGGED);
      check('flood: 勝ち判定', g.status === MS.WON);
    })();

    // 4. flood fill は数字で止まる
    (function () {
      // 3x3、中央に地雷1 → 角(0,0)を開くと、その1マスだけ開く（adjacent=1なので広がらない）
      var g = MS.createGame(3, 3, 1);
      MS.setMines(g, [[1, 1]]);
      MS.reveal(g, 0, 0);
      eq('flood-stop: 数字マスは1マスだけ開く', countRevealed(g), 1);
      eq('flood-stop: (0,0)の数字=1', g.cells[0][0].adjacent, 1);
    })();

    // 5. 旗の立て下げ
    (function () {
      var g = MS.createGame(3, 3, 1);
      MS.setMines(g, [[1, 1]]);
      MS.toggleFlag(g, 0, 0);
      eq('flag: 立てると flagged', g.cells[0][0].state, MS.FLAGGED);
      eq('flag: 残り地雷=0', MS.minesRemaining(g), 0);
      MS.toggleFlag(g, 0, 0);
      eq('flag: 外すと hidden', g.cells[0][0].state, MS.HIDDEN);
      eq('flag: 残り地雷=1に戻る', MS.minesRemaining(g), 1);
      // 旗のマスは開けない
      MS.toggleFlag(g, 0, 0);
      MS.reveal(g, 0, 0);
      eq('flag: 旗マスは開かない', g.cells[0][0].state, MS.FLAGGED);
    })();

    // 6. 負け判定
    (function () {
      var g = MS.createGame(3, 3, 1);
      MS.setMines(g, [[1, 1]]);
      MS.reveal(g, 1, 1);
      eq('lose: 地雷を開くと lost', g.status, MS.LOST);
      eq('lose: 全地雷が表示される', g.cells[1][1].state, MS.REVEALED);
    })();

    // 7. 勝ち判定
    (function () {
      var g = MS.createGame(2, 2, 1);
      MS.setMines(g, [[0, 0]]);
      // 非地雷3マスを開く
      MS.reveal(g, 0, 1);
      MS.reveal(g, 1, 0);
      MS.reveal(g, 1, 1);
      eq('win: 全非地雷を開くと won', g.status, MS.WON);
    })();

    // 8. 最初のクリック安全
    (function () {
      // 8マスが地雷（安全マス以外すべて地雷）でも、クリックしたマスには地雷が置かれない
      var g = MS.createGame(3, 3, 8);
      MS.reveal(g, 1, 1); // 1手目。placeMines は (1,1) を必ず避ける
      eq('safe: クリックマスは地雷でない', g.cells[1][1].mine, false);
      eq('safe: クリックマスは開封済み', g.cells[1][1].state, MS.REVEALED);
      eq('safe: 1手目で負けない', g.status !== MS.LOST, true);
    })();

    // 9. 和音クリック
    (function () {
      // 3x3、地雷(0,0)。(1,1)を開く(=数字1)。(0,0)に旗。(1,1)を和音 → 周囲の未開封が開く
      var g = MS.createGame(3, 3, 1);
      MS.setMines(g, [[0, 0]]);
      MS.reveal(g, 1, 1);
      eq('chord: 中央の数字=1', g.cells[1][1].adjacent, 1);
      MS.toggleFlag(g, 0, 0);
      MS.chord(g, 1, 1);
      // 地雷以外の8マスが開く（中央含む）
      eq('chord: 旗一致で周囲が開く', countRevealed(g), 8);
      eq('chord: won', g.status, MS.WON);
    })();

    // 10. 和音クリック（旗が足りないと発動しない）
    (function () {
      var g = MS.createGame(3, 3, 1);
      MS.setMines(g, [[0, 0]]);
      MS.reveal(g, 1, 1); // 数字1が1マス開く
      MS.chord(g, 1, 1);  // 旗0で数字1 → 発動しない
      eq('chord: 旗不足なら何も開かない', countRevealed(g), 1);
    })();

    // 11. ヒント：findSafeCell は必ず安全マス（未開封・非地雷）を返す
    (function () {
      var g = MS.createGame(3, 3, 1);
      MS.setMines(g, [[1, 1]]); // 地雷は中央のみ
      MS.reveal(g, 0, 0);       // 角を開く（数字1なので連鎖せず1マスだけ）
      var pos = MS.findSafeCell(g);
      check('hint: 安全マスが返る', pos !== null);
      if (pos) {
        var cell = g.cells[pos[0]][pos[1]];
        check('hint: 返ったマスは地雷でない', cell.mine === false);
        check('hint: 返ったマスは未開封', cell.state === MS.HIDDEN);
      }
    })();

    // 12. ヒント：地雷未配置（開始前）は null
    (function () {
      var g = MS.createGame(3, 3, 1); // minesPlaced=false
      check('hint: 開始前は null', MS.findSafeCell(g) === null);
    })();

    // 13. ヒント：旗マスは候補にしない
    (function () {
      var g = MS.createGame(2, 2, 1);
      MS.setMines(g, [[0, 0]]);   // 地雷(0,0)。安全は(0,1)(1,0)(1,1)
      MS.toggleFlag(g, 0, 1);     // (0,1)に旗
      MS.toggleFlag(g, 1, 0);     // (1,0)に旗
      // 残る安全な未開封は (1,1) のみ
      var pos = MS.findSafeCell(g);
      check('hint: 旗を除いた安全マスを返す', pos && pos[0] === 1 && pos[1] === 1);
    })();

    render();
  }

  function render() {
    var summary = document.getElementById('summary');
    var list = document.getElementById('list');
    summary.textContent = '結果: ' + passCount + ' PASS / ' + failCount + ' FAIL（全' + (passCount + failCount) + '件）';
    summary.className = failCount === 0 ? 'pass' : 'fail';
    var html = '';
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      html += '<li class="' + (r.ok ? 'pass' : 'fail') + '">' +
        (r.ok ? '✅ ' : '❌ ') + r.name + '</li>';
    }
    list.innerHTML = html;
  }

  window.addEventListener('DOMContentLoaded', run);
})();
