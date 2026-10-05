import { commit, listRows, readState, registerMigration, SEED_MARKER_KEY, SEED_MARKER_VERSION } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import type { OperatorRole } from '@/stores/session'
import { buildCutterSeed } from './seed'
import type {
  Cutter,
  CutterDomainState,
  DisposalRow,
  Inspection,
  Replacement,
  RingPendingWriteback,
} from './types'
import { CUTTER_SCHEMA_VERSION } from './types'
import {
  calcWear,
  isOverLimit,
  parseNumber,
  round2,
  WEAR_ALGO_VERSION,
  WEAR_LIMIT_MM,
} from './wear'

// 刀具处置线独立成域，和通用模块共用一个 localStorage 存储桶，
// 以便「刀具 + 环次回写」在同一次事务里整体提交。
const STATE_KEY = '__cutterDomain__'
const RING_KEY = 'ring'
const RING_PENDING_FIELD = '待换刀具清单'
const RING_COUNT_FIELD = '待换刀具数'

export type Actor = {
  name: string
  role: OperatorRole
  zone: string
}

// ---------------------------------------------------------------------------
// 读取
// ---------------------------------------------------------------------------

export function getState(): CutterDomainState {
  // readState 会触发一次性迁移，首次读取即得到归并、回写后的完整状态。
  const state = readState<CutterDomainState>(STATE_KEY)
  if (!state) {
    return buildCutterSeed()
  }
  return state
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
}

export function listCutters(): Cutter[] {
  return getState().cutters
}

export function listInspections(): Inspection[] {
  return getState().inspections
}

export function listReplacements(): Replacement[] {
  return getState().replacements
}

export function getCutter(id: number): Cutter | null {
  return getState().cutters.find((item) => item.id === id) ?? null
}

export function latestInspection(cutterId: number): Inspection | null {
  const list = getState().inspections
    .filter((item) => item.cutterId === cutterId)
    .sort((a, b) => a.id - b.id)
  return list.length ? list[list.length - 1] : null
}

export function openReplacementOf(cutterId: number): Replacement | null {
  return getState().replacements.find(
    (item) => item.cutterId === cutterId && item.status === '待换刀',
  ) ?? null
}

// 处置线列表：一条未确认更换对应一行，检查、台账在同一处对上，列表与详情不会再分叉。
export function listDisposals(): DisposalRow[] {
  const state = getState()
  return state.replacements
    .filter((item) => item.status === '待换刀')
    .map((replacement) => {
      const cutter = state.cutters.find((item) => item.id === replacement.cutterId)
      const inspection = latestInspection(replacement.cutterId)
      return {
        replacement,
        cutter: cutter as Cutter,
        inspection,
        wear: inspection?.wear ?? 0,
      }
    })
}

// 环次侧读到的待换刀清单：只从「未确认更换记录」这一个来源派生。
// 任何入口想知道待换刀数，都调这里，不允许再各存一个数字。
export function ringPendingWritebacks(): RingPendingWriteback[] {
  return writebacksFrom(getState())
}

// 处置条数：刀具入口与掘进环次入口读的是同一个数。
export function pendingDisposalCount(): number {
  return getState().replacements.filter((item) => item.status === '待换刀').length
}

export function stats() {
  const state = getState()
  return {
    total: state.cutters.length,
    normal: state.cutters.filter((item) => item.status === '正常').length,
    waiting: state.cutters.filter((item) => item.status === '待更换').length,
    replaced: state.replacements.filter((item) => item.status === '已销项').length,
    disposal: state.replacements.filter((item) => item.status === '待换刀').length,
    scrapped: state.cutters.filter((item) => item.status === '已报废').length,
  }
}

// 给通用概览用的口径：刀具总量按台账算，待处理按未确认更换算（两入口同一个数）。
export function overviewCounts(): { created: number; pending: number; abnormal: number } {
  const s = stats()
  return { created: s.total, pending: s.disposal, abnormal: 0 }
}

// ---------------------------------------------------------------------------
// 权限：只有本工区机械员能改刀具类型与更换日期；跨工区一律拦回
// ---------------------------------------------------------------------------

function guardZone(actor: Actor, zone: string): void {
  if (actor.zone !== zone) {
    throw new Error(`跨工区操作被拦回：该刀具属${zone}，当前账号属${actor.zone}`)
  }
}

function guardMechanic(actor: Actor, zone: string): void {
  guardZone(actor, zone)
  if (actor.role !== '机械员') {
    throw new Error(`仅本工区机械员可操作（当前角色：${actor.role}）`)
  }
}

// ---------------------------------------------------------------------------
// 一致性校验：提交前按住顺序过一遍，任何一条不满足整笔退回
// ---------------------------------------------------------------------------

function assertSortedIds(rows: { id: number }[], label: string): void {
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].id <= rows[i - 1].id) {
      throw new Error(`${label}编号顺序校验失败，整笔退回`)
    }
  }
}

function assertConsistent(state: CutterDomainState): void {
  // 同一把刀具在换刀未确认期间只保留一条待处置记录。
  const seen = new Set<number>()
  for (const replacement of state.replacements.filter((item) => item.status === '待换刀')) {
    if (seen.has(replacement.cutterId)) {
      throw new Error(`刀具 ${replacement.cutterId} 存在重复待处置记录，整笔退回`)
    }
    seen.add(replacement.cutterId)
  }

  for (const cutter of state.cutters) {
    const open = state.replacements.some(
      (item) => item.cutterId === cutter.id && item.status === '待换刀',
    )
    const inspection = [...state.inspections]
      .filter((item) => item.cutterId === cutter.id)
      .sort((a, b) => b.id - a.id)[0]
    const openOverLimit = Boolean(inspection?.overLimit && !inspection?.closed)

    if (cutter.status === '待更换') {
      // 待更换标记只允许挂在「未确认更换」或「未闭环的超限检查」上；销项后必须清干净。
      if (!open && !openOverLimit) {
        throw new Error(`刀具 ${cutter.code} 残留待更换标记，整笔退回`)
      }
    } else if (cutter.status === '已更换' || cutter.status === '已报废') {
      if (open) {
        throw new Error(`刀具 ${cutter.code} 已闭环却仍挂待处置记录，整笔退回`)
      }
      // 销项/报废必须把超限旧检查闭环，旧标记不许残留。
      if (openOverLimit) {
        throw new Error(`刀具 ${cutter.code} 的超限检查记录未闭环，整笔退回`)
      }
    } else if (cutter.status === '正常') {
      // 挂着未确认更换时，刀具必须处于待更换处置态；未闭环超限检查同理不能标正常。
      if (open || openOverLimit) {
        throw new Error(`刀具 ${cutter.code} 有未闭环处置却标成正常，整笔退回`)
      }
    }
  }

  assertSortedIds(state.cutters, '刀具台账')
  assertSortedIds(state.inspections, '检查记录')
  assertSortedIds(state.replacements, '更换记录')
}

// ---------------------------------------------------------------------------
// 环次回写：把更换结论写回掘进环次的待换刀具清单，环次那边只有一个数
// ---------------------------------------------------------------------------

function writebacksFrom(draft: CutterDomainState): RingPendingWriteback[] {
  const groups = new Map<string, string[]>()
  for (const replacement of draft.replacements.filter((item) => item.status === '待换刀')) {
    const cutter = draft.cutters.find((item) => item.id === replacement.cutterId)
    if (!cutter) {
      continue
    }
    const bucket = groups.get(replacement.ringNo) ?? []
    bucket.push(cutter.code)
    groups.set(replacement.ringNo, bucket)
  }
  return [...groups.entries()]
    .map(([ringNo, codes]) => ({ ringNo, count: codes.length, items: codes.slice().sort() }))
    .sort((a, b) => a.ringNo.localeCompare(b.ringNo, 'zh-Hans-CN', { numeric: true }))
}

function applyRingWriteback(draft: CutterDomainState): EntryRow[] {
  // 直接用草稿里的处置线派生清单，保证与刀具入口、掘进环次入口读到的是同一份。
  const byRing = new Map(writebacksFrom(draft).map((item) => [item.ringNo, item]))
  const rings = listRows(RING_KEY).map((ring) => {
    const hit = byRing.get(String(ring['环号'] ?? ''))
    return {
      ...ring,
      [RING_PENDING_FIELD]: hit ? hit.items.join('、') : '',
      [RING_COUNT_FIELD]: hit ? hit.count : 0,
    }
  })

  // 顺序再校验一遍：回写后的环次编号顺序必须一致。
  const numericIds = rings.map((ring) => Number(ring.id))
  for (let i = 1; i < numericIds.length; i += 1) {
    if (numericIds[i] <= numericIds[i - 1]) {
      throw new Error('掘进环次顺序校验失败，整笔退回')
    }
  }
  return rings
}

// 唯一提交口：先改内存草稿、跑完全部校验，再连同环次回写一次性落盘。
// 存不下（配额异常）由 commit 回滚内存并向上抛 → 整笔撤销。
function commitState(draft: CutterDomainState): void {
  assertConsistent(draft)
  const rings = applyRingWriteback(draft)
  const stamped: CutterDomainState = {
    ...draft,
    schemaVersion: CUTTER_SCHEMA_VERSION,
    wearAlgoVersion: WEAR_ALGO_VERSION,
  }
  // 最后再用回写结果交叉验证：两处入口的处置条数必须一致（安排更换已限定必须回写到已建档环次）。
  const openCount = stamped.replacements.filter((item) => item.status === '待换刀').length
  const storedSum = rings.reduce(
    (sum, ring) => sum + (Number(ring[RING_COUNT_FIELD]) || 0),
    0,
  )
  if (openCount !== storedSum) {
    throw new Error(`刀具入口处置 ${openCount} 条与环次入口 ${storedSum} 条对不上，整笔退回`)
  }
  commit([
    [STATE_KEY, stamped as unknown as Record<string, unknown>],
    [RING_KEY, rings],
  ])
}

// ---------------------------------------------------------------------------
// 处置线动作：登记检查 → 安排更换 → 确认销项（先后顺序由服务端兜底）
// ---------------------------------------------------------------------------

export function registerCutter(input: {
  actor: Actor
  code: string
  zone: string
  position: string
  type: string
  initialDiameter: number
  registeredAt: string
}): { ok: true; message: string; id: number } {
  const { actor, code, zone, position, type, initialDiameter, registeredAt } = input
  guardMechanic(actor, zone)
  if (!code.trim() || !position.trim() || !type.trim()) {
    throw new Error('刀具编号、刀盘位置、刀具类型都不能为空')
  }
  if (!Number.isFinite(initialDiameter) || initialDiameter <= 0) {
    throw new Error('初始直径必须是正数')
  }

  const state = getState()
  // 重复登记只保留最早那条：同工区同刀盘位置已存在 → 拒绝后补的。
  const duplicate = state.cutters.find(
    (item) => item.zone === zone && item.position === position,
  )
  if (duplicate) {
    throw new Error(`刀盘位置 ${position} 已登记刀具 ${duplicate.code}，重复登记只保留最早一条`)
  }

  const cutter: Cutter = {
    id: nextId(state.cutters),
    code: code.trim(),
    zone,
    position: position.trim(),
    type: type.trim(),
    initialDiameter: round2(initialDiameter),
    status: '正常',
    registeredAt,
  }
  commitState({ ...state, cutters: [...state.cutters, cutter] })
  return { ok: true, message: `刀具 ${cutter.code} 已按刀盘位置 ${cutter.position} 登记`, id: cutter.id }
}

export function registerInspection(input: {
  actor: Actor
  cutterId: number
  inspectedAt: string
  measuredDiameter: number
}): { ok: true; message: string } {
  const { actor, cutterId, inspectedAt, measuredDiameter } = input
  const state = getState()
  const cutter = state.cutters.find((item) => item.id === cutterId)
  if (!cutter) {
    throw new Error('没有找到这把刀具')
  }
  guardZone(actor, cutter.zone)
  if (!Number.isFinite(measuredDiameter) || measuredDiameter <= 0) {
    throw new Error('请填写有效的实测直径')
  }
  if (cutter.status === '已报废') {
    throw new Error('已报废刀具不再登记检查')
  }
  if (openReplacementOf(cutterId)) {
    throw new Error('该刀具已有一条换刀未确认的待处置记录，不能重复登记，请先销项')
  }

  // 同一条检查（同刀 + 同日 + 同实测值）重复递两次只记一次：
  // 命中完全相同的入参 → 幂等返回，不新增。
  const duplicate = state.inspections.find(
    (item) =>
      item.cutterId === cutterId &&
      item.inspectedAt === inspectedAt &&
      round2(item.measuredDiameter) === round2(measuredDiameter),
  )
  if (duplicate) {
    return { ok: true, message: '该检查已登记过，未重复记账' }
  }

  const wear = calcWear({
    initialDiameter: cutter.initialDiameter,
    measuredDiameter: round2(measuredDiameter),
  })
  const over = isOverLimit(wear)
  const inspection: Inspection = {
    id: nextId(state.inspections),
    cutterId,
    inspectedAt,
    inspector: actor.name,
    initialDiameter: cutter.initialDiameter,
    measuredDiameter: round2(measuredDiameter),
    wear,
    algoVersion: WEAR_ALGO_VERSION,
    overLimit: over,
    conclusion: over ? '待更换' : '正常',
    closed: false,
  }

  // 登记检查后按当前磨损量超出多少判定：
  // 最新结论为准——超限且没有未确认更换 → 待更换；正常且没有挂着的处置 → 清掉旧标记回到正常。
  const cutters = state.cutters.map((item) => {
    if (item.id !== cutterId) {
      return item
    }
    const stillScheduled = state.replacements.some(
      (rep) => rep.cutterId === cutterId && rep.status === '待换刀',
    )
    const status: Cutter['status'] = over || stillScheduled ? '待更换' : '正常'
    return { ...item, status }
  })

  commitState({ ...state, cutters, inspections: [...state.inspections, inspection] })
  return {
    ok: true,
    message: over
      ? `检查已登记，当前磨损量 ${wear}mm 已达 ${WEAR_LIMIT_MM}mm 限值，判定待更换`
      : `检查已登记，当前磨损量 ${wear}mm，未超限`,
  }
}

export function scheduleReplacement(input: {
  actor: Actor
  cutterId: number
  ringNo: string
  replaceDate: string
  plannedAt: string
}): { ok: true; message: string } {
  const { actor, cutterId, ringNo, replaceDate, plannedAt } = input
  const state = getState()
  const cutter = state.cutters.find((item) => item.id === cutterId)
  if (!cutter) {
    throw new Error('没有找到这把刀具')
  }
  guardMechanic(actor, cutter.zone)
  if (!ringNo.trim()) {
    throw new Error('请选择回写的掘进环次')
  }
  // 环次必须已建档：回写得找得到落点，两个入口的数才能始终对得上。
  if (!listRows(RING_KEY).some((ring) => String(ring['环号'] ?? '') === ringNo.trim())) {
    throw new Error(`掘进环次 ${ringNo} 尚未建档，无法回写待换刀清单`)
  }
  if (!replaceDate.trim()) {
    throw new Error('请填写更换日期')
  }
  if (cutter.status === '已报废') {
    throw new Error('已报废刀具不能安排更换')
  }

  // 同一把刀连着安排两次：未确认期间只保留一条待处置记录，多的这条不收。
  const existing = state.replacements.find(
    (item) => item.cutterId === cutterId && item.status === '待换刀',
  )
  if (existing) {
    throw new Error(`该刀具已有一条待处置记录（${existing.ringNo}），未确认前不得重复安排`)
  }

  const inspection = latestInspection(cutterId)
  if (!inspection || !inspection.overLimit) {
    throw new Error('处置顺序：先登记超限检查、判定待更换后，才能安排更换')
  }

  const replacement: Replacement = {
    id: nextId(state.replacements),
    cutterId,
    ringNo: ringNo.trim(),
    // 安排更换时锁定刀盘位置与刀具类型：之后改台账也不影响这条处置。
    positionLocked: cutter.position,
    typeLocked: cutter.type,
    plannedAt,
    plannedBy: actor.name,
    replaceDate,
    confirmedAt: '',
    confirmedBy: '',
    status: '待换刀',
  }
  const cutters = state.cutters.map((item) =>
    item.id === cutterId ? { ...item, status: '待更换' as const } : item,
  )
  commitState({ ...state, cutters, replacements: [...state.replacements, replacement] })
  return {
    ok: true,
    message: `已为 ${cutter.code} 安排更换并锁定 ${cutter.position} / ${cutter.type}，回写至 ${replacement.ringNo}`,
  }
}

export function confirmReplacement(input: {
  actor: Actor
  replacementId: number
  confirmedAt: string
}): { ok: true; message: string } {
  const { actor, replacementId, confirmedAt } = input
  const state = getState()
  const replacement = state.replacements.find((item) => item.id === replacementId)
  if (!replacement) {
    throw new Error('没有找到这条更换记录')
  }
  const cutter = state.cutters.find((item) => item.id === replacement.cutterId)
  if (!cutter) {
    throw new Error('更换记录对应的刀具不存在')
  }
  guardZone(actor, cutter.zone)
  if (replacement.status !== '待换刀') {
    // 销项也幂等：同一条重复确认只算一次。
    return { ok: true, message: '该更换已销项，未重复记账' }
  }

  // 换完确认销项：旧的待更换标记必须清掉，检查记录里的旧标记一并闭环，不许残留。
  const cutters = state.cutters.map((item) =>
    item.id === cutter.id ? { ...item, status: '已更换' as const } : item,
  )
  const inspections = state.inspections.map((item) =>
    item.cutterId === cutter.id && item.overLimit && !item.closed
      ? { ...item, closed: true, conclusion: '待更换' as const }
      : item,
  )
  const replacements = state.replacements.map((item) =>
    item.id === replacement.id
      ? { ...item, status: '已销项' as const, confirmedAt, confirmedBy: actor.name }
      : item,
  )
  commitState({ ...state, cutters, inspections, replacements })
  return {
    ok: true,
    message: `${cutter.code} 已确认销项，待更换旧标记已清除，${replacement.ringNo} 待换刀清单已更新`,
  }
}

export function scrapCutter(input: { actor: Actor; cutterId: number }): { ok: true; message: string } {
  const { actor, cutterId } = input
  const state = getState()
  const cutter = state.cutters.find((item) => item.id === cutterId)
  if (!cutter) {
    throw new Error('没有找到这把刀具')
  }
  guardZone(actor, cutter.zone)
  if (openReplacementOf(cutterId)) {
    throw new Error('该刀具换刀尚未确认，请先销项再报废')
  }
  const cutters = state.cutters.map((item) =>
    item.id === cutterId ? { ...item, status: '已报废' as const } : item,
  )
  const inspections = state.inspections.map((item) =>
    item.cutterId === cutterId && item.overLimit && !item.closed ? { ...item, closed: true } : item,
  )
  commitState({ ...state, cutters, inspections })
  return { ok: true, message: `${cutter.code} 已报废` }
}

// 改刀具类型：仅本工区机械员；已锁定的更换快照不动。
export function editCutterType(input: {
  actor: Actor
  cutterId: number
  type: string
}): { ok: true; message: string } {
  const { actor, cutterId, type } = input
  const state = getState()
  const cutter = state.cutters.find((item) => item.id === cutterId)
  if (!cutter) {
    throw new Error('没有找到这把刀具')
  }
  guardMechanic(actor, cutter.zone)
  if (!type.trim()) {
    throw new Error('刀具类型不能为空')
  }
  const cutters = state.cutters.map((item) =>
    item.id === cutterId ? { ...item, type: type.trim() } : item,
  )
  commitState({ ...state, cutters })
  return { ok: true, message: `${cutter.code} 刀具类型已改为「${type.trim()}」` }
}

// 改更换日期：仅本工区机械员，只允许改未确认的那一条。
export function editReplaceDate(input: {
  actor: Actor
  replacementId: number
  replaceDate: string
}): { ok: true; message: string } {
  const { actor, replacementId, replaceDate } = input
  const state = getState()
  const replacement = state.replacements.find((item) => item.id === replacementId)
  if (!replacement) {
    throw new Error('没有找到这条更换记录')
  }
  const cutter = state.cutters.find((item) => item.id === replacement.cutterId)
  if (!cutter) {
    throw new Error('更换记录对应的刀具不存在')
  }
  guardMechanic(actor, cutter.zone)
  if (replacement.status !== '待换刀') {
    throw new Error('已销项的更换记录不能改日期')
  }
  if (!replaceDate.trim()) {
    throw new Error('更换日期不能为空')
  }
  const replacements = state.replacements.map((item) =>
    item.id === replacementId ? { ...item, replaceDate } : item,
  )
  commitState({ ...state, replacements })
  return { ok: true, message: `更换日期已改为 ${replaceDate}` }
}

export function resetDomain(): void {
  // 重置刀具处置线：种子落库后立刻按同一份更换记录回写环次，只提交一次。
  commitState(buildCutterSeed())
}

// ---------------------------------------------------------------------------
// 存量迁移：换磨损算法后，已登记的磨损量照新算法重算；存量刀具按刀盘位置补录
// ---------------------------------------------------------------------------

function looksLikeDummyLegacy(cutterRows: EntryRow[]): boolean {
  // 初始化脚手架里的样例行：刀盘位置/类型都是「刀具磨损样例N」占位串。
  return cutterRows.some(
    (row) =>
      typeof row['刀盘位置'] === 'string' && String(row['刀盘位置']).includes('刀具磨损样例'),
  )
}

function migrateLegacy(cutterRows: EntryRow[]): CutterDomainState {
  // 真实存量：刀盘位置照旧保留，磨损量全部按现行算法重算。
  const cutters: Cutter[] = []
  const seenPosition = new Set<string>()
  for (const row of cutterRows) {
    const zone = String(row['工区'] ?? '一工区')
    const position = String(row['刀盘位置'] ?? `P${row.id}`)
    const dedupeKey = `${zone}::${position}`
    // 存量里同一位置重复的只留最早（id 最小）那条。
    if (seenPosition.has(dedupeKey)) {
      continue
    }
    seenPosition.add(dedupeKey)
    const initial = parseNumber(row['初始直径']) ?? 432
    const statusValue = String(row.status ?? '正常')
    cutters.push({
      id: Number(row.id),
      code: String(row['刀具编号'] ?? `CUTT-${String(row.id).padStart(4, '0')}`),
      zone,
      position,
      type: String(row['刀具类型'] ?? '正面滚刀'),
      initialDiameter: initial,
      status: ['正常', '待更换', '已更换', '已报废'].includes(statusValue)
        ? (statusValue as Cutter['status'])
        : '正常',
      registeredAt: String(row['更换日期'] ?? '2026-09-01'),
    })
  }
  cutters.sort((a, b) => a.id - b.id)

  // 已登记的磨损量照新算法重算：旧值若是数字，反推实测直径 = 初始直径 - 旧v1磨损，再按 v2 折算。
  const legacyById = new Map(cutterRows.map((row) => [Number(row.id), row]))
  const inspections: Inspection[] = cutters.map((cutter) => {
    const legacy = legacyById.get(cutter.id)
    const legacyWear = parseNumber(legacy?.['当前磨损量'])
    const measured =
      legacyWear === null
        ? cutter.initialDiameter
        : round2(cutter.initialDiameter - legacyWear)
    const wear = calcWear({
      initialDiameter: cutter.initialDiameter,
      measuredDiameter: measured,
    })
    const over = isOverLimit(wear)
    const closed = cutter.status === '已更换' || cutter.status === '已报废'
    return {
      id: cutter.id,
      cutterId: cutter.id,
      inspectedAt: String(legacy?.['更换日期'] ?? cutter.registeredAt),
      inspector: String(legacy?.['检查人员'] ?? '存量补录'),
      initialDiameter: cutter.initialDiameter,
      measuredDiameter: measured,
      wear,
      algoVersion: WEAR_ALGO_VERSION,
      overLimit: over,
      conclusion: over ? '待更换' : '正常',
      closed,
    }
  })

  return {
    schemaVersion: CUTTER_SCHEMA_VERSION,
    wearAlgoVersion: WEAR_ALGO_VERSION,
    cutters,
    inspections,
    // 通用表时代没有结构化更换记录，存量迁移从空处置线起步，避免凭空多出更换。
    replacements: [],
  }
}

// 磨损算法改版后：已登记的磨损量照新算法重算，结论与刀具状态跟着重落。
// 处置线（更换记录）原样保留——它锁定的是刀盘位置与刀具类型，与算法无关。
function recalcDomain(state: CutterDomainState): CutterDomainState {
  const cutters = state.cutters.map((cutter) => {
    const latest = state.inspections
      .filter((item) => item.cutterId === cutter.id)
      .sort((a, b) => b.id - a.id)[0]
    if (!latest || cutter.status === '已报废') {
      return cutter
    }
    const hasOpen = state.replacements.some(
      (item) => item.cutterId === cutter.id && item.status === '待换刀',
    )
    if (hasOpen || cutter.status === '已更换') {
      return cutter
    }
    return { ...cutter, status: (latest.overLimit && !latest.closed ? '待更换' : '正常') as Cutter['status'] }
  })

  const inspections = state.inspections.map((item) => {
    const wear = calcWear({
      initialDiameter: item.initialDiameter,
      measuredDiameter: item.measuredDiameter,
    })
    const over = isOverLimit(wear)
    return {
      ...item,
      wear,
      algoVersion: WEAR_ALGO_VERSION,
      overLimit: over,
      // 闭环的旧检查不再翻结论；未闭环的按新算法结果重判。
      conclusion: item.closed ? item.conclusion : (over ? '待更换' : '正常'),
    }
  })

  return {
    schemaVersion: CUTTER_SCHEMA_VERSION,
    wearAlgoVersion: WEAR_ALGO_VERSION,
    cutters,
    inspections,
    replacements: state.replacements,
  }
}

// 模块加载即注册：第一次读存储时把存量归并到处置线，并把环次清单回写成一份。
registerMigration((storeState) => {
  const existing = storeState[STATE_KEY] as CutterDomainState | undefined

  // 区分两种「没有处置线」的存储：
  //  - 新版种子（带版本标记）：刀具表本就是按刀盘位置补录的种子，直接建处置线即可；
  //  - 老版真实存量（无标记、有通用刀具表）：刀盘位置照旧迁移、磨损按现行算法重算；
  //  - 老版占位样例：无业务含义，直接换新种子。
  const isFreshSeed = storeState[SEED_MARKER_KEY] === SEED_MARKER_VERSION
  const legacyCutterRows =
    existing === undefined && !isFreshSeed && Array.isArray(storeState['cutter'])
      ? (storeState['cutter'] as EntryRow[])
      : []
  const hasDummyLegacy = looksLikeDummyLegacy(legacyCutterRows)

  let domain: CutterDomainState
  if (!existing) {
    if (isFreshSeed || hasDummyLegacy) {
      domain = buildCutterSeed()
    } else {
      domain = migrateLegacy(legacyCutterRows)
    }
  } else if (
    existing.schemaVersion !== CUTTER_SCHEMA_VERSION ||
    existing.wearAlgoVersion !== WEAR_ALGO_VERSION
  ) {
    // 算法改版：已登记的磨损量照新算法重算，状态随超限结论重新落位。
    domain = recalcDomain(existing)
  } else {
    domain = existing
  }

  // 环次回写始终重算：两个入口永远只留一份数。
  const groups = new Map<string, string[]>()
  for (const replacement of domain.replacements.filter((item) => item.status === '待换刀')) {
    const cutter = domain.cutters.find((item) => item.id === replacement.cutterId)
    if (!cutter) {
      continue
    }
    const bucket = groups.get(replacement.ringNo) ?? []
    bucket.push(cutter.code)
    groups.set(replacement.ringNo, bucket)
  }
  const rings = (storeState[RING_KEY] as EntryRow[] | undefined) ?? []
  const nextRings = rings.map((ring) => {
    const codes = groups.get(String(ring['环号'] ?? ''))
    return {
      ...ring,
      [RING_PENDING_FIELD]: codes ? codes.slice().sort().join('、') : '',
      [RING_COUNT_FIELD]: codes ? codes.length : 0,
    }
  })

  // 旧的通用刀具表已被处置线取代：只要处置线建立，就把通用表摘掉，两个入口只留一份。
  const { cutter: _legacyCutter, ...rest } = storeState as Record<string, unknown>
  void _legacyCutter
  return {
    ...rest,
    [STATE_KEY]: domain as unknown as Record<string, unknown>,
    [RING_KEY]: nextRings,
  }
})

export const CUTTER_FIELDS = {
  ringPending: RING_PENDING_FIELD,
  ringCount: RING_COUNT_FIELD,
}
