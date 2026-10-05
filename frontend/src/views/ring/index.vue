<template>
  <section class="page" data-module="ring">
    <header class="page-head">
      <div>
        <h2>掘进环次管理</h2>
        <p class="page-desc">
          维护掘进环，围绕环号、起始里程、掘进速度、总推力做登记、筛选与状态流转。
          待换刀具清单由刀具处置线回写，本页与刀具磨损页同读一份，不会出现两个数。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记掘进环</button>
        <button class="btn" type="button" @click="exportRows">导出掘进环次清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待换刀具总数（待销项）</span>
        <strong class="stat-value">{{ pendingItems.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">涉及环次</span>
        <strong class="stat-value">{{ ringGroups.length }}</strong>
      </article>
      <article class="stat-card" v-for="item in stats.slice(2)" :key="item.label">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>待换刀数</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td :class="{ 'cell-warn': pendingOf(String(row['环号'])) > 0 }">{{ pendingOf(String(row['环号'])) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无掘进环次数据，可先登记掘进环</td>
        </tr>
      </tbody>
    </table>

    <!-- 回写来的待换刀具清单：与刀具磨损页调用同一个函数，条数、顺序一致 -->
    <h3 class="section-title">待换刀具清单（由刀具处置线回写）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>掘进环次</th>
          <th>本环待换刀数</th>
          <th>工区</th>
          <th>刀盘位置</th>
          <th>刀具类型</th>
          <th>刀具编号</th>
          <th>磨损量(mm)</th>
          <th>超出(mm)</th>
          <th>安排人</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="group in ringGroups" :key="group.ringNo">
          <tr v-for="(item, index) in group.items" :key="item.replacementId">
            <td v-if="index === 0" :rowspan="group.items.length">{{ group.ringNo }}</td>
            <td v-if="index === 0" :rowspan="group.items.length" class="cell-warn">{{ group.items.length }}</td>
            <td>{{ item.zone }}</td>
            <td>{{ item.position }}</td>
            <td>{{ item.type }}</td>
            <td>{{ item.cutterCode }}</td>
            <td>{{ item.wear }}</td>
            <td class="cell-warn">{{ item.exceed }}</td>
            <td>{{ item.scheduledBy }}</td>
          </tr>
        </template>
        <tr v-if="!ringGroups.length">
          <td colspan="9" class="empty-state">没有待销项的更换记录，各环次待换刀数均为 0</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条掘进环次记录；待换刀具 {{ pendingItems.length }} 把，与刀具磨损页一致</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listPendingCutters, pendingCountByRing } from '@/data/cutter/service'
import type { PendingCutterItem } from '@/data/cutter/types'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('ring')
const columns = ["环号", "起始里程", "掘进速度", "总推力", "刀盘扭矩", "出土方量", "掘进班组", "环次状态"]
const actions = ["开始掘进", "确认完成", "申请纠偏"]
const statuses = ["待掘进", "掘进中", "已贯通", "已纠偏"]
const stats = [{"label": "本月掘进环数", "value": 0}, {"label": "平均掘进速度", "value": 0}, {"label": "纠偏环数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 两个入口共用的一份待换清单
const pendingItems = ref<PendingCutterItem[]>([])

const ringGroups = computed(() => {
  const map = new Map<string, PendingCutterItem[]>()
  for (const item of pendingItems.value) {
    const list = map.get(item.ringNo) ?? []
    list.push(item)
    map.set(item.ringNo, list)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN', { numeric: true }))
    .map(([ringNo, items]) => ({ ringNo, items }))
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function pendingOf(ringNo: string): number {
  return pendingCountByRing().get(ringNo) ?? 0
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '掘进环登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 每次重读都从处置线取同一份，两侧条数永远一致
    pendingItems.value = listPendingCutters()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '掘进环次列表读取失败'
  }
}

onMounted(reload)
</script>
