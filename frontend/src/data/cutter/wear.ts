// 刀具磨损量算法：只有这一处算数，检查登记、存量重算、页面展示全走这里。
// 历史版本保留只为迁移存量；登记新检查一律按当前版本算。

export const WEAR_ALGO_VERSION = 2

// 当前磨损量达到该阈值（毫米）即判定待更换。
export const WEAR_LIMIT_MM = 25

export type WearInput = {
  // 初始直径 / 实测直径，单位毫米。
  initialDiameter: number
  measuredDiameter: number
}

export function wearByVersion(version: number, input: WearInput): number {
  const diff = round2(input.initialDiameter - input.measuredDiameter)
  if (version <= 1) {
    // v1：把直径减少量直接当成磨损量（口径偏大，已弃用）。
    return Math.max(0, diff)
  }
  // v2（现行）：径向磨损 = 直径减少量 / 2。
  return Math.max(0, round2(diff / 2))
}

// 当前版本的磨损量：已登记的旧值改算法后也用它重算。
export function calcWear(input: WearInput): number {
  return wearByVersion(WEAR_ALGO_VERSION, input)
}

export function isOverLimit(wear: number): boolean {
  return wear >= WEAR_LIMIT_MM
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const text = value.trim()
    if (text === '') {
      return null
    }
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}
