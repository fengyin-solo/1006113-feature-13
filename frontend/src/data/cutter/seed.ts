import type { CutterDomainState } from './types'
import { WEAR_ALGO_VERSION } from './wear'

// 刀具处置线存量：按刀盘位置照旧补录。
// 初始直径统一按 17 寸滚刀 432mm；当前磨损量全部按现行算法（v2，径向磨损）计算。
//   CUTT-0001 检查超限未安排 → 待更换
//   CUTT-0002/0003 检查超限已安排未确认 → 一条处置线挂在 R-108
//   CUTT-0004 已确认销项（R-105）
//   CUTT-0005 正常
//   CUTT-0006 已报废
//   CUTT-0009 二工区超限待更换，用于跨工区拦截演示
export function buildCutterSeed(): CutterDomainState {
  const cutters = [
    { id: 1, code: 'CUTT-0001', zone: '一工区', position: 'P01-中心刀', type: '中心滚刀', initialDiameter: 432, status: '待更换' as const, registeredAt: '2026-09-01' },
    { id: 2, code: 'CUTT-0002', zone: '一工区', position: 'P12-正面刀', type: '正面滚刀', initialDiameter: 432, status: '待更换' as const, registeredAt: '2026-09-01' },
    { id: 3, code: 'CUTT-0003', zone: '一工区', position: 'P24-边缘刀', type: '边缘滚刀', initialDiameter: 432, status: '待更换' as const, registeredAt: '2026-09-01' },
    { id: 4, code: 'CUTT-0004', zone: '一工区', position: 'P06-正面刀', type: '正面滚刀', initialDiameter: 432, status: '已更换' as const, registeredAt: '2026-09-01' },
    { id: 5, code: 'CUTT-0005', zone: '一工区', position: 'P18-正面刀', type: '正面滚刀', initialDiameter: 432, status: '正常' as const, registeredAt: '2026-09-05' },
    { id: 6, code: 'CUTT-0006', zone: '一工区', position: 'P30-边缘刀', type: '边缘滚刀', initialDiameter: 432, status: '已报废' as const, registeredAt: '2026-09-02' },
    { id: 7, code: 'CUTT-0007', zone: '二工区', position: 'P03-中心刀', type: '中心滚刀', initialDiameter: 432, status: '正常' as const, registeredAt: '2026-09-03' },
    { id: 8, code: 'CUTT-0008', zone: '二工区', position: 'P15-正面刀', type: '正面滚刀', initialDiameter: 432, status: '正常' as const, registeredAt: '2026-09-03' },
    { id: 9, code: 'CUTT-0009', zone: '二工区', position: 'P27-边缘刀', type: '边缘滚刀', initialDiameter: 432, status: '待更换' as const, registeredAt: '2026-09-04' },
  ]

  // 检查记录：实测直径 → 径向磨损 (432-实测)/2。
  const inspections = [
    // CUTT-0001：实测 378 → 磨损 27，超限待更换，未闭环
    { id: 1, cutterId: 1, inspectedAt: '2026-10-02', inspector: '王机械', initialDiameter: 432, measuredDiameter: 378, wear: 27, overLimit: true, conclusion: '待更换' as const, closed: false },
    // CUTT-0002：实测 372 → 30 超限，旧检查随销项前仍挂着（安排未确认，保持待处置）
    { id: 2, cutterId: 2, inspectedAt: '2026-10-02', inspector: '王机械', initialDiameter: 432, measuredDiameter: 372, wear: 30, overLimit: true, conclusion: '待更换' as const, closed: false },
    // CUTT-0003：实测 380.4 → 25.8 超限
    { id: 3, cutterId: 3, inspectedAt: '2026-10-03', inspector: '李检查', initialDiameter: 432, measuredDiameter: 380.4, wear: 25.8, overLimit: true, conclusion: '待更换' as const, closed: false },
    // CUTT-0004：超限检查 → 已销项闭环
    { id: 4, cutterId: 4, inspectedAt: '2026-09-26', inspector: '王机械', initialDiameter: 432, measuredDiameter: 376, wear: 28, overLimit: true, conclusion: '待更换' as const, closed: true },
    // CUTT-0005：实测 418 → 7 正常
    { id: 5, cutterId: 5, inspectedAt: '2026-10-03', inspector: '李检查', initialDiameter: 432, measuredDiameter: 418, wear: 7, overLimit: false, conclusion: '正常' as const, closed: false },
    // CUTT-0006：超限后报废，检查闭环
    { id: 6, cutterId: 6, inspectedAt: '2026-09-28', inspector: '王机械', initialDiameter: 432, measuredDiameter: 360, wear: 36, overLimit: true, conclusion: '待更换' as const, closed: true },
    { id: 7, cutterId: 7, inspectedAt: '2026-10-03', inspector: '赵机械', initialDiameter: 432, measuredDiameter: 424, wear: 4, overLimit: false, conclusion: '正常' as const, closed: false },
    { id: 8, cutterId: 8, inspectedAt: '2026-10-03', inspector: '赵机械', initialDiameter: 432, measuredDiameter: 421, wear: 5.5, overLimit: false, conclusion: '正常' as const, closed: false },
    // CUTT-0009：实测 380 → 26 超限（二工区）
    { id: 9, cutterId: 9, inspectedAt: '2026-10-04', inspector: '赵机械', initialDiameter: 432, measuredDiameter: 380, wear: 26, overLimit: true, conclusion: '待更换' as const, closed: false },
  ].map((item) => ({ ...item, algoVersion: WEAR_ALGO_VERSION }))

  const replacements = [
    // CUTT-0002、CUTT-0003：已安排、未确认 → R-108 的待换刀数就是 2，只有一个来源
    {
      id: 1, cutterId: 2, ringNo: 'R-108', positionLocked: 'P12-正面刀', typeLocked: '正面滚刀',
      plannedAt: '2026-10-03', plannedBy: '王机械', replaceDate: '2026-10-05',
      confirmedAt: '', confirmedBy: '', status: '待换刀' as const,
    },
    {
      id: 2, cutterId: 3, ringNo: 'R-108', positionLocked: 'P24-边缘刀', typeLocked: '边缘滚刀',
      plannedAt: '2026-10-03', plannedBy: '王机械', replaceDate: '2026-10-05',
      confirmedAt: '', confirmedBy: '', status: '待换刀' as const,
    },
    // CUTT-0004：R-105 已销项
    {
      id: 3, cutterId: 4, ringNo: 'R-105', positionLocked: 'P06-正面刀', typeLocked: '正面滚刀',
      plannedAt: '2026-09-27', plannedBy: '王机械', replaceDate: '2026-09-28',
      confirmedAt: '2026-09-28', confirmedBy: '王机械', status: '已销项' as const,
    },
  ]

  return {
    schemaVersion: 2,
    wearAlgoVersion: WEAR_ALGO_VERSION,
    cutters,
    inspections,
    replacements,
  }
}
