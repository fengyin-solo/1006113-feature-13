import type { CutterType } from './types'

/**
 * 磨损算法版本（由项目方拍板，当前执行 v2）。
 * v1：检查员直接按实测直径减少量填报磨损读数。
 * v2：径向磨损 = 直径减少量 ÷ 2（新刀与旧刀在同一直径基准下可比），保留 1 位小数。
 * 算法升级后，已登记读数一律按新版本重算。
 */
export const CURRENT_WEAR_VERSION = 2

export const WEAR_LIMIT_MM: Record<CutterType, number> = {
  滚刀: 20,
  切刀: 12,
  边刮刀: 10,
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 按算法版本把原始读数换算成当前磨损量 */
export function calcWear(rawReading: number, version: number = CURRENT_WEAR_VERSION): number {
  if (version <= 1) {
    return round1(rawReading)
  }
  return round1(rawReading / 2)
}

export function limitOf(type: CutterType): number {
  return WEAR_LIMIT_MM[type]
}

export function roundWear(wear: number): number {
  return round1(wear)
}

/** 超出限值多少；未超限返回 0 */
export function exceedOf(wear: number, limit: number): number {
  return round1(Math.max(0, wear - limit))
}

/** 登记检查后按当前磨损量超出多少判定待更换：超出即待更换 */
export function shouldReplace(wear: number, limit: number): boolean {
  return wear > limit
}
