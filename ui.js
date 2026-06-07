/*
 * ui.js — 描画・DOM操作（ゲームのロジックには触れない）
 * window.UI に描画関数を公開する。
 */
(function (global) {
  'use strict';
  var MS = global.MS;

  /** 子要素を全消去 */
  function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  /** 1マスの見た目を、セルの状態に合わせて更新する */
  function applyCellView(el, cell) {
    el.className = 'ms-cell';
    el.textContent = '';
    if (cell.state === MS.HIDDEN) {
      el.classList.add('hidden');
    } else if (cell.state === MS.FLAGGED) {
      el.classList.add('hidden');
      el.textContent = '🚩';
    } else { // REVEALED
      el.classList.add('revealed');
      if (cell.mine) {
        el.textContent = '💣';
        if (cell.exploded) el.classList.add('exploded');
      } else if (cell.adjacent > 0) {
        el.classList.add('num-' + cell.adjacent);
        el.textContent = String(cell.adjacent);
      }
    }
  }

  /** 盤面全体をゼロから描画する（マスのDOMを作る） */
  function renderBoard(game, boardEl) {
    boardEl.style.setProperty('--cols', game.cols);
    clearEl(boardEl);
    var frag = document.createDocumentFragment();
    for (var r = 0; r < game.rows; r++) {
      for (var c = 0; c < game.cols; c++) {
        var el = document.createElement('div');
        el.dataset.r = r;
        el.dataset.c = c;
        applyCellView(el, game.cells[r][c]);
        frag.appendChild(el);
      }
    }
    boardEl.appendChild(frag);
  }

  /** 既存DOMを作り直さず、各マスの見た目だけ更新する（操作後の再描画用） */
  function refreshBoard(game, boardEl) {
    var els = boardEl.children;
    var i = 0;
    for (var r = 0; r < game.rows; r++) {
      for (var c = 0; c < game.cols; c++) {
        applyCellView(els[i], game.cells[r][c]);
        i++;
      }
    }
  }

  /** 3桁ゼロ埋め（負数にも対応：-01 など） */
  function pad3(n) {
    var neg = n < 0;
    var s = String(Math.abs(n));
    while (s.length < (neg ? 2 : 3)) s = '0' + s;
    return neg ? '-' + s : s;
  }

  function renderCounter(el, value) {
    el.textContent = pad3(value);
  }

  /** ニコちゃんの表情。pressed=押下中（驚き顔） */
  function renderFace(el, status, pressed) {
    var face = '🙂';
    if (status === MS.WON) face = '😎';
    else if (status === MS.LOST) face = '😵';
    else if (pressed) face = '😮';
    el.textContent = face;
  }

  /** 秒数を mm:ss 表記に */
  function formatTime(sec) {
    if (sec == null) return '--:--';
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  global.UI = {
    clearEl: clearEl,
    applyCellView: applyCellView,
    renderBoard: renderBoard,
    refreshBoard: refreshBoard,
    renderCounter: renderCounter,
    renderFace: renderFace,
    formatTime: formatTime
  };
})(typeof window !== 'undefined' ? window : this);
