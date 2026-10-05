<template>
  <section class="page" data-module="ring">
    <header class="page-head">
      <div>
        <h2>掘进环次管理</h2>
        <p class="page-desc">
          维护掘进环，围绕环号、起始里程、掘进速度、总推力做登记、筛选与状态流转。
          待换刀具清单与待换刀数由刀具处置线统一回写，本页只读，不另存一份。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出掘进环次清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">掘进环总数</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待换刀具合计（与刀具入口一致）</span>
        <strong class="stat-value">{{ pendingCutterTotal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">有待换刀的环次</span>
        <strong class="stat-value">{{ writebacks.length }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item ring-source">数字来源：刀具处置线未确认更换记录（唯一口径）</span>
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
          <th>待换刀具清单（回写）</th>
          <th>待换刀具数（回写）</th>
          <th>当前状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ writebackOf(String(row['环号'])).items.join('、') || '—' }}</td>
          <td>
            <strong :class="{ pending: writebackOf(String(row['环号'])).count > 0 }">
              {{ writebackOf(String(row['环号'])).count }}
            </strong>
          </td>
          <td>{{ row.status }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无掘进环次数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条掘进环次记录 · 待换刀数由刀具磨损页「安排更换/确认销项」回写</span>
      <span v-if="mismatch" class="error-text">回写数与存储数对不上，请刷新或重置刀具数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { ringPendingWritebacks } from '@/data/cutter/service'

const meta = moduleMeta('ring')
// 回写的两列单独渲染，不放进通用列，避免与清单口径分叉。
const columns = ["环号", "起始里程", "掘进速度", "总推力", "刀盘扭矩", "出土方量", "掘进班组", "环次状态"]
const statuses = ["待掘进", "掘进中", "已贯通", "已纠偏"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const filters = ref<Record<string, string>>({})
const filterFields = ['环号', '掘进班组']

const writebacks = computed(() => ringPendingWritebacks())
const writebackMap = computed(() => {
  const map = new Map<string, { items: string[]; count: number }>()
  for (const item of writebacks.value) {
    map.set(item.ringNo, { items: item.items, count: item.count })
  }
  return map
})

const pendingCutterTotal = computed(() =>
  writebacks.value.reduce((sum, item) => sum + item.count, 0),
)

const mismatch = computed(() =>
  rows.value.some((row) => {
    const wb = writebackOf(String(row['环号']))
    return Number(row['待换刀具数'] ?? 0) !== wb.count
  }),
)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function writebackOf(ringNo: string): { items: string[]; count: number } {
  return writebackMap.value.get(ringNo) ?? { items: [], count: 0 }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  const payload = listEntries(meta.key, filters.value)
  rows.value = payload.items
  total.value = payload.total
}

onMounted(reload)
</script>

<style scoped>
.ring-source { background: #e8f1ff; color: #1f4fb0; }
strong.pending { color: #b42318; }
</style>
