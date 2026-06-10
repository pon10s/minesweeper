import { createClient } from 'jsr:@supabase/supabase-js@2'

const LEVELS: Record<string, { rows: number; cols: number; mines: number; minTime: number }> = {
  beginner:     { rows: 9,  cols: 9,  mines: 10, minTime: 1  },
  intermediate: { rows: 16, cols: 16, mines: 40, minTime: 9  },
  expert:       { rows: 30, cols: 16, mines: 99, minTime: 24 }
}

type CellState = 'hidden' | 'flagged' | 'revealed'
type Cell = { mine: boolean; adjacent: number; state: CellState }
type Move = { a: string; r: number; c: number; t: number }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey'
}

const NOTICE = 'とうろくできなかったみたい…ズルはダメだよ♡'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  })
}

function reject() {
  return json({ error: NOTICE }, 400)
}

const KP = [0x5b, 0x27, 0x9e, 0x42, 0xa1, 0x6d, 0xc3, 0x14, 0x7f, 0x38, 0xe5, 0x91, 0x2a, 0xb6, 0x4c, 0xd0]

function unpack(d: string): unknown {
  const bin = atob(d)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ KP[i % KP.length]
  return JSON.parse(new TextDecoder().decode(bytes))
}

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

function checkMoves(
  config: { rows: number; cols: number; mines: number; minTime: number },
  mines: number[][],
  moves: Move[],
  declaredTime: number
): boolean {
  const { rows, cols } = config

  const cells: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ mine: false, adjacent: 0, state: 'hidden' as CellState }))
  )

  for (const [mr, mc] of mines) {
    if (mr < 0 || mr >= rows || mc < 0 || mc >= cols) return false
    cells[mr][mc].mine = true
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cells[r][c].mine) continue
      cells[r][c].adjacent = neighbors(r, c, rows, cols)
        .filter(([nr, nc]) => cells[nr][nc].mine).length
    }
  }

  let revealedCount = 0
  let prevT = -1
  let tooFast = 0

  for (const move of moves) {
    const { a, r, c, t } = move
    if (typeof r !== 'number' || typeof c !== 'number' || typeof t !== 'number') return false
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false
    if (t < prevT) return false
    if (prevT >= 0 && t - prevT < 3) tooFast++
    prevT = t

    const cell = cells[r][c]

    if (a === 'r') {
      if (cell.state !== 'hidden') return false
      if (cell.mine) return false
      revealedCount += floodReveal(cells, r, c, rows, cols)
    } else if (a === 'f') {
      if (cell.state !== 'hidden') return false
      cell.state = 'flagged'
    } else if (a === 'u') {
      if (cell.state !== 'flagged') return false
      cell.state = 'hidden'
    } else {
      return false
    }
  }

  if (revealedCount !== rows * cols - config.mines) return false

  const lastT = moves[moves.length - 1].t
  if (Math.abs(Math.round(lastT / 1000) - declaredTime) > 3) return false
  if (Math.round(lastT / 1000) < config.minTime) return false
  if (tooFast > moves.length * 0.5) return false

  return true
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method Not Allowed' }, 405)
  }

  let payload: { name: string; level: string; time: number; mines: number[][]; moves: Move[] }
  try {
    const outer = await req.json()
    payload = unpack(outer.d) as typeof payload
  } catch {
    return reject()
  }

  const { name, level, time, mines, moves } = payload

  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 20) {
    return reject()
  }

  const config = LEVELS[level]
  if (!config) return reject()

  if (typeof time !== 'number' || !Number.isInteger(time) || time < config.minTime || time > 999) {
    return reject()
  }

  if (!Array.isArray(mines) || mines.length !== config.mines) {
    return reject()
  }

  if (!Array.isArray(moves) || moves.length === 0 || moves.length > 10000) {
    return reject()
  }

  if (!checkMoves(config, mines, moves, time)) {
    return reject()
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { error } = await supabase
    .from('scores')
    .insert({ name: name.trim(), level, time })

  if (error) return reject()

  return json({ ok: true })
})
