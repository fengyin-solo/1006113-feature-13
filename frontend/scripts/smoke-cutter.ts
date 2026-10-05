// 处置线逻辑冒烟测试：用 esbuild 打包到 CJS 后在 node 里跑。
const mem = new Map<string, string>()
globalThis.window = {
  localStorage: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  },
} as unknown as Window & typeof globalThis

let pass = 0
let fail = 0
function assert(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++
  } else {
    fail++
    console.error(`✗ ${name} ${extra}`)
  }
}

import {
  changeCutterType,
  confirmReplacement,
  cutterStats,
  listCutterRows,
  listPendingCutters,
  loadDomain,
  pendingCountByRing,
  registerInspection,
  resetCutterData,
  scheduleReplacement,
} from '../src/data/cutter/service'
import { inspectionsOf, openReplacementOf } from '../src/data/cutter/service'
import type { Operator } from '../src/data/cutter/types'

const mech1: Operator = { name: '马建国', role: '机械员', zone: '一工区' }
const insp1: Operator = { name: '周检', role: '检查员', zone: '一工区' }
const mech2: Operator = { name: '郑海峰', role: '机械员', zone: '二工区' }

resetCutterData()

// 1. 存量按 v2 重算：读数 52 -> 磨损 26，限值 20，超 6；读数 8 -> 磨损 4 正常
const domain = loadDomain()
const c2 = listCutterRows().find((r) => r.cutter.id === 2)!
assert('v2重算 52/2=26 超6', c2.currentWear === 26 && c2.exceed === 6, JSON.stringify({ w: c2.currentWear, e: c2.exceed }))
const c7 = listCutterRows().find((r) => r.cutter.id === 7)!
assert('v2重算 8/2=4 正常', c7.currentWear === 4 && c7.status === '正常', c7.status)
assert('迁移版本号=2', domain.meta.wearVersion === 2)

// 2. 存量补录：每刀至多一条待确认单，6 个超标刀（2,3,5,6,10,12）
assert('待销项处置单共6条', listPendingCutters().length === 6, String(listPendingCutters().length))
const rep2 = openReplacementOf(domain, 2)!
assert('处置单锁定位置/类型', rep2.lockedPosition === '2#' && rep2.lockedType === '滚刀')
assert('刀2状态=更换中', c2.status === '更换中')

// 3. 环次回写只有一个数：R-102 有 2 把（刀2滚刀、刀3切刀），两处入口同源
const ringMap = pendingCountByRing()
assert('R-102待换刀数=2', ringMap.get('R-102') === 2, String(ringMap.get('R-102')))
assert('两入口清单同长度', listPendingCutters().length === [...ringMap.values()].reduce((a, b) => a + b, 0))

// 4. 跨工区操作拦回（二工区机械员动一工区刀）
const cross = confirmReplacement({ replacementId: rep2.id, finishDate: '2026-09-10', operator: mech2 })
assert('跨工区销项拦回', !cross.ok && cross.message.includes('跨工区'))

// 5. 检查员越权销项（更换日期仅机械员）
const deny = confirmReplacement({ replacementId: rep2.id, finishDate: '2026-09-10', operator: insp1 })
assert('检查员销项拒绝', !deny.ok && deny.message.includes('机械员'))

// 6. 正常销项：清旧标记、刀回正常、累计更换+1、环次清单减1
const beforeCount = cutterStats().replacedTotal
const ok = confirmReplacement({ replacementId: rep2.id, finishDate: '2026-09-10', operator: mech1 })
assert('机械员本工区销项成功', ok.ok, ok.message)
const c2after = listCutterRows().find((r) => r.cutter.id === 2)!
assert('销项后刀2=正常', c2after.status === '正常' && c2after.currentWear === 0)
const ins2 = inspectionsOf(loadDomain(), 2)
assert('旧待更换标记已清(无在册suggested)', ins2.every((i) => !(i.suggested && !i.closed)))
assert('累计更换+1', cutterStats().replacedTotal === beforeCount + 1)
assert('待销项清单变5条', listPendingCutters().length === 5)
assert('R-102剩1把', pendingCountByRing().get('R-102') === 1)

// 7. 重复销项只记一次
const again = confirmReplacement({ replacementId: rep2.id, finishDate: '2026-09-11', operator: mech1 })
assert('重复销项幂等', again.ok && again.deduped === true && cutterStats().replacedTotal === beforeCount + 1)

// 8. 同刀连着安排两次只一条
// 刀7 当前正常磨损4，先登记一次超限检查
const r1 = registerInspection({ cutterId: 7, inspectDate: '2026-10-01', ringNo: 'R-105', rawReading: 60, operator: insp1 })
assert('登记超限 60/2=30>20', r1.ok && r1.message.includes('待更换'), r1.message)
const c7wait = listCutterRows().find((r) => r.cutter.id === 7)!
assert('刀7转待更换', c7wait.status === '待更换' && c7wait.exceed === 10)
const s1 = scheduleReplacement({ cutterId: 7, ringNo: '', operator: mech1 })
const s2 = scheduleReplacement({ cutterId: 7, ringNo: '', operator: mech1 })
assert('重复安排不新增', s1.ok && s2.ok && s2.deduped === true)
assert('刀7待确认单仅1条', loadDomain().replacements.filter((x) => x.cutterId === 7 && x.status === '待确认').length === 1)
assert('更换中不能再登记检查', !registerInspection({ cutterId: 7, inspectDate: '2026-10-02', ringNo: 'R-106', rawReading: 10, operator: insp1 }).ok)

// 9. 同刀同日重复登记只留最早
const c9 = listCutterRows().find((r) => r.cutter.id === 9)! // 二工区 磨损6 正常
const d1 = registerInspection({ cutterId: 9, inspectDate: '2026-10-03', ringNo: 'R-210', rawReading: 20, operator: { name: '吴量', role: '检查员', zone: '二工区' } })
const d2 = registerInspection({ cutterId: 9, inspectDate: '2026-10-03', ringNo: 'R-210', rawReading: 40, operator: { name: '吴量', role: '检查员', zone: '二工区' } })
assert('同日重复登记幂等', d1.ok && d2.ok && d2.deduped === true)
const sameDay = inspectionsOf(loadDomain(), 9).filter((i) => i.inspectDate === '2026-10-03')
assert('只留最早那条(读数20->磨损10)', sameDay.length === 1 && sameDay[0].rawReading === 20 && sameDay[0].wear === 10)

// 10. 跨工区登记检查拦回
assert('跨工区检查拦回', !registerInspection({ cutterId: 9, inspectDate: '2026-10-04', ringNo: 'R-211', rawReading: 2, operator: insp1 }).ok)

// 11. 未超限不能安排更换（顺序校验）；刀1 磨损7 正常
assert('未超限不能安排更换', !scheduleReplacement({ cutterId: 1, ringNo: '', operator: mech1 }).ok)
// 无检查的新刀……（存量刀都有检查）

// 12. 更换中类型锁定：本工区机械员也不能改
const c10 = listCutterRows().find((r) => r.cutter.id === 10)!
assert('刀10更换中', c10.status === '更换中')
const lockType = changeCutterType(10, '切刀', mech2)
assert('锁定中改类型拒绝', !lockType.ok && lockType.message.includes('锁定'), lockType.message)

// 13. 检查人角色也可安排更换（本工区），跨工区仍拦回
assert('检查员本工区可安排(刀7已安排过→幂等)', scheduleReplacement({ cutterId: 7, ringNo: '', operator: insp1 }).deduped === true)
assert('跨工区安排拦回', !scheduleReplacement({ cutterId: 12, ringNo: '', operator: mech1 }).ok)

// 14. 未销项期间每刀一条待处置（全局不变量）
const openByCutter = new Map<number, number>()
for (const p of listPendingCutters()) openByCutter.set(p.cutterId, (openByCutter.get(p.cutterId) ?? 0) + 1)
assert('每把刀待确认单≤1', [...openByCutter.values()].every((n) => n === 1))

// 15. 两入口排序一致（scheduledAt,id）
const pending = listPendingCutters()
const sorted = [...pending].sort((a, b) => (a.scheduledAt === b.scheduledAt ? a.replacementId - b.replacementId : a.scheduledAt.localeCompare(b.scheduledAt)))
assert('清单按固定顺序', pending.every((p, i) => p.replacementId === sorted[i].replacementId))

// 16. 新检查覆盖旧待更换标记但不产生两条：刀1 先超限再复检正常
const o1 = registerInspection({ cutterId: 1, inspectDate: '2026-10-02', ringNo: 'R-110', rawReading: 60, operator: insp1 })
assert('刀1超限登记', o1.ok && listCutterRows().find((r) => r.cutter.id === 1)!.status === '待更换')
const o2 = registerInspection({ cutterId: 1, inspectDate: '2026-10-03', ringNo: 'R-110', rawReading: 2, operator: insp1 })
assert('复检正常旧标记被销', o2.ok && listCutterRows().find((r) => r.cutter.id === 1)!.status === '正常')
assert('刀1没有待确认单', !openReplacementOf(loadDomain(), 1))

// 17. 销项当天即可再登记新检查，按新读数重新判定，历史记录不残留成两条
const sameDayNew = registerInspection({ cutterId: 2, inspectDate: '2026-09-10', ringNo: 'R-104', rawReading: 2, operator: insp1 })
assert('销项当日新检查可登记', sameDayNew.ok, sameDayNew.message)
const c2new = listCutterRows().find((r) => r.cutter.id === 2)!
assert('销项当日新读数 1mm 判正常', c2new.status === '正常' && c2new.currentWear === 1, `${c2new.status}/${c2new.currentWear}`)
assert('刀2历史检查保留且在册仅1条', inspectionsOf(loadDomain(), 2).filter((i) => !i.closed).length === 1)

console.log(`\n${fail === 0 ? '全部通过' : '有用例失败'}：通过 ${pass}，失败 ${fail}`)
if (fail > 0) process.exit(1)
