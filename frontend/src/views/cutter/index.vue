<template>
  <section class="page" data-module="cutter">
    <header class="page-head">
      <div>
        <h2>刀具磨损管理</h2>
        <p class="page-desc">
          检查 → 安排更换 → 确认销项一条处置线；磨损按算法 v{{ algoVersion }}（径向磨损 =（初始直径−实测直径）/ 2），达到
          {{ wearLimit }}mm 判待更换；更换结论统一回写掘进环次。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记刀具</button>
        <button class="btn" type="button" @click="resetAll">重置示例数据</button>
      </div>
    </header>

    <!-- 当前身份：只有本工区机械员能改刀具类型与更换日期，切到别的工区可验证拦截 -->
    <div class="identity-bar">
      <span class="identity-title">当前操作人</span>
      <label>
        姓名
        <input v-model="actor.name" class="mini-input" />
      </label>
      <label>
        角色
        <select v-model="actor.role" class="mini-input">
          <option value="机械员">机械员</option>
          <option value="安全员">安全员</option>
          <option value="值班管理员">值班管理员</option>
        </select>
      </label>
      <label>
        所属工区
        <select v-model="actor.zone" class="mini-input">
          <option v-for="zone in zones" :key="zone" :value="zone">{{ zone }}</option>
        </select>
      </label>
      <span class="identity-hint">改刀具类型、更换日期限本工区机械员；跨工区操作一律拦回</span>
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">正常刀具</span>
        <strong class="stat-value">{{ summary.normal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待更换刀具（含未安排）</span>
        <strong class="stat-value">{{ summary.waiting }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待处置更换（两入口同口径）</span>
        <strong class="stat-value">{{ summary.disposal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">累计更换（已销项）</span>
        <strong class="stat-value">{{ summary.replaced }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已报废</span>
        <strong class="stat-value">{{ summary.scrapped }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item ring-side">掘进环次侧待换刀合计：{{ ringSideCount }}</span>
    </p>

    <!-- 处置线：换刀未确认期间同一把刀只在这里出现一次 -->
    <h3 class="section-title">待处置更换（检查 → 更换 → 销项）</h3>
    <table class="data-table disposal-table">
      <thead>
        <tr>
          <th>刀具编号</th>
          <th>工区</th>
          <th>刀盘位置（锁定）</th>
          <th>刀具类型（锁定）</th>
          <th>当前磨损量(mm)</th>
          <th>回写环次</th>
          <th>安排日期</th>
          <th>更换日期</th>
          <th>安排人</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in disposals" :key="row.replacement.id">
          <td>{{ row.cutter.code }}</td>
          <td>{{ row.cutter.zone }}</td>
          <td>{{ row.replacement.positionLocked }}</td>
          <td>{{ row.replacement.typeLocked }}</td>
          <td>{{ row.wear }}</td>
          <td>{{ row.replacement.ringNo }}</td>
          <td>{{ row.replacement.plannedAt }}</td>
          <td>{{ row.replacement.replaceDate }}</td>
          <td>{{ row.replacement.plannedBy }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openConfirm(row.replacement.id)">确认销项</button>
            <button class="link" type="button" @click="openDateEdit(row.replacement.id, row.replacement.replaceDate)">
              改更换日期
            </button>
          </td>
        </tr>
        <tr v-if="!disposals.length">
          <td colspan="10" class="empty-state">当前没有换刀未确认的待处置记录</td>
        </tr>
      </tbody>
    </table>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>工区</span>
        <select v-model="filters.zone" class="mini-input">
          <option value="">全部</option>
          <option v-for="zone in zones" :key="zone" :value="zone">{{ zone }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>刀具编号 / 刀盘位置</span>
        <input v-model="filters.keyword" placeholder="按编号或位置检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <h3 class="section-title">刀具台账</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>刀具编号</th>
          <th>工区</th>
          <th>刀盘位置</th>
          <th>刀具类型</th>
          <th>初始直径(mm)</th>
          <th>最近磨损量(mm)</th>
          <th>当前状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredCutters" :key="row.id" :class="{ selected: selectedId === row.id }">
          <td>{{ row.code }}</td>
          <td>{{ row.zone }}</td>
          <td>{{ row.position }}</td>
          <td>{{ row.type }}</td>
          <td>{{ row.initialDiameter }}</td>
          <td>{{ latestWearOf(row.id) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="selectCutter(row.id)">详情</button>
            <button class="link" type="button" @click="openInspect(row.id)">登记检查</button>
            <button class="link" type="button" @click="openSchedule(row.id)">安排更换</button>
            <button class="link" type="button" @click="openTypeEdit(row.id, row.type)">改类型</button>
            <button class="link danger" type="button" @click="scrap(row.id)">报废</button>
          </td>
        </tr>
        <tr v-if="!filteredCutters.length">
          <td colspan="8" class="empty-state">暂无符合条件的刀具</td>
        </tr>
      </tbody>
    </table>

    <!-- 详情面板：与列表读的是同一份处置线状态，不会再对不上 -->
    <div v-if="selected" class="detail-panel">
      <h3 class="section-title">处置详情 · {{ selected.cutter.code }}</h3>
      <p class="detail-line">
        {{ selected.cutter.zone }} / {{ selected.cutter.position }} / {{ selected.cutter.type }}
        ，初始直径 {{ selected.cutter.initialDiameter }}mm，当前状态「{{ selected.cutter.status }}」
      </p>
      <div class="detail-cols">
        <div>
          <h4>检查记录</h4>
          <table class="data-table">
            <thead>
              <tr><th>检查日期</th><th>检查人</th><th>实测直径</th><th>磨损量</th><th>结论</th><th>是否闭环</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in selected.inspections" :key="item.id">
                <td>{{ item.inspectedAt }}</td>
                <td>{{ item.inspector }}</td>
                <td>{{ item.measuredDiameter }}</td>
                <td>{{ item.wear }}</td>
                <td>{{ item.conclusion }}</td>
                <td>{{ item.closed ? '已闭环' : '未闭环' }}</td>
              </tr>
              <tr v-if="!selected.inspections.length"><td colspan="6" class="empty-state">暂无检查记录</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4>更换记录</h4>
          <table class="data-table">
            <thead>
              <tr><th>环次</th><th>更换日期</th><th>状态</th><th>销项日期</th><th>销项人</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in selected.replacements" :key="item.id">
                <td>{{ item.ringNo }}</td>
                <td>{{ item.replaceDate }}</td>
                <td>{{ item.status }}</td>
                <td>{{ item.confirmedAt || '—' }}</td>
                <td>{{ item.confirmedBy || '—' }}</td>
              </tr>
              <tr v-if="!selected.replacements.length"><td colspan="5" class="empty-state">暂无更换记录</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <h3 class="section-title">检查记录</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>#</th><th>刀具编号</th><th>检查日期</th><th>检查人</th>
          <th>初始直径</th><th>实测直径</th><th>当前磨损量(mm)</th><th>算法</th><th>结论</th><th>闭环</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in inspections" :key="item.id">
          <td>{{ item.id }}</td>
          <td>{{ codeOf(item.cutterId) }}</td>
          <td>{{ item.inspectedAt }}</td>
          <td>{{ item.inspector }}</td>
          <td>{{ item.initialDiameter }}</td>
          <td>{{ item.measuredDiameter }}</td>
          <td>{{ item.wear }}</td>
          <td>v{{ item.algoVersion }}</td>
          <td>{{ item.conclusion }}</td>
          <td>{{ item.closed ? '已闭环' : '未闭环' }}</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">更换记录</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>#</th><th>刀具编号</th><th>回写环次</th><th>锁定位置</th><th>锁定类型</th>
          <th>安排日期</th><th>更换日期</th><th>状态</th><th>销项日期</th><th>销项人</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in replacements" :key="item.id">
          <td>{{ item.id }}</td>
          <td>{{ codeOf(item.cutterId) }}</td>
          <td>{{ item.ringNo }}</td>
          <td>{{ item.positionLocked }}</td>
          <td>{{ item.typeLocked }}</td>
          <td>{{ item.plannedAt }}</td>
          <td>{{ item.replaceDate }}</td>
          <td>{{ item.status }}</td>
          <td>{{ item.confirmedAt || '—' }}</td>
          <td>{{ item.confirmedBy || '—' }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ cutters.length }} 把刀具 · 处置线记录与掘进环次待换刀清单同源</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 登记刀具 -->
    <div v-if="modal === 'create'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>登记刀具（按刀盘位置补录）</h3>
        <label class="modal-field">刀具编号<input v-model="form.code" placeholder="CUTT-0010" /></label>
        <label class="modal-field">所属工区<input :value="actor.zone" disabled /></label>
        <label class="modal-field">刀盘位置<input v-model="form.position" placeholder="如 P21-正面刀" /></label>
        <label class="modal-field">刀具类型<input v-model="form.type" placeholder="如 正面滚刀" /></label>
        <label class="modal-field">初始直径(mm)<input v-model.number="form.initialDiameter" type="number" /></label>
        <label class="modal-field">登记日期<input v-model="form.registeredAt" type="date" /></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeModal">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 登记检查 -->
    <div v-if="modal === 'inspect'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>登记检查 · {{ form.cutterCode }}</h3>
        <p class="modal-tip">按当前磨损量判定：实测后由系统算径向磨损，达到 {{ wearLimit }}mm 自动标待更换。</p>
        <label class="modal-field">实测直径(mm)<input v-model.number="form.measuredDiameter" type="number" step="0.1" /></label>
        <label class="modal-field">检查日期<input v-model="form.inspectedAt" type="date" /></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeModal">取消</button>
          <button class="btn primary" type="button" @click="submitInspect">登记检查</button>
        </div>
      </div>
    </div>

    <!-- 安排更换 -->
    <div v-if="modal === 'schedule'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>安排更换 · {{ form.cutterCode }}</h3>
        <p class="modal-tip">提交即锁定刀盘位置「{{ form.positionLock }}」与刀具类型「{{ form.typeLock }}」，并回写环次清单。</p>
        <label class="modal-field">
          掘进环次
          <select v-model="form.ringNo" class="mini-input">
            <option value="" disabled>请选择环次</option>
            <option v-for="ring in ringOptions" :key="String(ring.id)" :value="String(ring['环号'])">
              {{ ring['环号'] }}（{{ ring['环次状态'] }}）
            </option>
          </select>
        </label>
        <label class="modal-field">更换日期<input v-model="form.replaceDate" type="date" /></label>
        <label class="modal-field">安排日期<input v-model="form.plannedAt" type="date" /></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeModal">取消</button>
          <button class="btn primary" type="button" @click="submitSchedule">安排更换</button>
        </div>
      </div>
    </div>

    <!-- 确认销项 -->
    <div v-if="modal === 'confirm'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>确认销项</h3>
        <p class="modal-tip">确认后清除待更换旧标记、闭环超限检查，并从环次待换刀清单移除。</p>
        <label class="modal-field">销项日期<input v-model="form.confirmedAt" type="date" /></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeModal">取消</button>
          <button class="btn primary" type="button" @click="submitConfirm">确认销项</button>
        </div>
      </div>
    </div>

    <!-- 改类型 -->
    <div v-if="modal === 'typeEdit'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>修改刀具类型 · {{ form.cutterCode }}</h3>
        <p class="modal-tip">仅本工区机械员可改；已安排更换的锁定类型不受影响。</p>
        <label class="modal-field">刀具类型<input v-model="form.type" /></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeModal">取消</button>
          <button class="btn primary" type="button" @click="submitTypeEdit">保存</button>
        </div>
      </div>
    </div>

    <!-- 改更换日期 -->
    <div v-if="modal === 'dateEdit'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>修改更换日期</h3>
        <p class="modal-tip">仅本工区机械员可改，且仅限未确认的更换。</p>
        <label class="modal-field">更换日期<input v-model="form.replaceDate" type="date" /></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeModal">取消</button>
          <button class="btn primary" type="button" @click="submitDateEdit">保存</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import { listEntries } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'
import type { Cutter, Inspection, Replacement } from '@/data/cutter/types'
import type { Actor } from '@/data/cutter/service'
import {
  WEAR_ALGO_VERSION,
  WEAR_LIMIT_MM,
} from '@/data/cutter/wear'
import {
  confirmReplacement,
  editCutterType,
  editReplaceDate,
  getCutter,
  latestInspection,
  listCutters,
  listDisposals,
  listInspections,
  listReplacements,
  pendingDisposalCount,
  registerCutter,
  registerInspection,
  resetDomain,
  ringPendingWritebacks,
  scheduleReplacement,
  scrapCutter,
  stats,
} from '@/data/cutter/service'

const session = useSessionStore()

const zones = ['一工区', '二工区']
const actor = reactive({
  name: session.operator,
  role: session.role,
  zone: session.zone,
})

const algoVersion = WEAR_ALGO_VERSION
const wearLimit = WEAR_LIMIT_MM

const cutters = ref<Cutter[]>([])
const inspections = ref<Inspection[]>([])
const replacements = ref<Replacement[]>([])
const ringRows = ref<EntryRow[]>([])
const selectedId = ref<number | null>(null)
const message = ref('')
const messageOk = ref(true)
// 领域数据不在 Vue 响应式里：用版本号驱动 computed 在每次写完后重算。
const version = ref(0)

const disposals = computed(() => {
  void version.value
  return listDisposals()
})

const filters = reactive({ zone: '', keyword: '' })
const modal = ref<'' | 'create' | 'inspect' | 'schedule' | 'confirm' | 'typeEdit' | 'dateEdit'>('')
const form = reactive({
  cutterId: 0,
  replacementId: 0,
  cutterCode: '',
  code: '',
  position: '',
  type: '',
  positionLock: '',
  typeLock: '',
  initialDiameter: 432,
  registeredAt: today(),
  measuredDiameter: 432,
  inspectedAt: today(),
  ringNo: '',
  replaceDate: today(),
  plannedAt: today(),
  confirmedAt: today(),
})

function today(): string {
  return '2026-10-05'
}

function actorOf(): Actor {
  return { name: actor.name, role: actor.role, zone: actor.zone }
}

function notify(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

function codeOf(cutterId: number): string {
  return cutters.value.find((item) => item.id === cutterId)?.code ?? `#${cutterId}`
}

function latestWearOf(cutterId: number): string {
  const item = latestInspection(cutterId)
  return item ? String(item.wear) : '—'
}

const summary = computed(() => {
  void version.value
  return stats()
})

const ringSideCount = computed(() => {
  void version.value
  return ringPendingWritebacks().reduce((sum, item) => sum + item.count, 0)
})

const ringOptions = computed(() => ringRows.value)

const statusSummary = computed(() => {
  void version.value
  return (['正常', '待更换', '已更换', '已报废'] as const).map((status) => ({
    status,
    count: cutters.value.filter((row) => row.status === status).length,
  }))
})

const filteredCutters = computed(() =>
  cutters.value.filter((row) => {
    if (filters.zone && row.zone !== filters.zone) {
      return false
    }
    const keyword = filters.keyword.trim()
    if (!keyword) {
      return true
    }
    return row.code.includes(keyword) || row.position.includes(keyword)
  }),
)

const selected = computed(() => {
  void version.value
  if (selectedId.value === null) {
    return null
  }
  const cutter = getCutter(selectedId.value)
  if (!cutter) {
    return null
  }
  return {
    cutter,
    inspections: inspections.value
      .filter((item) => item.cutterId === cutter.id)
      .sort((a, b) => a.id - b.id),
    replacements: replacements.value
      .filter((item) => item.cutterId === cutter.id)
      .sort((a, b) => a.id - b.id),
  }
})

function closeModal() {
  modal.value = ''
}

function selectCutter(id: number) {
  selectedId.value = id
}

function openCreate() {
  Object.assign(form, {
    code: '', position: '', type: '', initialDiameter: 432, registeredAt: today(),
  })
  modal.value = 'create'
}

function openInspect(id: number) {
  const cutter = getCutter(id)
  if (!cutter) {
    return
  }
  Object.assign(form, {
    cutterId: id,
    cutterCode: cutter.code,
    measuredDiameter: cutter.initialDiameter,
    inspectedAt: today(),
  })
  modal.value = 'inspect'
}

function openSchedule(id: number) {
  const cutter = getCutter(id)
  if (!cutter) {
    return
  }
  Object.assign(form, {
    cutterId: id,
    cutterCode: cutter.code,
    positionLock: cutter.position,
    typeLock: cutter.type,
    ringNo: '',
    replaceDate: today(),
    plannedAt: today(),
  })
  modal.value = 'schedule'
}

function openConfirm(replacementId: number) {
  Object.assign(form, { replacementId, confirmedAt: today() })
  modal.value = 'confirm'
}

function openTypeEdit(id: number, type: string) {
  const cutter = getCutter(id)
  if (!cutter) {
    return
  }
  Object.assign(form, { cutterId: id, cutterCode: cutter.code, type })
  modal.value = 'typeEdit'
}

function openDateEdit(replacementId: number, replaceDate: string) {
  Object.assign(form, { replacementId, replaceDate })
  modal.value = 'dateEdit'
}

// 所有写操作都走同一事务口：服务端校验不通过或浏览器存不下，会整笔退回。
function runWrite(action: () => { ok: true; message: string }) {
  try {
    const result = action()
    notify(result.message, true)
    closeModal()
    reload()
  } catch (error) {
    notify(error instanceof Error ? error.message : '操作失败，整笔退回', false)
  }
}

function submitCreate() {
  runWrite(() =>
    registerCutter({
      actor: actorOf(),
      code: form.code,
      zone: actor.zone,
      position: form.position,
      type: form.type,
      initialDiameter: Number(form.initialDiameter),
      registeredAt: form.registeredAt,
    }),
  )
}

function submitInspect() {
  runWrite(() =>
    registerInspection({
      actor: actorOf(),
      cutterId: form.cutterId,
      inspectedAt: form.inspectedAt,
      measuredDiameter: Number(form.measuredDiameter),
    }),
  )
}

function submitSchedule() {
  runWrite(() =>
    scheduleReplacement({
      actor: actorOf(),
      cutterId: form.cutterId,
      ringNo: form.ringNo,
      replaceDate: form.replaceDate,
      plannedAt: form.plannedAt,
    }),
  )
}

function submitConfirm() {
  runWrite(() =>
    confirmReplacement({
      actor: actorOf(),
      replacementId: form.replacementId,
      confirmedAt: form.confirmedAt,
    }),
  )
}

function submitTypeEdit() {
  runWrite(() => editCutterType({ actor: actorOf(), cutterId: form.cutterId, type: form.type }))
}

function submitDateEdit() {
  runWrite(() =>
    editReplaceDate({
      actor: actorOf(),
      replacementId: form.replacementId,
      replaceDate: form.replaceDate,
    }),
  )
}

function scrap(id: number) {
  runWrite(() => scrapCutter({ actor: actorOf(), cutterId: id }))
}

function resetFilters() {
  filters.zone = ''
  filters.keyword = ''
}

function resetAll() {
  runWrite(() => {
    resetDomain()
    selectedId.value = null
    return { ok: true as const, message: '刀具处置线已重置为示例数据' }
  })
}

function reload() {
  // 身份条只改本地会话，不落业务数据。
  session.setOperator({ operator: actor.name, role: actor.role, zone: actor.zone })
  cutters.value = listCutters()
  inspections.value = listInspections()
  replacements.value = listReplacements()
  ringRows.value = listEntries('ring').items
  version.value += 1
  // 兜底断言：两个入口读到的处置条数必须一致，不一致直接亮错。
  if (pendingDisposalCount() !== ringSideCount.value) {
    notify('两入口处置条数不一致，请检查数据', false)
  }
}

reload()
</script>

<style scoped>
.identity-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
}
.identity-title { font-weight: 600; }
.identity-hint { color: var(--muted); font-size: 12px; }
.mini-input { padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; font-size: 13px; }
.section-title { font-size: 15px; margin: 18px 0 8px; }
.ring-side { background: #e8f1ff; color: #1f4fb0; }
tr.selected { background: #eef5ff; }
.link.danger { color: #b42318; }
.ok-text { color: #067647; }
.detail-panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-top: 14px; }
.detail-line { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
.detail-cols { display: flex; gap: 12px; }
.detail-cols > div { flex: 1; }
.detail-cols h4 { margin: 4px 0; font-size: 13px; }
.disposal-table td, .disposal-table th { font-size: 12px; }
.modal-mask {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 50;
}
.modal { background: #fff; border-radius: 10px; padding: 18px 20px; width: 380px; }
.modal h3 { margin: 0 0 10px; font-size: 16px; }
.modal-tip { color: var(--muted); font-size: 12px; margin: 0 0 10px; }
.modal-field { display: block; font-size: 13px; margin-bottom: 10px; }
.modal-field input, .modal-field select { display: block; width: 100%; margin-top: 4px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
</style>
