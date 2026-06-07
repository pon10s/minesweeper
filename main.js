/*
 * main.js — 初期化・イベント結合
 * フェーズ3〜6: タップで開く／旗モード切り替え／最初のクリック安全／タイマー／ベストタイム記録。
 */
(function (global) {
  'use strict';
  var MS = global.MS, UI = global.UI;

  // 難易度プリセット（マス数・地雷数は本家通り）
  // 上級は本家の 16行×30列（横長）を、スマホの縦長画面に収めるため
  // 縦横を入れ替えて 30行×16列（縦長）で保持する。マス数480・地雷99は同じ。
  var LEVELS = {
    beginner:     { rows: 9,  cols: 9,  mines: 10 },
    intermediate: { rows: 16, cols: 16, mines: 40 },
    expert:       { rows: 30, cols: 16, mines: 99 }
  };

  var MAX_CELL = 40;
  var MIN_CELL = 14;

  // --- ベストタイム（localStorage）---
  var BEST_KEY_PREFIX = 'ms_best_';
  function bestKey(level) { return BEST_KEY_PREFIX + level; }
  function loadBest(level) { var v = localStorage.getItem(bestKey(level)); return v !== null ? parseInt(v, 10) : null; }
  function saveBest(level, sec) { localStorage.setItem(bestKey(level), String(sec)); }
  function showBest(level) {
    var v = loadBest(level);
    el.bestTime.textContent = v !== null ? UI.formatTime(v) : '--:--';
  }

  var el = {};               // 主要DOMの参照
  var game = null;           // 現在のゲーム
  var currentLevel = 'beginner';
  var mode = 'open';         // 'open' | 'flag'
  var timerId = null;        // タイマーの setInterval ID
  var seconds = 0;           // 経過秒

  function cacheDom() {
    el.board = document.getElementById('board');
    el.mineCounter = document.getElementById('mineCounter');
    el.timer = document.getElementById('timer');
    el.face = document.getElementById('faceBtn');
    el.bestTime = document.getElementById('bestTime');
    el.difficultyBtns = document.querySelectorAll('.ms-difficulty .ms-btn');
    el.modeBtns = document.querySelectorAll('.ms-mode .ms-btn');
  }

  /** ヘッダー（カウンター・顔）を現在の状態に合わせて更新 */
  function refreshStatus(pressed) {
    UI.renderCounter(el.mineCounter, MS.minesRemaining(game));
    UI.renderFace(el.face, game.status, pressed);
  }

  // --- タイマー ---
  function startTimer() {
    if (timerId) return;
    timerId = setInterval(function () {
      seconds = Math.min(seconds + 1, 999);
      UI.renderCounter(el.timer, seconds);
    }, 1000);
  }
  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }
  function resetTimer() {
    stopTimer();
    seconds = 0;
    UI.renderCounter(el.timer, 0);
  }

  /**
   * 盤面が画面（縦長スマホ）に収まるよう、マスの1辺(--cell)を自動算出する。
   * 横幅に収めることを最優先し、縦も画面内に収まるよう調整する。
   */
  function fitBoard() {
    if (!game) return;
    // 横方向：ビューポート幅から外枠の余白を引く（app/panel/board のパディング・ボーダー）
    var horizReserve = 12 * 2 + 8 * 2 + 4 * 2 + 4 * 2 + 6;
    var availW = window.innerWidth - horizReserve;
    // 縦方向：ヘッダーと下部コントロールと余白を引く
    var header = document.querySelector('.ms-header');
    var controls = document.querySelector('.ms-controls');
    var headerH = header ? header.getBoundingClientRect().height : 60;
    var controlsH = controls ? controls.getBoundingClientRect().height : 120;
    var vertReserve = 12 * 2 + 12 + headerH + controlsH + 8 * 2 + 4 * 2 + 4 * 2 + 16;
    var availH = window.innerHeight - vertReserve;

    var cell = Math.floor(Math.min(availW / game.cols, availH / game.rows, MAX_CELL));
    if (cell < MIN_CELL) cell = MIN_CELL; // 下限。これ以下になる極小画面のみスクロール許容
    document.documentElement.style.setProperty('--cell', cell + 'px');
  }

  /** 指定難易度で新しいゲームを開始し、画面を描画する */
  function newGame(level) {
    currentLevel = level || currentLevel;
    var p = LEVELS[currentLevel];
    game = MS.createGame(p.rows, p.cols, p.mines);
    UI.renderBoard(game, el.board);
    fitBoard();
    resetTimer();
    refreshStatus();
    showBest(currentLevel);
  }

  /** マス1つへの操作（タップ） */
  function handleCellAction(r, c) {
    if (game.status === MS.WON || game.status === MS.LOST) return;
    if (mode === 'flag') {
      MS.toggleFlag(game, r, c);
    } else {
      MS.reveal(game, r, c);
    }
    // 最初に開いた瞬間（READY→PLAYING）にタイマー開始
    if (game.status === MS.PLAYING) startTimer();
    if (game.status === MS.WON || game.status === MS.LOST) {
      stopTimer();
      if (game.status === MS.WON) {
        var prev = loadBest(currentLevel);
        if (prev === null || seconds < prev) {
          saveBest(currentLevel, seconds);
        }
        showBest(currentLevel);
      }
    }
    UI.refreshBoard(game, el.board);
    refreshStatus();
  }

  /** 盤面のタップ → 対象マスを特定して操作 */
  function onBoardClick(ev) {
    var t = ev.target;
    while (t && t !== el.board && !(t.dataset && t.dataset.r !== undefined)) {
      t = t.parentNode;
    }
    if (!t || t === el.board || t.dataset.r === undefined) return;
    handleCellAction(parseInt(t.dataset.r, 10), parseInt(t.dataset.c, 10));
  }

  /** 開く/旗 モードの切り替え */
  function setMode(next) {
    mode = next;
    for (var i = 0; i < el.modeBtns.length; i++) {
      var b = el.modeBtns[i];
      b.classList.toggle('is-active', b.dataset.mode === mode);
    }
  }

  /** 難易度の切り替え（盤面サイズの画面フィットはフェーズ5で調整） */
  function setLevel(level) {
    for (var i = 0; i < el.difficultyBtns.length; i++) {
      var b = el.difficultyBtns[i];
      b.classList.toggle('is-active', b.dataset.level === level);
    }
    newGame(level);
  }

  /** マスの上か判定 */
  function isCellTarget(t) {
    while (t && t !== el.board) {
      if (t.dataset && t.dataset.r !== undefined) return true;
      t = t.parentNode;
    }
    return false;
  }

  function bindEvents() {
    el.board.addEventListener('click', onBoardClick);

    // 押している間はニコちゃんを驚き顔（😮）に
    el.board.addEventListener('pointerdown', function (ev) {
      if ((game.status === MS.READY || game.status === MS.PLAYING) && isCellTarget(ev.target)) {
        UI.renderFace(el.face, game.status, true);
      }
    });
    document.addEventListener('pointerup', function () {
      if (game) UI.renderFace(el.face, game.status);
    });
    document.addEventListener('pointercancel', function () {
      if (game) UI.renderFace(el.face, game.status);
    });

    el.face.addEventListener('click', function () { newGame(currentLevel); });

    // 画面サイズ・向きが変わったらマスサイズを再調整
    window.addEventListener('resize', fitBoard);
    window.addEventListener('orientationchange', fitBoard);

    el.modeBtns.forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode); });
    });
    el.difficultyBtns.forEach(function (b) {
      b.addEventListener('click', function () { setLevel(b.dataset.level); });
    });
  }

  function init() {
    cacheDom();
    bindEvents();
    setMode('open');
    newGame('beginner');
    // デバッグ用に公開（プレビュー検証で利用）
    global._ms = {
      get game() { return game; },
      get mode() { return mode; },
      el: el, newGame: newGame, setMode: setMode, setLevel: setLevel
    };
  }

  global.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : this);
