<template>
  <section class="page" data-module="ads">
    <header class="page-head">
      <div>
        <h2>应用层发布管理</h2>
        <p class="page-desc">维护应用层数据发布的输入、执行约束与结果记录，为应用层发布提供可验证的数据工程流程。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记应用数据集</button>
        <button class="btn" type="button" @click="exportRows">导出应用层发布清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无应用层发布数据，可先登记应用数据集</td>
        </tr>
      </tbody>
    </table>

    <section class="panel">
      <h3 class="panel-title">消费的字段契约（来自汇总层建模）</h3>
      <p class="hint">
        共 {{ consumptionRows.length }} 条数据集绑定。字段名、精度与空值语义以契约快照为准；
        契约发布前若存在阻断级兼容差异，会先登记到汇总层处理，不会在这里自动改绑。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>数据集编号</th>
            <th>业务应用</th>
            <th>绑定契约</th>
            <th>消费字段</th>
            <th>契约状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in consumptionRows" :key="item.binding.datasetCode">
            <td>{{ item.binding.datasetCode }}</td>
            <td>{{ item.binding.application }}</td>
            <td>
              <code>{{ item.binding.boundContract }}</code>
              <small v-if="item.contract" class="block">
                上游 {{ item.contract.upstream.table }}@{{ item.contract.upstream.version }}
              </small>
            </td>
            <td>
              <span v-for="field in item.fields" :key="field.metricCode" class="field-chip">
                {{ field.field }}（{{ field.metricName }}·{{ field.precision }}位{{ field.nullable ? '／可空' : '／非空' }}）
              </span>
            </td>
            <td>
              <span v-if="item.drift.length" class="tag error">需核对</span>
              <span v-else class="tag ok">与契约一致</span>
              <small v-for="note in item.drift" :key="note" class="block warn-text">{{ note }}</small>
            </td>
          </tr>
          <tr v-if="!consumptionRows.length">
            <td colspan="5" class="empty-state">暂无应用数据集绑定汇总层字段契约</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条应用层发布记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  datasetConsumption,
  onContractChange,
  type DatasetConsumption,
} from '@/api/contract-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('ads')
const consumptionRows = ref<DatasetConsumption[]>(datasetConsumption())

function loadConsumption() {
  consumptionRows.value = datasetConsumption()
}
const columns = ["数据集编号", "业务应用", "输出表名", "查询模板", "下游消费方", "接口协议", "刷新策略", "版本号"]
const actions = ["提交发布", "发布上线", "服务下线"]
const statuses = ["草稿", "待发布", "已发布", "已下线"]
const stats = [{"label": "应用数据集总数", "value": 0}, {"label": "已发布数据集", "value": 0}, {"label": "待发布数据集", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '应用数据集登记入口尚未接入审批流'
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
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '应用层发布列表读取失败'
  }
}

let unsubscribe: (() => void) | null = null

onMounted(() => {
  loadConsumption()
  reload()
  unsubscribe = onContractChange(loadConsumption)
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>
