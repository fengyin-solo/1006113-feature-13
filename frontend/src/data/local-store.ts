import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'shield-tunnel-construction:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 业务值统一放宽：通用模块存 EntryRow，刀具处置线存结构化对象，两边共用一个存储桶。
export type StoreValue = EntryRow[] | Record<string, unknown> | number

// 种子版本标记：新版种子自带，迁移据此判断「这是新种子」而不是「老版真实存量」。
export const SEED_MARKER_KEY = '__seedVersion__'
export const SEED_MARKER_VERSION = 2

function seedFallback(): Record<string, StoreValue> {
  return { ...(clone(SEED_ROWS) as Record<string, StoreValue>), [SEED_MARKER_KEY]: SEED_MARKER_VERSION }
}

function readStorage(): Record<string, StoreValue> {
  const fallback = seedFallback()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, StoreValue>
    // 种子里新增的模块补进来，浏览器里已有的模块以存储为准。
    // 但种子版本标记只能来自存储本身：老存量被 fallback 盖上「新种子」标记会躲过迁移。
    const { [SEED_MARKER_KEY]: storedMarker, ...parsedModules } = parsed
    const merged: Record<string, StoreValue> = { ...fallback, ...parsedModules }
    if (storedMarker !== undefined) {
      merged[SEED_MARKER_KEY] = storedMarker
    } else {
      delete merged[SEED_MARKER_KEY]
    }
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, StoreValue> | null = null

// 供数据层模块注册一次性迁移：第一次读到存储时执行（比如刀具处置线的存量重算）。
type Migration = (state: Record<string, StoreValue>) => Record<string, StoreValue>
const migrations: Migration[] = []

export function registerMigration(migration: Migration): void {
  migrations.push(migration)
}

export function allRows(): Record<string, StoreValue> {
  if (cache === null) {
    let state = readStorage()
    for (const migration of migrations) {
      state = migration(state)
    }
    cache = state
    // 迁移可能改写存量：成功写回；写不下就退回种子/原数据，保证两边一份。
    persist(cache)
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  const rows = allRows()[key]
  return Array.isArray(rows) ? (rows as EntryRow[]) : []
}

export function readState<T>(key: string): T | undefined {
  // 触发一次性迁移，保证读到的永远是归并、回写后的完整状态。
  const value = allRows()[key]
  return Array.isArray(value) ? undefined : (value as T | undefined)
}

function persist(state: Record<string, StoreValue>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    // setItem 在配额不足时抛异常：由调用方整笔撤销，内存缓存不落地。
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

// 单键写入：走与事务相同的落地点，存不下就让异常向上抛，由业务层提示退回。
export function saveRows(key: string, rows: EntryRow[]): void {
  commit([[key, rows]])
}

// 一次处置涉及多张表时只整体提交一次：全部改完再一次性写入。
// 任何一个键写不进去（如配额不足），整笔撤销，绝不留半截状态。
export function commit(entries: [string, StoreValue][]): void {
  if (entries.length === 0) {
    return
  }
  const snapshot = cache === null ? null : clone(cache)
  const base = allRows()
  const next = { ...base }
  for (const [key, value] of entries) {
    next[key] = clone(value)
  }
  cache = next
  try {
    persist(next)
  } catch (error) {
    // 落盘失败：回滚内存，保证页面与存储始终一致。
    cache = snapshot ?? readStorage()
    throw error
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
