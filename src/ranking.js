/*
 * ranking.js — オンライン共有ランキング（Supabase REST API）
 *
 * anon public キーは「公開してよい」種類のキー。アクセス制御は Supabase 側の
 * RLS ポリシー（読み取り可／正しい形のスコア追加のみ可）で守られている。
 */
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://bbgrxlryalrewsjuscyk.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiZ3J4bHJ5YWxyZXdzanVzY3lrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MjQ1ODgsImV4cCI6MjA5NjIwMDU4OH0.h-b7z2PwPFNj8IWyng_u_x8d1GTlJ4Yh1x90D3cqO9s';

  var SCORES_ENDPOINT  = SUPABASE_URL + '/rest/v1/scores';
  var SUBMIT_ENDPOINT  = SUPABASE_URL + '/functions/v1/submit-score';
  var HEADERS = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type': 'application/json'
  };

  /** スコアをEdge Functionへ送信する。サーバー側で手順を検証してからDBに登録する。 */
  function submitScore(name, level, time, mines, moves) {
    return fetch(SUBMIT_ENDPOINT, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ name: name, level: level, time: time, mines: mines, moves: moves })
    }).then(function (res) {
      if (!res.ok) throw new Error('送信に失敗しました (' + res.status + ')');
      return true;
    });
  }

  /** 指定難易度のTOP（タイム昇順）を取得する Promise。 */
  function fetchTop(level, limit) {
    limit = limit || 10;
    var url = SCORES_ENDPOINT +
      '?select=name,time,created_at' +
      '&level=eq.' + encodeURIComponent(level) +
      '&order=time.asc&limit=' + limit;
    return fetch(url, { headers: HEADERS }).then(function (res) {
      if (!res.ok) throw new Error('取得に失敗しました (' + res.status + ')');
      return res.json();
    });
  }

  global.Ranking = {
    enabled: true,
    submitScore: submitScore,
    fetchTop: fetchTop
  };
})(typeof window !== 'undefined' ? window : this);
