<template>
  <section class="page dws-workbench" data-module="dws">
    <header class="page-head">
      <div>
        <h2>汇总层建模 · 字段契约编译</h2>
        <p class="page-desc">
          汇总层建模是主对象：把汇总指标的聚合维度、度量列、上游明细表与刷新周期编译成应用层可消费的字段契约。
          判定口径固定为「范围 + 条件 + 标准」三者同时成立；同度量多规则按来源层级 → 优先级 → 版本裁决。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportCsv">导出字段契约</button>
        <button class="btn ghost" type="button" @click="resetAll">恢复示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <nav class="mode-switch">
      <button
        type="button"
        class="btn"
        :class="{ primary: mode === 'contract' }"
        @click="mode = 'contract'"
      >
        字段契约
      </button>
      <button
        type="button"
        class="btn"
        :class="{ primary: mode === 'registry' }"
        @click="mode = 'registry'"
      >
        汇总表清单
      </button>
    </nav>

    <template v-if="mode === 'contract'">
    <p v-if="notice" class="notice" :class="noticeKind">{{ notice }}</p>

    <section class="panel">
      <h3 class="panel-title">选择汇总主题</h3>
      <div class="topic-tabs">
        <button
          v-for="item in topics"
          :key="item.id"
          type="button"
          class="topic-tab"
          :class="{ active: item.id === selectedTopicId }"
          @click="selectTopic(item.id)"
        >
          <strong>{{ item.name }}</strong>
          <span>{{ item.summaryTable }}</span>
          <small>{{ item.dimensions.join(' / ') }}</small>
        </button>
      </div>
    </section>

    <section class="panel">
      <h3 class="panel-title">口径关系：上游明细 → 汇总表 → 应用数据集</h3>
      <div class="chain">
        <div class="chain-node">
          <span class="chain-label">上游明细表</span>
          <strong>{{ topic.upstream.table }}</strong>
          <small>{{ topic.upstream.name }}</small>
          <small>当前快照 {{ upstream.version }} · 历史 {{ upstream.historyDays }} 天</small>
          <small>维度 {{ upstream.dimensions.join('、') }}</small>
          <span v-if="upstreamDrifted" class="tag warn">已被模拟调整</span>
        </div>
        <div class="chain-arrow">→</div>
        <div class="chain-node highlight">
          <span class="chain-label">汇总表（主对象）</span>
          <strong>{{ topic.summaryTable }}</strong>
          <small>{{ topic.name }}</small>
          <small>聚合维度：{{ topic.dimensions.join('、') }}</small>
          <small>刷新周期：{{ topic.refreshCycle }} · 历史 {{ topic.historyDays }} 天</small>
          <small>度量列：{{ topic.metrics.map((metric) => metric.name).join('、') }}</small>
        </div>
        <div class="chain-arrow">→</div>
        <div class="chain-node">
          <span class="chain-label">应用数据集</span>
          <strong>{{ topic.ads.datasetCode }}</strong>
          <small>输出表 {{ topic.ads.outputTable }}</small>
          <small>{{ topic.ads.datasetName }} · {{ topic.ads.application }}</small>
          <small>消费字段：{{ compiledFields.join('、') || '尚未编译' }}</small>
        </div>
      </div>
      <p v-if="draft.warnings.length" class="hint error-text">
        <span v-for="warning in draft.warnings" :key="warning" class="block">{{ warning }}</span>
      </p>
      <p v-for="note in draft.driftNotes" :key="note" class="hint warn-text">
        上游口径不一致：{{ note }}
      </p>
    </section>

    <section class="panel">
      <h3 class="panel-title">度量口径判定（范围、条件、标准必须共同成立）</h3>
      <table class="data-table rule-table">
        <thead>
          <tr>
            <th>度量</th>
            <th>规则</th>
            <th>来源／优先级</th>
            <th>范围</th>
            <th>条件</th>
            <th>标准</th>
            <th>判定</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="outcome in draft.metricOutcomes" :key="outcome.metricCode">
            <tr class="metric-row">
              <td colspan="7">
                <strong>{{ outcome.metricName }}</strong>
                <span v-if="outcome.winnerRuleId" class="tag ok">{{ outcome.winnerRuleId }}</span>
                <span v-else class="tag error">无适用规则</span>
                <p v-if="outcome.conflict" class="conflict-line">冲突：{{ outcome.conflictReason }}</p>
              </td>
            </tr>
            <tr
              v-for="evaluation in outcome.evaluations"
              :key="evaluation.rule.ruleId"
              :class="{ 'rule-winner': evaluation.rule.ruleId === outcome.winnerRuleId }"
            >
              <td>{{ evaluation.rule.metricName }}</td>
              <td>
                <strong>{{ evaluation.rule.ruleId }}</strong>
                <small class="block">{{ evaluation.rule.version }} · {{ evaluation.rule.outputField }}</small>
                <small class="block"><code>{{ evaluation.rule.expression }}</code></small>
              </td>
              <td>
                {{ evaluation.rule.source }}
                <small class="block">层级 {{ evaluation.rule.sourceTier }} · 优先级 {{ evaluation.rule.priority }}</small>
              </td>
              <td>
                <span class="verdict" :class="evaluation.inScope ? 'pass' : 'fail'">
                  {{ evaluation.inScope ? '成立' : '不成立' }}
                </span>
                <small class="block">{{ evaluation.scopeNote }}</small>
              </td>
              <td>
                <span class="verdict" :class="evaluation.conditionsMet ? 'pass' : 'fail'">
                  {{ evaluation.conditionsMet ? '成立' : '不成立' }}
                </span>
                <small class="block">{{ evaluation.conditionNote }}</small>
              </td>
              <td>
                <span class="verdict" :class="evaluation.standardMet ? 'pass' : 'fail'">
                  {{ evaluation.standardMet ? '成立' : '不成立' }}
                </span>
                <small class="block">{{ evaluation.standardNote }}</small>
              </td>
              <td>
                <span class="tag" :class="evaluation.applied ? 'ok' : 'muted'">
                  {{ evaluation.applied ? '适用' : '落选' }}
                </span>
              </td>
            </tr>
            <tr v-if="!outcome.evaluations.length">
              <td :colspan="6" class="empty-state">暂无登记规则</td>
              <td><span class="tag muted">落选</span></td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h3 class="panel-title">字段契约编译</h3>
        <div class="page-actions">
          <button class="btn primary" type="button" @click="compile">编译并放入待确认队列</button>
        </div>
      </div>
      <p class="hint">
        同一输入重复编译只产生一份待确认结果（幂等键：<code>{{ draft.compiledKey }}</code>）。
        发布时会冻结上游 {{ upstream.table }}@{{ upstream.version }}。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>度量</th>
            <th>输出字段</th>
            <th>精度</th>
            <th>空值</th>
            <th>口径表达式</th>
            <th>采用规则</th>
            <th>相对已发布契约</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="field in draft.fields" :key="field.metricCode">
            <td>{{ field.metricName }}</td>
            <td><code>{{ field.field }}</code></td>
            <td>{{ field.precision }}</td>
            <td>{{ field.nullable ? '可空' : '非空' }}</td>
            <td><code>{{ field.expression }}</code></td>
            <td>{{ field.ruleId }}（{{ sourceLabel(field.ruleSource) }} {{ field.ruleVersion }}）</td>
            <td>
              <span class="tag" :class="changeTone(field.changeKind)">{{ field.changeKind }}</span>
              <small v-if="field.previousField" class="block">原字段 {{ field.previousField }}</small>
              <small v-if="field.previousNote" class="block">{{ field.previousNote }}</small>
            </td>
          </tr>
          <tr v-if="!draft.fields.length">
            <td colspan="7" class="empty-state">
              当前主题没有同时满足范围、条件与标准的规则，无法产出字段契约
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="pending" class="panel">
      <div class="panel-head">
        <h3 class="panel-title">
          待确认契约 {{ pending.contractId }}@{{ pending.contractVersion }}
          <small class="muted-inline">编译于 {{ pending.compiledAt }}</small>
        </h3>
        <div class="page-actions">
          <button class="btn primary" type="button" :disabled="!canPublish" @click="publish">
            确认发布并冻结上游
          </button>
        </div>
      </div>

      <div class="compare-grid">
        <div>
          <h4>待发布字段</h4>
          <ul class="plain-list">
            <li v-for="field in pending.fields" :key="field.metricCode">
              <code>{{ field.field }}</code> ← {{ field.metricName }}
              <small class="block">
                精度 {{ field.precision }} · {{ field.nullable ? '可空' : '非空' }} · {{ field.ruleId }}（{{
                  field.ruleVersion
                }}）
              </small>
            </li>
          </ul>
        </div>
        <div>
          <h4>冻结上游快照</h4>
          <ul class="plain-list">
            <li><code>{{ pending.upstream.table }}@{{ pending.upstream.version }}</code></li>
            <li>维度：{{ pending.upstream.dimensions.join('、') }}</li>
            <li>历史天数：{{ pending.upstream.historyDays }} 天</li>
            <li>刷新周期：{{ pending.upstream.refreshCycle }}</li>
          </ul>
        </div>
      </div>

      <h4 class="sub-title">兼容差异（发布前必须处理阻断项，不静默覆盖下游绑定）</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>级别</th>
            <th>度量</th>
            <th>类型</th>
            <th>字段变化</th>
            <th>影响下游</th>
            <th>说明</th>
            <th>处理</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in pendingCompat" :key="item.itemId">
            <td>
              <span class="tag" :class="item.severity === '阻断' ? 'error' : 'warn'">{{ item.severity }}</span>
            </td>
            <td>{{ item.metricName }}</td>
            <td>{{ item.kind }}</td>
            <td><code>{{ item.previousField || '—' }}</code> → <code>{{ item.nextField || '—' }}</code></td>
            <td>{{ item.affectedDownstream.join('、') || '无' }}</td>
            <td>{{ item.reason }}</td>
            <td>
              <span v-if="item.resolved" class="tag ok">已处理</span>
              <button v-else class="link" type="button" @click="resolve(item.itemId)">登记处理结果</button>
            </td>
          </tr>
          <tr v-if="!pendingCompat.length">
            <td colspan="7" class="empty-state">与上一版契约相比没有需要处理的兼容差异，可直接发布</td>
          </tr>
        </tbody>
      </table>
      <p v-if="blockingCount" class="hint error-text">
        仍有 {{ blockingCount }} 项阻断级差异未处理，发布按钮保持禁用。
      </p>
    </section>

    <section class="panel">
      <h3 class="panel-title">已发布契约（上游版本随契约冻结）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>契约</th>
            <th>汇总表</th>
            <th>冻结上游</th>
            <th>冻结维度／历史</th>
            <th>字段契约</th>
            <th>下游绑定</th>
            <th>上游现状</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="contract in published" :key="`${contract.contractId}@${contract.contractVersion}`">
            <td>
              <strong>{{ contract.contractId }}@{{ contract.contractVersion }}</strong>
              <small class="block">{{ contract.compiledAt }}</small>
            </td>
            <td>{{ contract.summaryTable }}</td>
            <td><code>{{ contract.upstream.table }}@{{ contract.upstream.version }}</code></td>
            <td>
              {{ contract.upstream.dimensions.join('、') }}
              <small class="block">历史 {{ contract.upstream.historyDays }} 天</small>
            </td>
            <td>
              <span v-for="field in contract.fields" :key="field.metricCode" class="field-chip">
                {{ field.field }}（{{ field.precision }}位{{ field.nullable ? '／可空' : '／非空' }}）
              </span>
            </td>
            <td>
              <span
                v-for="binding in bindingsOf(contract)"
                :key="binding.datasetCode"
                class="field-chip"
              >
                {{ binding.datasetCode }}：{{ formatFields(binding.boundFields) }}
              </span>
              <small v-if="!bindingsOf(contract).length" class="block">暂无下游绑定</small>
            </td>
            <td>
              <span v-if="!frozenDrift(contract).length" class="tag ok">未漂移</span>
              <span v-else class="tag warn">已漂移，口径不变</span>
              <small v-for="note in frozenDrift(contract)" :key="note" class="block warn-text">
                {{ note }}
              </small>
            </td>
          </tr>
          <tr v-if="!published.length">
            <td colspan="7" class="empty-state">该汇总主题尚未发布契约</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h3 class="panel-title">下游绑定与上游漂移验证</h3>
      <div class="compare-grid">
        <div>
          <h4>下游数据集绑定</h4>
          <ul class="plain-list">
            <li v-for="binding in topicBindings" :key="binding.datasetCode">
              <strong>{{ binding.datasetCode }}</strong>（{{ binding.application }}）
              <small class="block">
                绑定 {{ binding.boundContract }} · {{ formatFields(binding.boundFields) }}
              </small>
            </li>
            <li v-if="!topicBindings.length" class="muted-inline">当前主题暂无下游绑定</li>
          </ul>
        </div>
        <div>
          <h4>模拟上游后续调整</h4>
          <p class="hint">
            调度到 {{ topic.driftPlan.version }}：维度「{{ topic.driftPlan.dimensions.join('、') }}」、历史
            {{ topic.driftPlan.historyDays }} 天。已发布契约不会被改写，只有重新编译才会按新快照产出新契约。
          </p>
          <div class="page-actions">
            <button class="btn" type="button" @click="driftUpstream">模拟上游调整</button>
            <button v-if="upstreamDrifted" class="btn ghost" type="button" @click="restoreUpstream">
              恢复登记快照
            </button>
          </div>
        </div>
      </div>
    </section>

    <footer class="page-foot">
      <span>当前值班：{{ store.operator }} · 汇总层建模仍以汇总表字段契约为回看主对象</span>
    </footer>
    </template>

    <template v-else>
      <p v-if="registryNotice" class="notice" :class="registryKind">{{ registryNotice }}</p>
      <p class="hint">汇总表登记清单沿用模块原有状态流转；字段契约以上方「字段契约」页签为准。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in registryColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in registryRows" :key="String(row.id)">
            <td v-for="column in registryColumns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in registryActions"
                :key="action"
                class="link"
                type="button"
                @click="runRegistryAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!registryRows.length">
            <td :colspan="registryColumns.length + 2" class="empty-state">暂无汇总表登记数据</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ registryTotal }} 条汇总表登记记录</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  bindingListForContract,
  bindingsForTopic,
  blockingCompatCount,
  compatForPending,
  compileTopic,
  currentUpstream,
  downloadContractCsv,
  enqueueCompile,
  frozenDrift,
  listTopics,
  pendingContract,
  publishPending,
  publishedContracts,
  resolveCompat,
  restoreUpstream as restoreUpstreamSnapshot,
  simulateUpstreamDrift,
  sourceLabel,
  upstreamOverridden,
  type CompileDraft,
} from '@/api/contract-service'
import { resetContractState } from '@/data/contract-store'
import { listEntries, moduleMeta, runAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import type {
  CompatItem,
  DownstreamBinding,
  DwsTopic,
  PublishedContract,
  UpstreamSnapshot,
} from '@/data/dws-contract'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const topics: DwsTopic[] = listTopics()
const selectedTopicId = ref(topics[0].id)
const mode = ref<'contract' | 'registry'>('contract')

const draft = ref<CompileDraft>(compileTopic(selectedTopicId.value))
const pending = ref<PublishedContract | null>(pendingContract(selectedTopicId.value))
const pendingCompat = ref<CompatItem[]>(compatForPending(selectedTopicId.value))
const published = ref<PublishedContract[]>(
  publishedContracts(selectedTopicId.value).slice().reverse(),
)
const topicBindings = ref<DownstreamBinding[]>(bindingsForTopic(selectedTopicId.value))
const upstream = ref<UpstreamSnapshot>(currentUpstream(draft.value.topic.upstream.table))
const upstreamDrifted = ref(upstreamOverridden(draft.value.topic.upstream.table))

const notice = ref('')
const noticeKind = ref<'ok' | 'error'>('ok')

const topic = computed(() => draft.value.topic)
const compiledFields = computed(() => draft.value.fields.map((field) => field.field))
const blockingCount = computed(() => blockingCompatCount(selectedTopicId.value))
const canPublish = computed(
  () => Boolean(pending.value && pending.value.fields.length) && blockingCount.value === 0,
)

const statCards = computed(() => [
  { label: '汇总主题', value: topics.length },
  { label: '本主题已发布契约', value: published.value.length },
  { label: '待确认契约', value: pending.value ? 1 : 0 },
  { label: '待处理阻断差异', value: blockingCount.value },
])

function refresh() {
  draft.value = compileTopic(selectedTopicId.value)
  pending.value = pendingContract(selectedTopicId.value)
  pendingCompat.value = compatForPending(selectedTopicId.value)
  published.value = publishedContracts(selectedTopicId.value).slice().reverse()
  topicBindings.value = bindingsForTopic(selectedTopicId.value)
  upstream.value = currentUpstream(draft.value.topic.upstream.table)
  upstreamDrifted.value = upstreamOverridden(draft.value.topic.upstream.table)
}

function selectTopic(topicId: string) {
  selectedTopicId.value = topicId
  notice.value = ''
  refresh()
}

function flash(message: string, kind: 'ok' | 'error' = 'ok') {
  notice.value = message
  noticeKind.value = kind}

function compile() {
  const outcome = enqueueCompile(selectedTopicId.value)
  flash(outcome.message, outcome.ok ? 'ok' : 'error')
  refresh()
}

function resolve(itemId: string) {
  const outcome = resolveCompat(selectedTopicId.value, itemId, store.operator)
  flash(outcome.message, outcome.ok ? 'ok' : 'error')
  refresh()
}

function publish() {
  const outcome = publishPending(selectedTopicId.value, store.operator)
  flash(outcome.message, outcome.ok ? 'ok' : 'error')
  refresh()
}

function driftUpstream() {
  const outcome = simulateUpstreamDrift(topic.value.upstream.table, topic.value.driftPlan)
  flash(outcome.message, outcome.ok ? 'ok' : 'error')
  refresh()
}

function restoreUpstream() {
  const outcome = restoreUpstreamSnapshot(topic.value.upstream.table)
  flash(outcome.message, outcome.ok ? 'ok' : 'error')
  refresh()
}

function exportCsv() {
  downloadContractCsv(selectedTopicId.value)
}

function resetAll() {
  resetContractState()
  flash('已恢复示例契约数据', 'ok')
  refresh()
}

function bindingsOf(contract: PublishedContract) {
  return bindingListForContract(contract)
}

function changeTone(kind: string) {
  if (kind === '不变' || kind === '首次编译') return 'muted'
  if (kind === '新增字段') return 'ok'
  return 'warn'
}

function formatFields(fields: Record<string, string>) {
  return Object.entries(fields)
    .map(([metric, field]) => `${metric} → ${field}`)
    .join('、')
}

// ---- 汇总表登记清单（保留模块原有列表与状态流转） ----
const registryMeta = moduleMeta('dws')
const registryColumns = registryMeta.fields
const registryActions = registryMeta.actions
const registryRows = ref<EntryRow[]>([])
const registryTotal = ref(0)
const registryNotice = ref('')
const registryKind = ref<'ok' | 'error'>('error')

function loadRegistry() {
  const payload = listEntries(registryMeta.key)
  registryRows.value = payload.items
  registryTotal.value = payload.total
}

function runRegistryAction(action: string, row: EntryRow) {
  const result = runAction(registryMeta.key, Number(row.id), action)
  registryNotice.value = result.message
  registryKind.value = result.ok ? 'ok' : 'error'
  loadRegistry()
}

onMounted(() => {
  refresh()
  loadRegistry()
})
</script>
