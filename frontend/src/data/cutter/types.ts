/** 刀具处置线领域模型：刀具台账、检查记录、更换处置单三类数据串成一条线。 */

export type Role = '机械员' | '检查员'
export type Zone = '一工区' | '二工区'
export type CutterType = '滚刀' | '切刀' | '边刮刀'
export type CutterStatus = '正常' | '待更换' | '更换中' | '已报废'
export type ReplacementStatus = '待确认' | '已销项'

export interface Operator {
  name: string
  role: Role
  zone: Zone
}

export interface Cutter {
  id: number
  /** 刀具编号 */
  code: string
  /** 刀盘位置，工区内唯一，安排更换时锁定 */
  position: string
  type: CutterType
  /** 初始直径 mm */
  initialDiameter: number
  zone: Zone
  createdAt: string
  /** 已报废刀具锁定，不再参与检查与更换 */
  scrapped?: boolean
}

export interface Inspection {
  id: number
  cutterId: number
  /** 检查日期 */
  inspectDate: string
  /** 检查时所在掘进环次 */
  ringNo: string
  /** 原始读数：实测直径减少量 mm（v1 口径原样保留） */
  rawReading: number
  /** 当前磨损量 mm：按现行磨损算法由 rawReading 重算 */
  wear: number
  /** 该磨损量按哪一版算法计算 */
  wearVersion: number
  /** 磨损限值 mm（按刀具类型快照） */
  wearLimit: number
  /** 超出限值多少 mm */
  exceed: number
  /** 登记时判定是否待更换 */
  suggested: boolean
  /** 待更换旧标记是否已被销项清除 */
  closed: boolean
  inspector: string
  createdAt: string
}

export interface Replacement {
  id: number
  cutterId: number
  /** 安排更换时对应的掘进环次，回写环次待换刀具清单的唯一依据 */
  ringNo: string
  /** 安排时锁定的刀盘位置快照 */
  lockedPosition: string
  /** 安排时锁定的刀具类型快照 */
  lockedType: CutterType
  /** 触发本处置单的检查记录 */
  triggerInspectionId: number
  status: ReplacementStatus
  scheduledAt: string
  scheduledBy: string
  /** 更换日期：仅本工区机械员在销项时可定 */
  finishedAt: string
  finishedBy: string
}

export interface CutterDomain {
  meta: { wearVersion: number; seededAt: string }
  seq: { cutter: number; inspection: number; replacement: number }
  cutters: Cutter[]
  inspections: Inspection[]
  replacements: Replacement[]
}

/** 检查登记入参 */
export interface InspectionInput {
  cutterId: number
  inspectDate: string
  ringNo: string
  /** 实测直径减少量 mm */
  rawReading: number
  operator: Operator
}

/** 安排更换入参 */
export interface ScheduleInput {
  cutterId: number
  ringNo: string
  operator: Operator
}

/** 销项入参 */
export interface ConfirmInput {
  replacementId: number
  /** 更换日期 */
  finishDate: string
  operator: Operator
}

export interface DisposalResult {
  ok: boolean
  message: string
  /** 命中幂等：同一条重复递，只保留/返回最早那一笔 */
  deduped?: boolean
  inspection?: Inspection
  replacement?: Replacement
}

/** 列表行：由单一事实源派生，列表与详情共用，不允许两边对不上 */
export interface CutterViewRow {
  cutter: Cutter
  status: CutterStatus
  /** 当前磨损量：新刀（已销项且其后无检查）为 0 */
  currentWear: number
  wearLimit: number
  exceed: number
  openReplacement?: Replacement
  latestInspection?: Inspection
}

/** 回写到掘进环次的待换刀具清单项，两个入口只读这一份 */
export interface PendingCutterItem {
  ringNo: string
  replacementId: number
  cutterId: number
  cutterCode: string
  zone: Zone
  position: string
  type: CutterType
  wear: number
  exceed: number
  scheduledAt: string
  scheduledBy: string
}
