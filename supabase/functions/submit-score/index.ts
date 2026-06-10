import { createClient } from 'jsr:@supabase/supabase-js@2'

// 難易度設定
const LEVELS: Record<string, { rows: number; cols: number; mines: number; minTime: number }> = {
  beginner:     { rows: 9,  cols: 9,  mines: 10, minTime: 1  },
  intermediate: { rows: 16, cols: 16, mines: 40, minTime: 5  },
  expert:       { rows: 30, cols: 16, mines: 99, minTime: 20 }
}

type CellState = 'hidden' | 'flagged' | 'revealed'
type Cell = { mine: boolean; adjacent: number; state: CellState }
type Move = { a: string; r: number; c: number; t: number }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  })
}

// 周囲8マスの座標を返す
function neighbors(r: number, c: number, rows: number, cols: number): [number, number][] {
  const res: [number, number][] = []
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const nr = r + dr, nc = c + dc
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) res.push([nr, nc])
    }
  }
  return res
}

// flood fill（クライアントと同じロジック）。開封したマス数を返す
function floodReveal(cells: Cell[][], r: number, c: number, rows: number, cols: number): number {
  const stack: [number, number][] = [[r, c]]
  let count = 0
  while (stack.length) {
    const [cr, cc] = stack.pop()!
    const cell = cells[cr][cc]
    if (cell.state !== 'hidden') continue
    if (cell.mine) continue
    cell.state = 'revealed'
    count++
    if (cell.adjacent === 0) {
      for (const [nr, nc] of neighbors(cr, cc, rows, cols)) {
        if (cells[nr][nc].state === 'hidden' && !cells[nr][nc].mine) {
          stack.push([nr, nc])
        }
      }
    }
  }
  return count
}

// ゲームを再現して手順が正当かを検証する
function validateGame(
  config: { rows: number; cols: number; mines: number; minTime: number },
  mines: number[][],
  moves: Move[],
  declaredTime: number
): boolean {
  const { rows, cols } = config

  // 盤面を構築
  const cells: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ mine: false, adjacent: 0, state: 'hidden' as CellState }))
  )

  // 地雷を配置
  for (const [mr, mc] of mines) {
    if (mr < 0 || mr >= rows || mc < 0 || mc >= cols) return false
    cells[mr][mc].mine = true
  }

  // 周囲地雷数を計算
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cells[r][c].mine) continue
      cells[r][c].adjacent = neighbors(r, c, rows, cols)
        .filter(([nr, nc]) => cells[nr][nc].mine).length
    }
  }

  let revealedCount = 0
  let prevT = -1

  for (const move of moves) {
    const { a, r, c, t } = move
    if (typeof r !== 'number' || typeof c !== 'number' || typeof t !== 'number') return false
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false
    if (t < prevT) return false  // 時刻は単調増加でなければならない
    prevT = t

    const cell = cells[r][c]

    if (a === 'r') {
      // 開く：hiddenでなければ不正（cascade済みのマスを再クリックしている）
      if (cell.state !== 'hidden') return false
      if (cell.mine) return false  // 勝利ゲームで地雷を踏むのは不正
      revealedCount += floodReveal(cells, r, c, rows, cols)
    } else if (a === 'f') {
      // 旗を立てる
      if (cell.state !== 'hidden') return false
      cell.state = 'flagged'
    } else if (a === 'u') {
      // 旗を外す
      if (cell.state !== 'flagged') return false
      cell.state = 'hidden'
    } else {
      return false  // 不明なアクション
    }
  }

  // 勝利条件：地雷以外の全マスが開封済み
  if (revealedCount !== rows * cols - config.mines) return false

  // タイム整合性：最後の手のt（ms）をsecに変換してdeclaredTimeと照合
  const lastT = moves[moves.length - 1].t
  if (Math.abs(Math.round(lastT / 1000) - declaredTime) > 3) return false

  return true
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method Not Allowed' }, 405)
  }

  let body: { name: string; level: string; time: number; mines: number[][]; moves: Move[] }
  try {
    body = await req.json()
  } catch {
    return json({ error: '不正なリクエストです' }, 400)
  }

  const { name, level, time, mines, moves } = body

  // 名前チェック
  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 20) {
    return json({ error: '名前が無効です' }, 400)
  }

  // 難易度チェック
  const config = LEVELS[level]
  if (!config) return json({ error: '難易度が無効です' }, 400)

  // タイムチェック
  if (typeof time !== 'number' || !Number.isInteger(time) || time < config.minTime || time > 999) {
    return json({ error: 'タイムが無効です' }, 400)
  }

  // 地雷データチェック
  if (!Array.isArray(mines) || mines.length !== config.mines) {
    return json({ error: '地雷データが無効です' }, 400)
  }

  // 手順データチェック
  if (!Array.isArray(moves) || moves.length === 0 || moves.length > 10000) {
    return json({ error: '手順データが無効です' }, 400)
  }

  // ゲームを再現して手順を検証
  if (!validateGame(config, mines, moves, time)) {
    return json({ error: '手順の検証に失敗しました' }, 400)
  }

  // service_role キーでDBに登録（anonキーでの直接INSERTは禁止）
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { error } = await supabase
    .from('scores')
    .insert({ name: name.trim(), level, time })

  if (error) return json({ error: 'データベースエラー' }, 500)

  return json({ ok: true })
})
