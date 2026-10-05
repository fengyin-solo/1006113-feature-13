<template>
  <section class="page" data-module="cutter">
    <header class="page-head">
      <div>
        <h2>刀具磨损管理</h2>
        <p class="page-desc">
          登记检查 → 安排更换（锁定刀盘位置与刀具类型）→ 换完确认销项（清除旧标记）。
          当前磨损按 v2 算法：径向磨损 =（初始直径 − 实测直径）÷ 2。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetData">重置示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">正常刀具</span>
        <strong class="stat-value">{{ stats.normal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待更换刀具</span>
        <strong class="stat-value">{{ stats.waiting }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">更换中（待销项）</span>
        <strong class="stat-value">{{ stats.replacing }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">累计更换数</span>
        <strong class="stat-value">{{ stats.replacedTotal }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">当前处置身份：{{ store.operator }}（{{ store.role }} · {{ store.zone }}）</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>工区</span>
        <select v-model="filters.zone">
          <option value="">全部</option>
          <option>一工区</option>
          <option>二工区</option>
        </select>
      </label>
      <label class="filter-item">
        <span>刀盘位置/编号</span>
        <input v-model="filters.keyword" placeholder="按刀盘位置或刀具编号检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>工区</th>
          <th>刀具编号</th>
          <th>刀盘位置</th>
          <th>刀具类型</th>
          <th>初始直径(mm)</th>
          <th>当前磨损量(mm)</th>
          <th>限值/超出(mm)</th>
          <th>处置状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.cutter.id" :class="{ 'row-muted': row.cutter.scrapped }">
          <td>{{ row.cutter.zone }}</td>
          <td>{{ row.cutter.code }}</td>
          <td>{{ row.cutter.position }}</td>
          <td>{{ row.cutter.type }}</td>
          <td>{{ row.cutter.initialDiameter }}</td>
          <td :class="{ 'cell-warn': row.exceed > 0 }">{{ row.currentWear }}</td>
          <td>
            {{ row.wearLimit }}<span v-if="row.exceed > 0" class="cell-warn"> / 超 {{ row.exceed }}</span>
          </td>
          <td><span :class="['badge', `badge-${statusKey(row.status)}`]">{{ row.status }}</span></td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row.cutter.id)">详情</button>
            <button class="link" type="button" @click="openInspection(row.cutter.id)" :disabled="row.cutter.scrapped">登记检查</button>
            <button
              class="link"
              type="button"
              @click="schedule(row)"
              :disabled="row.status !== '待更换'"
            >安排更换</button>
            <button
              v-if="row.openReplacement"
              class="link"
              type="button"
              @click="openConfirm(row.openReplacement!.id)"
            >确认销项</button>
            <button
              v-if="!row.cutter.scrapped && !row.openReplacement"
              class="link danger"
              type="button"
              @click="scrap(row)"
            >报废刀具</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="9" class="empty-state">暂无符合条件的刀具</td>
        </tr>
      </tbody>
    </table>

    <!-- 回写环次的待换刀具清单：本页与掘进环次页共用同一份数据，条数/顺序一致 -->
    <h3 class="section-title">掘进环次待换刀具清单（待销项 {{ pendingItems.length }} 把）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>掘进环次</th>
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
        <tr v-for="item in pendingItems" :key="item.replacementId">
          <td>{{ item.ringNo }}</td>
          <td>{{ item.zone }}</td>
          <td>{{ item.position }}</td>
          <td>{{ item.type }}</td>
          <td>{{ item.cutterCode }}</td>
          <td>{{ item.wear }}</td>
          <td class="cell-warn">{{ item.exceed }}</td>
          <td>{{ item.scheduledBy }}</td>
        </tr>
        <tr v-if="!pendingItems.length">
          <td colspan="8" class="empty-state">没有待销项的更换记录，各环次待换刀数均为 0</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 把刀具；处置线共 {{ replacementsCount }} 条更换记录（含已销项）</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 详情面板：与列表同一派生口径，不再各算各的 -->
    <div v-if="detail" class="modal-mask" @click.self="closeDetail">
      <div class="modal">
        <div class="modal-head">
          <h3>{{ detail.row.cutter.zone }} · {{ detail.row.cutter.position }} · {{ detail.row.cutter.code }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </div>
        <p class="modal-desc">
          处置状态：<span :class="['badge', `badge-${statusKey(detail.row.status)}`]">{{ detail.row.status }}</span>
          ；当前磨损 {{ detail.row.currentWear }}mm（限值 {{ detail.row.wearLimit }}mm，
          超出 {{ detail.row.exceed }}mm）
        </p>

        <h4 class="modal-sub">检查记录</h4>
        <table class="data-table mini">
          <thead>
            <tr><th>检查日期</th><th>环次</th><th>原始读数</th><th>磨损量(v2)</th><th>超出</th><th>判定</th><th>标记</th><th>检查人</th></tr>
          </thead>
          <tbody>
            <tr v-for="ins in detail.inspections" :key="ins.id">
              <td>{{ ins.inspectDate }}</td>
              <td>{{ ins.ringNo }}</td>
              <td>{{ ins.rawReading }}</td>
              <td>{{ ins.wear }}</td>
              <td>{{ ins.exceed }}</td>
              <td>{{ ins.suggested ? '待更换' : '正常' }}</td>
              <td>{{ ins.closed ? '已清' : '在册' }}</td>
              <td>{{ ins.inspector }}</td>
            </tr>
            <tr v-if="!detail.inspections.length"><td colspan="8" class="empty-state">暂无检查记录</td></tr>
          </tbody>
        </table>

        <h4 class="modal-sub">更换处置单</h4>
        <table class="data-table mini">
          <thead>
            <tr><th>单号</th><th>环次</th><th>锁定位置</th><th>锁定类型</th><th>状态</th><th>安排人</th><th>更换日期</th><th>销项人</th></tr>
          </thead>
          <tbody>
            <tr v-for="rep in detail.replacements" :key="rep.id">
              <td>{{ rep.id }}</td>
              <td>{{ rep.ringNo }}</td>
              <td>{{ rep.lockedPosition }}</td>
              <td>{{ rep.lockedType }}</td>
              <td><span :class="['badge', rep.status === '待确认' ? 'badge-replacing' : 'badge-normal']">{{ rep.status }}</span></td>
              <td>{{ rep.scheduledBy }}</td>
              <td>{{ rep.finishedAt || '—' }}</td>
              <td>{{ rep.finishedBy || '—' }}</td>
            </tr>
            <tr v-if="!detail.replacements.length"><td colspan="8" class="empty-state">暂无更换记录</td></tr>
          </tbody>
        </table>

        <div class="modal-actions">
          <template v-if="canEditType(detail.row)">
            <label class="inline-item">
              改刀具类型（仅本工区机械员）
              <select v-model="detail.typeDraft">
                <option>滚刀</option>
                <option>切刀</option>
                <option>边刮刀</option>
              </select>
            </label>
            <button class="btn" type="button" @click="submitTypeChange(detail.row.cutter.id, detail.typeDraft)">保存类型</button>
          </template>
          <span v-else-if="detail.row.openReplacement" class="modal-hint">换刀未确认，刀盘位置与刀具类型已锁定</span>
          <button class="btn primary" type="button" @click="openInspection(detail.row.cutter.id); closeDetail()">登记检查</button>
          <button
            class="btn"
            type="button"
            :disabled="detail.row.status !== '待更换'"
            @click="schedule(detail.row); closeDetail()"
          >安排更换</button>
          <button
            v-if="detail.row.openReplacement"
            class="btn"
            type="button"
            @click="openConfirm(detail.row.openReplacement!.id); closeDetail()"
          >确认销项</button>
        </div>
      </div>
    </div>

    <!-- 登记检查 -->
    <div v-if="inspectForm" class="modal-mask" @click.self="inspectForm = null">
      <form class="modal" @submit.prevent="submitInspection">
        <div class="modal-head"><h3>登记检查 · {{ inspectForm.cutter.position }}（{{ inspectForm.cutter.type }}）</h3></div>
        <label class="form-item">
          <span>检查日期</span>
          <input v-model="inspectForm.inspectDate" type="date" />
        </label>
        <label class="form-item">
          <span>掘进环次</span>
          <input v-model="inspectForm.ringNo" placeholder="如 R-105" />
        </label>
        <label class="form-item">
          <span>实测直径减少量(mm)，按 v2 自动除以 2</span>
          <input v-model.number="inspectForm.rawReading" type="number" min="0" step="0.1" />
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="submit">提交登记</button>
          <button class="btn ghost" type="button" @click="inspectForm = null">取消</button>
        </div>
      </form>
    </div>

    <!-- 确认销项 -->
    <div v-if="confirmForm" class="modal-mask" @click.self="confirmForm = null">
      <form class="modal" @submit.prevent="submitConfirm">
        <div class="modal-head"><h3>换完确认销项 · 处置单 #{{ confirmForm.replacementId }}</h3></div>
        <p class="modal-desc">
          锁定位置 {{ confirmForm.position }}，锁定类型 {{ confirmForm.type }}。
          销项后旧的待更换标记一并清除。更换日期仅本工区机械员可填写。
        </p>
        <label class="form-item">
          <span>更换日期</span>
          <input v-model="confirmForm.finishDate" type="date" />
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="submit">确认销项</button>
          <button class="btn ghost" type="button" @click="confirmForm = null">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { useSessionStore } from '@/stores/session'
import {
  changeCutterType,
  confirmReplacement,
  cutterStats,
  deriveRow,
  inspectionsOf,
  listCutterRows,
  listPendingCutters,
  loadDomain,
  registerInspection,
  replacementsOf,
  resetCutterData,
  scheduleReplacement,
  scrapCutter,
} from '@/data/cutter/service'
import type { CutterType, CutterViewRow } from '@/data/cutter/types'

const store = useSessionStore()

const rows = ref<CutterViewRow[]>([])
const pendingItems = ref(listPendingCutters())
const replacementsCount = ref(0)
const filters = reactive({ zone: '', keyword: '' })
const message = ref('')
const messageOk = ref(true)

const statuses = ['正常', '待更换', '更换中', '已报废'] as const
const stats = ref(cutterStats())

const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: rows.value.filter((row) => row.status === status).length })),
)

interface DetailState {
  row: CutterViewRow
  inspections: ReturnType<typeof inspectionsOf>
  replacements: ReturnType<typeof replacementsOf>
  typeDraft: CutterType
}
const detail = ref<DetailState | null>(null)

const inspectForm = ref<{ cutterId: number; cutter: CutterViewRow['cutter']; inspectDate: string; ringNo: string; rawReading: number | null } | null>(null)
const confirmForm = ref<{ replacementId: number; position: string; type: string; finishDate: string } | null>(null)

function statusKey(status: string): string {
  return { 正常: 'normal', 待更换: 'waiting', 更换中: 'replacing', 已报废: 'scrapped' }[status] ?? 'normal'
}

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function reload() {
  const domain = loadDomain()
  const keyword = filters.keyword.trim()
  rows.value = listCutterRows(domain).filter((row) => {
    if (filters.zone && row.cutter.zone !== filters.zone) return false
    if (keyword && !row.cutter.position.includes(keyword) && !row.cutter.code.includes(keyword)) return false
    return true
  })
  pendingItems.value = listPendingCutters(domain)
  replacementsCount.value = domain.replacements.length
  stats.value = cutterStats(domain)
  if (detail.value) {
    const cutterId = detail.value.row.cutter.id
    const row = listCutterRows(domain).find((item) => item.cutter.id === cutterId)
    if (row) {
      detail.value = {
        row,
        inspections: inspectionsOf(domain, cutterId),
        replacements: replacementsOf(domain, cutterId),
        typeDraft: detail.value.typeDraft,
      }
    } else {
      detail.value = null
    }
  }
}

function resetFilters() {
  filters.zone = ''
  filters.keyword = ''
  reload()
}

function openDetail(cutterId: number) {
  const domain = loadDomain()
  const row = deriveRow(domain, domain.cutters.find((c) => c.id === cutterId)!)
  detail.value = {
    row,
    inspections: inspectionsOf(domain, cutterId),
    replacements: replacementsOf(domain, cutterId),
    typeDraft: row.cutter.type,
  }
}

function canEditType(row: CutterViewRow): boolean {
  return (
    !row.cutter.scrapped &&
    !row.openReplacement &&
    store.role === '机械员' &&
    store.zone === row.cutter.zone
  )
}

function submitTypeChange(cutterId: number, type: CutterType) {
  const result = changeCutterType(cutterId, type, store.operatorProfile)
  notify(result.ok, result.message)
  if (result.ok) reload()
}

function scrap(row: CutterViewRow) {
  const result = scrapCutter(row.cutter.id, store.operatorProfile)
  notify(result.ok, result.message)
  if (result.ok) reload()
}

function closeDetail() {
  detail.value = null
}

function openInspection(cutterId: number) {
  const row = rows.value.find((item) => item.cutter.id === cutterId)
  if (!row) return
  inspectForm.value = { cutterId, cutter: row.cutter, inspectDate: '', ringNo: '', rawReading: null }
}

function submitInspection() {
  const form = inspectForm.value
  if (!form) return
  const result = registerInspection({
    cutterId: form.cutterId,
    inspectDate: form.inspectDate,
    ringNo: form.ringNo,
    rawReading: Number(form.rawReading),
    operator: store.operatorProfile,
  })
  notify(result.ok, result.message)
  if (result.ok) {
    inspectForm.value = null
    reload()
  }
}

function schedule(row: CutterViewRow) {
  const result = scheduleReplacement({ cutterId: row.cutter.id, ringNo: '', operator: store.operatorProfile })
  notify(result.ok, result.message)
  if (result.ok) reload()
}

function openConfirm(replacementId: number) {
  const domain = loadDomain()
  const rep = domain.replacements.find((item) => item.id === replacementId)
  if (!rep) return
  confirmForm.value = {
    replacementId,
    position: rep.lockedPosition,
    type: rep.lockedType,
    finishDate: rep.finishedAt || '',
  }
}

function submitConfirm() {
  const form = confirmForm.value
  if (!form) return
  const result = confirmReplacement({
    replacementId: form.replacementId,
    finishDate: form.finishDate,
    operator: store.operatorProfile,
  })
  notify(result.ok, result.message)
  if (result.ok) {
    confirmForm.value = null
    reload()
  }
}

function resetData() {
  resetCutterData()
  notify(true, '已重置为示例数据，历史磨损量已按 v2 重算')
  reload()
}

onMounted(reload)
</script>
