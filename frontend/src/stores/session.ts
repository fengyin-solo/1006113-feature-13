import { defineStore } from 'pinia'

import type { Operator, Role, Zone } from '@/data/cutter/types'

const NAMES: Record<Role, Record<Zone, string>> = {
  机械员: { 一工区: '马建国', 二工区: '郑海峰' },
  检查员: { 一工区: '周检', 二工区: '吴量' },
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '马建国' as string,
    role: '机械员' as Role,
    zone: '一工区' as Zone,
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    operatorProfile(state): Operator {
      return { name: state.operator, role: state.role, zone: state.zone }
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    // 切换当前处置身份：跨工区操作在服务层一律拦回
    setIdentity(role: Role, zone: Zone) {
      this.role = role
      this.zone = zone
      this.operator = NAMES[role][zone]
    },
  },
})
