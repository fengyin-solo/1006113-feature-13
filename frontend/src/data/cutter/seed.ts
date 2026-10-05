import type { CutterDomain } from './types'

// 存量刀具按刀盘位置照旧补录。历史检查读数是 v1 口径（实测直径减少量），
// 加载时由现行 v2 算法（径向磨损 = 直径减少量 ÷ 2）统一重算，限值按刀具类型快照。
export function buildCutterSeed(): CutterDomain {
  const seededAt = '2026-09-05T08:00:00+08:00'
  const raw = [
    // 一工区刀盘：1#～8#
    { c: 1, code: 'CUTT-1001', pos: '1#', type: '滚刀' as const, d: 432, zone: '一工区' as const, date: '2026-09-01', ring: 'R-101', reading: 14, by: '周检' },
    { c: 2, code: 'CUTT-1002', pos: '2#', type: '滚刀' as const, d: 432, zone: '一工区' as const, date: '2026-09-02', ring: 'R-102', reading: 52, by: '周检' },
    { c: 3, code: 'CUTT-1003', pos: '3#', type: '切刀' as const, d: 380, zone: '一工区' as const, date: '2026-09-02', ring: 'R-102', reading: 30, by: '周检' },
    { c: 4, code: 'CUTT-1004', pos: '4#', type: '切刀' as const, d: 380, zone: '一工区' as const, date: '2026-09-03', ring: 'R-103', reading: 16, by: '周检' },
    { c: 5, code: 'CUTT-1005', pos: '5#', type: '边刮刀' as const, d: 350, zone: '一工区' as const, date: '2026-09-03', ring: 'R-103', reading: 26, by: '周检' },
    { c: 6, code: 'CUTT-1006', pos: '6#', type: '边刮刀' as const, d: 350, zone: '一工区' as const, date: '2026-09-01', ring: 'R-101', reading: 24, by: '周检' },
    { c: 7, code: 'CUTT-1007', pos: '7#', type: '滚刀' as const, d: 432, zone: '一工区' as const, date: '2026-09-04', ring: 'R-104', reading: 8, by: '周检' },
    { c: 8, code: 'CUTT-1008', pos: '8#', type: '切刀' as const, d: 380, zone: '一工区' as const, date: '2026-09-04', ring: 'R-104', reading: 6, by: '周检' },
    // 二工区刀盘：1#～4#
    { c: 9, code: 'CUTT-2001', pos: '1#', type: '滚刀' as const, d: 432, zone: '二工区' as const, date: '2026-09-02', ring: 'R-201', reading: 12, by: '周检' },
    { c: 10, code: 'CUTT-2002', pos: '2#', type: '滚刀' as const, d: 432, zone: '二工区' as const, date: '2026-09-03', ring: 'R-202', reading: 46, by: '周检' },
    { c: 11, code: 'CUTT-2003', pos: '3#', type: '切刀' as const, d: 380, zone: '二工区' as const, date: '2026-09-03', ring: 'R-202', reading: 8, by: '周检' },
    { c: 12, code: 'CUTT-2004', pos: '4#', type: '边刮刀' as const, d: 350, zone: '二工区' as const, date: '2026-09-04', ring: 'R-203', reading: 28, by: '周检' },
  ]

  const cutters = raw.map((r) => ({
    id: r.c,
    code: r.code,
    position: r.pos,
    type: r.type,
    initialDiameter: r.d,
    zone: r.zone,
    createdAt: seededAt,
  }))

  // 历史检查按 v1 登记，加载时迁移到 v2 重算。
  const inspections = raw.map((r, i) => ({
    id: i + 1,
    cutterId: r.c,
    inspectDate: r.date,
    ringNo: r.ring,
    rawReading: r.reading,
    wear: r.reading,
    wearVersion: 1,
    wearLimit: 0,
    exceed: 0,
    suggested: false,
    closed: false,
    inspector: r.by,
    createdAt: seededAt,
  }))

  return {
    meta: { wearVersion: 1, seededAt },
    seq: { cutter: cutters.length, inspection: inspections.length, replacement: 0 },
    cutters,
    inspections,
    replacements: [],
  }
}
