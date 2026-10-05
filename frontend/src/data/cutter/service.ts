import { commit, loadDomain, resetDomain } from './store'
export { loadDomain } from './store'
import { calcWear, exceedOf, limitOf, shouldReplace } from './policy'
import type {
  ConfirmInput,
  Cutter,
  CutterDomain,
  CutterViewRow,
  DisposalResult,
  Inspection,
  InspectionInput,
  Operator,
  PendingCutterItem,
  Replacement,
  ScheduleInput,
} from './types'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowIso(): string {
  return new Date().toISOString()
}

function fail(message: string): DisposalResult {
  return { ok: false, message }
}

function guardZone(cutter: Cutter, operator: Operator): string | null {
  if (cutter.zone !== operator.zone) {
    return `跨工区操作一律拦回：${cutter.zone}的刀具不能由${operator.zone}处置`
  }
  return null
}

function guardMechanic(operator: Operator): string | null {
  if (operator.role !== '机械员') {
    return '越权操作一律拒绝：只有本工区机械员可改刀具类型与更换日期'
  }
  return null
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime())
}

export function getCutter(domain: CutterDomain, cutterId: number): Cutter | undefined {
  return domain.cutters.find((item) => item.id === cutterId)
}

export function inspectionsOf(domain: CutterDomain, cutterId: number): Inspection[] {
  return domain.inspections
    .filter((item) => item.cutterId === cutterId)
    .sort((a, b) => (a.inspectDate === b.inspectDate ? b.id - a.id : b.inspectDate.localeCompare(a.inspectDate)))
}

export function replacementsOf(domain: CutterDomain, cutterId: number): Replacement[] {
  return domain.replacements
    .filter((item) => item.cutterId === cutterId)
    .sort((a, b) => b.id - a.id)
}

export function openReplacementOf(domain: CutterDomain, cutterId: number): Replacement | undefined {
  return domain.replacements.find((item) => item.cutterId === cutterId && item.status === '待确认')
}

/** 最近一次销项之后的在册检查：已关账（closed）的历史检查不再驱动当前状态 */
function activeInspection(domain: CutterDomain, cutter: Cutter): Inspection | undefined {
  return domain.inspections
    .filter((item) => item.cutterId === cutter.id && !item.closed)
    .sort((a, b) => (a.inspectDate === b.inspectDate ? b.id - a.id : b.inspectDate.localeCompare(a.inspectDate)))[0]
}

/** 列表与详情面板共用的唯一派生口径 */
export function deriveRow(domain: CutterDomain, cutter: Cutter): CutterViewRow {
  const openReplacement = openReplacementOf(domain, cutter.id)
  const inspection = activeInspection(domain, cutter)
  const wear = inspection?.wear ?? 0
  const limit = limitOf(cutter.type)
  let status: CutterViewRow['status'] = '正常'
  if (cutter.scrapped) {
    status = '已报废'
  } else if (openReplacement) {
    status = '更换中'
  } else if (inspection?.suggested) {
    status = '待更换'
  }
  return {
    cutter,
    status,
    currentWear: wear,
    wearLimit: limit,
    exceed: exceedOf(wear, limit),
    openReplacement,
    latestInspection: inspectionsOf(domain, cutter.id)[0],
  }
}

export function listCutterRows(domain: CutterDomain = loadDomain()): CutterViewRow[] {
  return [...domain.cutters]
    .sort((a, b) => (a.zone === b.zone ? a.position.localeCompare(b.position, 'zh-Hans-CN', { numeric: true }) : a.zone.localeCompare(b.zone)))
    .map((cutter) => deriveRow(domain, cutter))
}

/**
 * 更换结论回写掘进环次的待换刀具清单：只从「待确认」处置单汇总。
 * 刀具页与环次页都调它，环次读到的待换刀数只有一个数。
 * 按安排时间、处置单编号固定排序，两处入口看到的顺序与条数完全一致。
 */
export function listPendingCutters(domain: CutterDomain = loadDomain()): PendingCutterItem[] {
  return domain.replacements
    .filter((item) => item.status === '待确认')
    .sort((a, b) => (a.scheduledAt === b.scheduledAt ? a.id - b.id : a.scheduledAt.localeCompare(b.scheduledAt)))
    .map((item) => {
      const cutter = getCutter(domain, item.cutterId)!
      const inspection = domain.inspections.find((ins) => ins.id === item.triggerInspectionId)
      return {
        ringNo: item.ringNo,
        replacementId: item.id,
        cutterId: cutter.id,
        cutterCode: cutter.code,
        zone: cutter.zone,
        position: item.lockedPosition,
        type: item.lockedType,
        wear: inspection?.wear ?? 0,
        exceed: inspection?.exceed ?? 0,
        scheduledAt: item.scheduledAt,
        scheduledBy: item.scheduledBy,
      }
    })
}

export function pendingCountByRing(domain: CutterDomain = loadDomain()): Map<string, number> {
  const result = new Map<string, number>()
  for (const item of listPendingCutters(domain)) {
    result.set(item.ringNo, (result.get(item.ringNo) ?? 0) + 1)
  }
  return result
}

export function ringPendingCount(ringNo: string, domain: CutterDomain = loadDomain()): number {
  return listPendingCutters(domain).filter((item) => item.ringNo === ringNo).length
}

export interface CutterStats {
  normal: number
  waiting: number
  replacing: number
  replacedTotal: number
  scrapped: number
}

export function cutterStats(domain: CutterDomain = loadDomain()): CutterStats {
  const rows = listCutterRows(domain)
  return {
    normal: rows.filter((row) => row.status === '正常').length,
    waiting: rows.filter((row) => row.status === '待更换').length,
    replacing: rows.filter((row) => row.status === '更换中').length,
    replacedTotal: domain.replacements.filter((item) => item.status === '已销项').length,
    scrapped: rows.filter((row) => row.status === '已报废').length,
  }
}

/** 事务执行：先在副本上按顺序校验全部规则，通过才整笔提交；存不下就整体撤销。 */
function transact(mutate: (draft: CutterDomain) => DisposalResult): DisposalResult {
  const draft = clone(loadDomain())
  const result = mutate(draft)
  if (!result.ok) {
    return result
  }
  try {
    commit(draft)
  } catch {
    return fail('写不进去，整笔退回，原有处置线未改动')
  }
  return result
}

/** 第一步：登记检查，按当前磨损量超出多少判定待更换 */
export function registerInspection(input: InspectionInput): DisposalResult {
  return transact((draft) => {
    const cutter = getCutter(draft, input.cutterId)
    if (!cutter) {
      return fail(`没有找到编号为 ${input.cutterId} 的刀具`)
    }
    const zoneError = guardZone(cutter, input.operator)
    if (zoneError) {
      return fail(zoneError)
    }
    if (cutter.scrapped) {
      return fail('已报废刀具不能再登记检查')
    }
    if (!input.inspectDate || !validDate(input.inspectDate)) {
      return fail('检查日期不合法')
    }
    if (!input.ringNo.trim()) {
      return fail('请填写检查时所在掘进环次')
    }
    if (!Number.isFinite(input.rawReading) || input.rawReading < 0) {
      return fail('磨损读数必须是不小于 0 的数字')
    }
    if (openReplacementOf(draft, cutter.id)) {
      return fail('该刀具换刀尚未确认，同一把刀只保留一条待处置记录')
    }

    // 幂等：同一把刀同一检查日期重复递，只记最早那条，不新增。
    const duplicate = draft.inspections
      .filter((item) => item.cutterId === cutter.id && item.inspectDate === input.inspectDate)
      .sort((a, b) => a.id - b.id)[0]
    if (duplicate) {
      return { ok: true, message: '同一条检查重复登记，只保留最早那条', deduped: true, inspection: duplicate }
    }

    // 新一轮检查覆盖旧的待更换标记：无处置单挂着的旧超标记先关账，避免列表残留两条。
    for (const old of draft.inspections) {
      if (old.cutterId === cutter.id && old.suggested && !old.closed) {
        old.closed = true
      }
    }

    const limit = limitOf(cutter.type)
    const wear = calcWear(input.rawReading)
    const exceed = exceedOf(wear, limit)
    const suggested = shouldReplace(wear, limit)
    const id = ++draft.seq.inspection
    const inspection: Inspection = {
      id,
      cutterId: cutter.id,
      inspectDate: input.inspectDate,
      ringNo: input.ringNo.trim(),
      rawReading: input.rawReading,
      wear,
      wearVersion: draft.meta.wearVersion,
      wearLimit: limit,
      exceed,
      suggested,
      closed: false,
      inspector: input.operator.name,
      createdAt: nowIso(),
    }
    draft.inspections.push(inspection)
    return {
      ok: true,
      message: suggested
        ? `检查已登记：当前磨损 ${wear}mm，超限 ${exceed}mm，判定待更换`
        : `检查已登记：当前磨损 ${wear}mm，未超限（限值 ${limit}mm）`,
      inspection,
    }
  })
}

/** 第二步：安排更换，锁定刀盘位置与刀具类型，同一把刀未确认期间只此一条 */
export function scheduleReplacement(input: ScheduleInput): DisposalResult {
  return transact((draft) => {
    const cutter = getCutter(draft, input.cutterId)
    if (!cutter) {
      return fail(`没有找到编号为 ${input.cutterId} 的刀具`)
    }
    const zoneError = guardZone(cutter, input.operator)
    if (zoneError) {
      return fail(zoneError)
    }
    if (cutter.scrapped) {
      return fail('已报废刀具不能安排更换')
    }

    // 幂等：连着安排两次，不重复立单，返回已有的待确认处置单。
    const existing = openReplacementOf(draft, cutter.id)
    if (existing) {
      return { ok: true, message: '该刀具已有一条待确认更换记录，不重复立单', deduped: true, replacement: existing }
    }

    const inspection = activeInspection(draft, cutter)
    if (!inspection) {
      return fail('请先登记检查，磨损量超限后才能安排更换')
    }
    if (!inspection.suggested) {
      return fail(`当前磨损 ${inspection.wear}mm 未超限值 ${inspection.wearLimit}mm，不能安排更换`)
    }

    const id = ++draft.seq.replacement
    const replacement: Replacement = {
      id,
      cutterId: cutter.id,
      ringNo: inspection.ringNo,
      // 锁的是安排这一刻的刀盘位置与刀具类型，之后改台账不影响本单。
      lockedPosition: cutter.position,
      lockedType: cutter.type,
      triggerInspectionId: inspection.id,
      status: '待确认',
      scheduledAt: nowIso(),
      scheduledBy: input.operator.name,
      finishedAt: '',
      finishedBy: '',
    }
    draft.replacements.push(replacement)
    return { ok: true, message: `已安排 ${cutter.position}（${cutter.type}）更换，位置与类型已锁定`, replacement }
  })
}

/** 第三步：换完确认销项，旧标记清干净，更换日期只认本工区机械员 */
export function confirmReplacement(input: ConfirmInput): DisposalResult {
  return transact((draft) => {
    const replacement = draft.replacements.find((item) => item.id === input.replacementId)
    if (!replacement) {
      return fail(`没有找到编号为 ${input.replacementId} 的处置单`)
    }
    const cutter = getCutter(draft, replacement.cutterId)!
    const zoneError = guardZone(cutter, input.operator)
    if (zoneError) {
      return fail(zoneError)
    }
    const roleError = guardMechanic(input.operator)
    if (roleError) {
      return fail(roleError)
    }
    if (replacement.status === '已销项') {
      return { ok: true, message: '该处置单已销项，重复确认只记一次', deduped: true, replacement }
    }
    if (!input.finishDate || !validDate(input.finishDate)) {
      return fail('更换日期不合法')
    }
    const trigger = draft.inspections.find((item) => item.id === replacement.triggerInspectionId)
    if (trigger && input.finishDate < trigger.inspectDate) {
      return fail('更换日期不能早于触发更换的检查日期')
    }

    replacement.status = '已销项'
    replacement.finishedAt = input.finishDate
    replacement.finishedBy = input.operator.name

    // 销项必须把旧标记清掉：触发检查之前（含）该刀的在册检查整批关账，
    // 列表只剩新检查结论，详情里仍保留历史判定（标记列显示「已清」）。
    for (const inspection of draft.inspections) {
      if (
        inspection.cutterId === cutter.id &&
        !inspection.closed &&
        trigger &&
        (inspection.id === trigger.id || inspection.inspectDate <= trigger.inspectDate)
      ) {
        inspection.closed = true
      }
    }
    return { ok: true, message: `已确认销项：${cutter.position} 于 ${input.finishDate} 换刀完成，旧待更换标记已清除`, replacement }
  })
}

/** 改刀具类型：本工区机械员；处置单未确认期间位置与类型锁定 */
export function changeCutterType(cutterId: number, nextType: Cutter['type'], operator: Operator): DisposalResult {
  return transact((draft) => {
    const cutter = getCutter(draft, cutterId)
    if (!cutter) {
      return fail(`没有找到编号为 ${cutterId} 的刀具`)
    }
    const zoneError = guardZone(cutter, operator)
    if (zoneError) {
      return fail(zoneError)
    }
    const roleError = guardMechanic(operator)
    if (roleError) {
      return fail(roleError)
    }
    if (openReplacementOf(draft, cutterId)) {
      return fail('该刀具换刀未确认，刀盘位置与刀具类型已锁定，不能修改')
    }
    if (!['滚刀', '切刀', '边刮刀'].includes(nextType)) {
      return fail('刀具类型不合法')
    }
    cutter.type = nextType
    return { ok: true, message: `刀具类型已改为「${nextType}」，下次检查按新类型限值 ${limitOf(nextType)}mm 判定` }
  })
}

/** 更正更换日期（含销项当日填写）：仅本工区机械员 */
export function correctFinishDate(replacementId: number, finishDate: string, operator: Operator): DisposalResult {
  return transact((draft) => {
    const replacement = draft.replacements.find((item) => item.id === replacementId)
    if (!replacement) {
      return fail(`没有找到编号为 ${replacementId} 的处置单`)
    }
    const cutter = getCutter(draft, replacement.cutterId)!
    const zoneError = guardZone(cutter, operator)
    if (zoneError) {
      return fail(zoneError)
    }
    const roleError = guardMechanic(operator)
    if (roleError) {
      return fail(roleError)
    }
    if (replacement.status !== '已销项') {
      return fail('更换日期在换完销项时填写')
    }
    if (!validDate(finishDate)) {
      return fail('更换日期不合法')
    }
    replacement.finishedAt = finishDate
    return { ok: true, message: '更换日期已更正' }
  })
}

/** 报废刀具：同工区可操作；更换中必须先销项，保证处置线按顺序走 */
export function scrapCutter(cutterId: number, operator: Operator): DisposalResult {
  return transact((draft) => {
    const cutter = getCutter(draft, cutterId)
    if (!cutter) {
      return fail(`没有找到编号为 ${cutterId} 的刀具`)
    }
    const zoneError = guardZone(cutter, operator)
    if (zoneError) {
      return fail(zoneError)
    }
    if (cutter.scrapped) {
      return fail('该刀具已报废')
    }
    if (openReplacementOf(draft, cutterId)) {
      return fail('该刀具更换尚未确认，请先完成销项再报废')
    }
    cutter.scrapped = true
    return { ok: true, message: `${cutter.position} 已报废` }
  })
}

export function resetCutterData(): void {
  resetDomain()
}
