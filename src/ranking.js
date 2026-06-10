/*
 * ranking.js — オンライン共有ランキング（Supabase）
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

  var KP = [0x5b, 0x27, 0x9e, 0x42, 0xa1, 0x6d, 0xc3, 0x14, 0x7f, 0x38, 0xe5, 0x91, 0x2a, 0xb6, 0x4c, 0xd0];

  function pack(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    var out = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ KP[i % KP.length];
    var bin = '';
    for (var j = 0; j < out.length; j++) bin += String.fromCharCode(out[j]);
    return btoa(bin);
  }

  function submitScore(name, level, time, mines, moves) {
    var d = pack({ name: name, level: level, time: time, mines: mines, moves: moves });
    return fetch(SUBMIT_ENDPOINT, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ d: d })
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
