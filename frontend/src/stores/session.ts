import { defineStore } from 'pinia'

export type OperatorRole = '机械员' | '安全员' | '值班管理员'

export const OPERATOR_ZONES = ['一工区', '二工区'] as const

// 当前登录人：刀具处置线要按「角色 + 工区」判权限——
// 只有本工区的机械员能改刀具类型与更换日期，跨工区操作一律拦回。
export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '王机械',
    role: '机械员' as OperatorRole,
    zone: '一工区' as string,
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isMechanic: (state) => state.role === '机械员',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(payload: { operator: string; role: OperatorRole; zone: string }) {
      this.operator = payload.operator
      this.role = payload.role
      this.zone = payload.zone
    },
  },
})
