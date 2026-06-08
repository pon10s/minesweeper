/*
 * main.js — 初期化・イベント結合
 * 操作：タップ＝開く（旗マスはタップで解除）／長押し＝旗。最初のクリック安全・タイマー・ベストタイム記録。
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

  // --- プレイヤー名（ランキング用） ---
  function loadPlayerName() { return localStorage.getItem('ms_player_name') || ''; }
  function savePlayerName(n) { localStorage.setItem('ms_player_name', n); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  var LEVEL_NAMES = { beginner: '初級', intermediate: '中級', expert: '上級' };

  var el = {};               // 主要DOMの参照
  var game = null;           // 現在のゲーム
  var currentLevel = 'beginner';
  var timerId = null;        // タイマーの setInterval ID
  var seconds = 0;           // 経過秒

  // 長押し判定用
  var LONG_PRESS_MS = 225;   // この時間押し続けたら旗（短めに調整）
  var MOVE_TOL = 10;         // この距離以上動いたらスクロール扱いでキャンセル
  var pressTimer = null;     // 長押しタイマー
  var pressCell = null;      // 押している対象 {r,c}
  var pressX = 0, pressY = 0;
  var longPressed = false;   // 長押しが成立したか

  // ヒント用
  var HINT_COOLDOWN_MS = 5000;  // 最後の操作から5秒でヒント解禁（それまではボタン非活性）
  var hintTimer = null;         // ヒント解禁タイマー
  var hintUsed = false;         // このゲームでヒントを使ったか（使うとベスト/ランキング対象外）

  function cacheDom() {
    el.board = document.getElementById('board');
    el.mineCounter = document.getElementById('mineCounter');
    el.timer = document.getElementById('timer');
    el.face = document.getElementById('faceBtn');
    el.bestTime = document.getElementById('bestTime');
    el.difficultyBtns = document.querySelectorAll('.ms-difficulty .ms-btn');
    el.hintBtn = document.getElementById('hintBtn');
    el.rankBtn = document.getElementById('rankBtn');
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
    // ヒントは新ゲームでリセット（開始前は押せない）
    hintUsed = false;
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    setHintEnabled(false);
  }

  // --- ヒント ---
  /** ヒントボタンの有効/無効を切り替える。 */
  function setHintEnabled(on) {
    if (el.hintBtn) el.hintBtn.disabled = !on;
  }
  /** 盤面上のヒント点滅を消す。 */
  function clearHintHighlight() {
    var h = el.board.querySelector('.ms-cell.hint');
    if (h) h.classList.remove('hint');
  }
  /** ヒントを無効化して、プレイ中なら5秒後に解禁する。 */
  function scheduleHint() {
    setHintEnabled(false); // 解禁までは非活性（グレーアウト）
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    if (game.status === MS.PLAYING) {
      hintTimer = setTimeout(function () {
        if (game.status === MS.PLAYING) setHintEnabled(true);
      }, HINT_COOLDOWN_MS);
    }
  }
  /** ヒント押下：安全マスを1つ光らせる（開けるのは自分）。 */
  function onHint() {
    if (el.hintBtn.disabled || game.status !== MS.PLAYING) return;
    var pos = MS.findSafeCell(game);
    if (!pos) return;
    clearHintHighlight();
    var idx = pos[0] * game.cols + pos[1];
    var cellEl = el.board.children[idx];
    if (cellEl) cellEl.classList.add('hint');
    hintUsed = true;          // この局面はベスト/ランキング対象外
    scheduleHint();           // 使ったら再び10秒待ち
  }

  /** 操作後の共通処理：タイマー・ベスト・再描画・ヒント再カウント。 */
  function applyResult() {
    // 最初に開いた瞬間（READY→PLAYING）にタイマー開始
    if (game.status === MS.PLAYING) startTimer();
    if (game.status === MS.WON || game.status === MS.LOST) {
      stopTimer();
      if (game.status === MS.WON) {
        // ヒントを使ったゲームはベスト更新しない（公平性）
        if (!hintUsed) {
          var prev = loadBest(currentLevel);
          if (prev === null || seconds < prev) {
            saveBest(currentLevel, seconds);
          }
        }
        showBest(currentLevel);
      }
    }
    UI.refreshBoard(game, el.board); // ヒント点滅も描き直しで消える
    refreshStatus();
    // 操作があったので、ヒントは無効化して5秒カウントし直し
    scheduleHint();
    // 勝ったらランキング登録の案内
    if (game.status === MS.WON) onWin();
  }

  // --- ランキング ---
  /** クリア時：ヒント未使用＆TOP10入りできるタイムなら、名前入力→登録の案内を出す。 */
  function onWin() {
    if (hintUsed) return;                 // ヒント使用は対象外
    if (!global.Ranking || !global.Ranking.enabled) return;
    var clearedLevel = currentLevel;
    var clearedTime = seconds;
    // 現在のTOP10を見て、ランクインできる時だけ登録案内を出す
    global.Ranking.fetchTop(clearedLevel, 10).then(function (rows) {
      var eligible = rows.length < 10 || clearedTime < rows[rows.length - 1].time;
      if (eligible) promptNameAndSubmit(clearedLevel, clearedTime);
    }).catch(function () {
      // 取得に失敗したら、念のため案内を出す（送信可否は本人が判断）
      promptNameAndSubmit(clearedLevel, clearedTime);
    });
  }

  /** 名前入力モーダルを出して、登録したら反映する。 */
  function promptNameAndSubmit(level, time) {
    var name = loadPlayerName();
    UI.openModal({
      title: 'ベスト10入りおめでとう！🎉',
      bodyHtml: 'ランキングにお名前登録してねん♪<br>' +
        'タイム <b>' + UI.formatTime(time) + '</b>（' + LEVEL_NAMES[level] + '）' +
        '<input id="nameInput" class="ms-name-input" maxlength="20" placeholder="なまえ（20文字まで）" value="' + escapeHtml(name) + '">',
      buttons: [
        { label: 'スキップ', onClick: function () {} },
        { label: '登録', primary: true, onClick: function () {
          var input = document.getElementById('nameInput');
          var v = input ? input.value.trim() : '';
          if (!v) { input && input.focus(); return true; } // 空ならモーダルを閉じない
          savePlayerName(v);
          submitAndShowRanking(v, level, time);
        } }
      ]
    });
  }

  /** スコアを送信して、その難易度のランキングを表示する。 */
  function submitAndShowRanking(name, level, time) {
    global.Ranking.submitScore(name, level, time)
      .then(function () { showRanking(level); })
      .catch(function () {
        UI.openModal({
          title: '送信エラー',
          bodyHtml: 'ランキングへの送信に失敗しました。<br>通信環境を確認してもう一度お試しください。',
          buttons: [{ label: '閉じる' }]
        });
      });
  }

  function renderRankList(rows) {
    if (!rows || !rows.length) return '<div class="rank-empty">まだ記録がありません。</div>';
    var html = '<ol class="rank-list">';
    rows.forEach(function (r) {
      html += '<li><span class="rank-name">' + escapeHtml(r.name) + '</span>' +
        '<span class="rank-time">' + UI.formatTime(r.time) + '</span></li>';
    });
    return html + '</ol>';
  }

  /** ランキングをモーダルで表示（難易度ボタンで切替）。 */
  function showRanking(level) {
    level = level || currentLevel;
    function load(lv) {
      var body = document.getElementById('rankBody');
      if (body) body.innerHTML = '読み込み中...';
      global.Ranking.fetchTop(lv, 10)
        .then(function (rows) { var b = document.getElementById('rankBody'); if (b) b.innerHTML = renderRankList(rows); })
        .catch(function () { var b = document.getElementById('rankBody'); if (b) b.innerHTML = '<div class="rank-empty">読み込みに失敗しました。</div>'; });
    }
    UI.openModal({
      title: 'ランキング',
      bodyHtml: '<div id="rankBody">読み込み中...</div>',
      buttons: [
        { label: '初級', onClick: function () { load('beginner'); return true; } },
        { label: '中級', onClick: function () { load('intermediate'); return true; } },
        { label: '上級', onClick: function () { load('expert'); return true; } },
        { label: '閉じる', onClick: function () {} }
      ]
    });
    load(level);
  }

  /** タップ：旗マス→旗を外す／未開封→開く／開封済み→何もしない。 */
  function handleTap(r, c) {
    if (game.status === MS.WON || game.status === MS.LOST) return;
    var cell = game.cells[r][c];
    if (cell.state === MS.FLAGGED) {
      MS.toggleFlag(game, r, c); // 旗を外す
    } else if (cell.state === MS.HIDDEN) {
      MS.reveal(game, r, c);     // 開く
    } else {
      return;
    }
    applyResult();
  }

  /** 長押し：未開封マスに旗を立てる／旗マスは旗を外す（トグル）。 */
  function handleLongPress(r, c) {
    if (game.status === MS.WON || game.status === MS.LOST) return;
    var cell = game.cells[r][c];
    if (cell.state === MS.HIDDEN || cell.state === MS.FLAGGED) {
      MS.toggleFlag(game, r, c); // HIDDEN→旗 / FLAGGED→解除
      applyResult();
    }
  }

  /** 難易度を実際に切り替える（確認なし）。 */
  function doSetLevel(level) {
    for (var i = 0; i < el.difficultyBtns.length; i++) {
      var b = el.difficultyBtns[i];
      b.classList.toggle('is-active', b.dataset.level === level);
    }
    newGame(level);
  }

  /**
   * 難易度ボタン押下時の処理。
   * プレイ中（PLAYING）は誤タップ防止の確認モーダルを出す（タイマーは止めない）。
   * 開始前・勝敗後は確認なしで即切替。
   */
  function setLevel(level) {
    if (game && game.status === MS.PLAYING) {
      UI.openModal({
        title: '難易度の変更',
        bodyHtml: '「' + LEVEL_NAMES[level] + '」に切り替えますか？<br>今のゲームはリセットされます。',
        buttons: [
          { label: 'いいえ', onClick: function () {} },
          { label: 'はい', primary: true, onClick: function () { doSetLevel(level); } }
        ]
      });
      return;
    }
    doSetLevel(level);
  }

  /** イベント座標から対象マス {r,c} を返す（マス外は null）。 */
  function cellFromTarget(t) {
    while (t && t !== el.board) {
      if (t.dataset && t.dataset.r !== undefined) {
        return { r: parseInt(t.dataset.r, 10), c: parseInt(t.dataset.c, 10) };
      }
      t = t.parentNode;
    }
    return null;
  }

  /** 長押しタイマー・押下状態をクリアする。 */
  function clearPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressCell = null;
  }

  function onPointerDown(ev) {
    var cell = cellFromTarget(ev.target);
    if (!cell) return;
    pressCell = cell;
    pressX = ev.clientX;
    pressY = ev.clientY;
    longPressed = false;
    // 押下中は驚き顔
    if (game.status === MS.READY || game.status === MS.PLAYING) {
      UI.renderFace(el.face, game.status, true);
    }
    pressTimer = setTimeout(function () {
      longPressed = true;
      pressTimer = null;
      if (pressCell) {
        handleLongPress(pressCell.r, pressCell.c);
        if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} }
      }
      UI.renderFace(el.face, game.status); // 顔を戻す
    }, LONG_PRESS_MS);
  }

  function onPointerMove(ev) {
    if (!pressCell) return;
    if (Math.abs(ev.clientX - pressX) > MOVE_TOL || Math.abs(ev.clientY - pressY) > MOVE_TOL) {
      clearPress(); // スクロール等とみなしキャンセル
      if (game) UI.renderFace(el.face, game.status);
    }
  }

  function onPointerUp() {
    if (game) UI.renderFace(el.face, game.status);
    var cell = pressCell;
    var wasLong = longPressed;
    clearPress();
    if (cell && !wasLong) {
      handleTap(cell.r, cell.c); // 長押し不成立＝タップ
    }
    longPressed = false;
  }

  function bindEvents() {
    el.board.addEventListener('pointerdown', onPointerDown);
    el.board.addEventListener('pointermove', onPointerMove);
    el.board.addEventListener('pointerup', onPointerUp);
    el.board.addEventListener('pointercancel', function () {
      clearPress();
      if (game) UI.renderFace(el.face, game.status);
    });
    // 長押しメニュー（コンテキストメニュー）を抑止
    el.board.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

    el.face.addEventListener('click', function () { newGame(currentLevel); });
    el.hintBtn.addEventListener('click', onHint);
    el.rankBtn.addEventListener('click', function () { showRanking(currentLevel); });

    // 画面サイズ・向きが変わったらマスサイズを再調整
    window.addEventListener('resize', fitBoard);
    window.addEventListener('orientationchange', fitBoard);

    el.difficultyBtns.forEach(function (b) {
      b.addEventListener('click', function () { setLevel(b.dataset.level); });
    });
  }

  function init() {
    cacheDom();
    bindEvents();
    newGame('beginner');
    // デバッグ用に公開（プレビュー検証で利用）
    global._ms = {
      get game() { return game; },
      get hintUsed() { return hintUsed; },
      el: el, newGame: newGame, setLevel: setLevel,
      handleTap: handleTap, handleLongPress: handleLongPress,
      onHint: onHint, setHintEnabled: setHintEnabled
    };
  }

  global.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : this);
