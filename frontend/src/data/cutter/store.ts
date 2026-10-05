import { buildCutterSeed } from './seed'
import {
  CURRENT_WEAR_VERSION,
  calcWear,
  exceedOf,
  limitOf,
  shouldReplace,
} from './policy'
import type { CutterDomain, Inspection, Replacement } from './types'

// 刀具处置线单独存一份，与通用台账存储互不干扰；两侧入口都只读这一份。
const STORAGE_KEY = 'shield-tunnel-construction:cutter-disposal:v2'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 已登记检查按现行磨损算法重算：限值取刀具类型，超出多少决定待更换 */
function recomputeInspections(domain: CutterDomain): void {
  const cutterType = new Map(domain.cutters.map((c) => [c.id, c.type]))
  for (const ins of domain.inspections) {
    const type = cutterType.get(ins.cutterId)
    if (!type) continue
    const limit = limitOf(type)
    const wear = calcWear(ins.rawReading, CURRENT_WEAR_VERSION)
    ins.wear = wear
    ins.wearLimit = limit
    ins.exceed = exceedOf(wear, limit)
    ins.suggested = shouldReplace(wear, limit)
    ins.wearVersion = CURRENT_WEAR_VERSION
  }
}

/**
 * 存量补录：刀具按刀盘位置照旧（种子里已按 1#、2#… 排好）。
 * 超标但未销项的检查，每把刀只补一条待确认处置单；同刀更早的超标记检查并入该单（清旧标记）。
 */
function backfillOpenReplacements(domain: CutterDomain): void {
  const byCutter = new Map<number, Inspection[]>()
  for (const ins of domain.inspections) {
    if (!ins.suggested) {
      ins.closed = false
      continue
    }
    const list = byCutter.get(ins.cutterId) ?? []
    list.push(ins)
    byCutter.set(ins.cutterId, list)
  }

  for (const [cutterId, list] of byCutter) {
    const ordered = [...list].sort((a, b) =>
      a.inspectDate === b.inspectDate ? a.id - b.id : a.inspectDate.localeCompare(b.inspectDate),
    )
    const latest = ordered[ordered.length - 1]
    const cutter = domain.cutters.find((c) => c.id === cutterId)
    if (!cutter) continue
    for (const ins of ordered) {
      ins.closed = ins.id !== latest.id
    }
    const existing = domain.replacements.find(
      (r) => r.cutterId === cutterId && r.status === '待确认' && r.triggerInspectionId === latest.id,
    )
    if (existing) continue
    const id = ++domain.seq.replacement
    const record: Replacement = {
      id,
      cutterId,
      ringNo: latest.ringNo,
      lockedPosition: cutter.position,
      lockedType: cutter.type,
      triggerInspectionId: latest.id,
      status: '待确认',
      scheduledAt: latest.createdAt,
      scheduledBy: latest.inspector,
      finishedAt: '',
      finishedBy: '',
    }
    domain.replacements.push(record)
  }
}

/** 迁移：换算法后把存量读数整批改算，再补待处置单 */
function migrate(domain: CutterDomain): CutterDomain {
  if (domain.meta.wearVersion < CURRENT_WEAR_VERSION) {
    recomputeInspections(domain)
    backfillOpenReplacements(domain)
    domain.meta.wearVersion = CURRENT_WEAR_VERSION
  }
  return domain
}

function readStorage(): CutterDomain {
  const fallback = migrate(buildCutterSeed())
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return migrate(JSON.parse(raw) as CutterDomain)
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: CutterDomain | null = null

export function loadDomain(): CutterDomain {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

/**
 * 事务提交：调用方先在副本上完成全部校验与变更，只在最后调用一次 commit。
 * localStorage 抛错（存不下）时整笔退回：缓存不动，并把异常抛给调用方。
 */
export function commit(domain: CutterDomain): void {
  const serialized = JSON.stringify(domain)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, serialized)
  }
  cache = domain
}

export function resetDomain(): CutterDomain {
  const fresh = migrate(buildCutterSeed())
  commit(fresh)
  return fresh
}
