// 刀具处置线的结构化数据：检查 → 安排更换 → 确认销项，全部围绕这三张表走。

// 刀具台账：一把刀一行，是检查、更换两条记录的主档。
export type Cutter = {
  id: number
  code: string // 刀具编号
  zone: string // 所属工区
  position: string // 刀盘位置（安排更换时锁定，不允许再改）
  type: string // 刀具类型（仅本工区机械员可改）
  initialDiameter: number // 初始直径 mm
  status: '正常' | '待更换' | '已更换' | '已报废'
  registeredAt: string // 登记日期
}

// 检查记录：检查人填当前磨损量，超不超限在这里判定。
export type Inspection = {
  id: number
  cutterId: number
  inspectedAt: string // 检查日期
  inspector: string // 检查人员
  initialDiameter: number // 登记检查时的口径快照
  measuredDiameter: number // 实测直径（原始输入）
  wear: number // 当前磨损量（按现行算法重算后的值）
  algoVersion: number // 磨损量按哪一版算
  overLimit: boolean // 按当前磨损量是否超限
  conclusion: '正常' | '待更换'
  closed: boolean // 销项后旧检查标记闭环，不许残留待更换
}

// 更换记录：同一把刀在换刀未确认期间只保留一条。
export type Replacement = {
  id: number
  cutterId: number
  ringNo: string // 回写到掘进环次待换刀具清单的环号
  positionLocked: string // 锁定刀盘位置
  typeLocked: string // 锁定刀具类型
  plannedAt: string // 安排日期
  plannedBy: string
  replaceDate: string // 更换日期（仅本工区机械员可改）
  confirmedAt: string // 销项日期，空串表示换刀未确认
  confirmedBy: string
  status: '待换刀' | '已销项'
}

export type CutterDomainState = {
  schemaVersion: number
  wearAlgoVersion: number
  cutters: Cutter[]
  inspections: Inspection[]
  replacements: Replacement[]
}

export type DisposalRow = {
  replacement: Replacement
  cutter: Cutter
  inspection: Inspection | null
  wear: number
}

// 环次侧回写结果：只保留一份清单与一个数字。
export type RingPendingWriteback = {
  ringNo: string
  count: number
  items: string[] // 刀具编号清单
}

export const CUTTER_SCHEMA_VERSION = 2
