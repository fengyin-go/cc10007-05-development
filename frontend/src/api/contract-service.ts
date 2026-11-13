/**
 * 汇总层建模 → 应用层字段契约：编译、冻结与兼容差异。
 *
 * 判定口径固定为「范围 + 条件 + 标准」三者同时成立：
 * - 范围：规则的渠道范围与聚合维度必须覆盖当前汇总主题；
 * - 条件：规则条件在主题的当前上下文里必须全部为真；
 * - 标准：精度、空值策略、单位与质量阈值必须符合度量定义与主题阈值。
 *
 * 同一度量有多条规则同时成立时按固定优先级裁决：
 * 来源层级（主题口径登记 > 应用层补充规则 > 历史迁移脚本）
 * → 规则优先级 → 版本号。裁决结果不隐藏落选来源，供页面展示冲突。
 */

import { contractState, saveContractState, subscribeContractState } from '@/data/contract-store'
import {
  CONTRACT_RULES,
  DWS_TOPICS,
  RULE_SOURCES,
  UPSTREAM_SNAPSHOTS,
  type CompatItem,
  type CompatKind,
  type ContractFieldSnapshot,
  type ContractRule,
  type DownstreamBinding,
  type DwsTopic,
  type PublishedContract,
  type RuleCondition,
  type RuleSource,
  type UpstreamSnapshot,
} from '@/data/dws-contract'

export type RuleEvaluation = {
  rule: ContractRule
  inScope: boolean
  conditionsMet: boolean
  standardMet: boolean
  applied: boolean
  scopeNote: string
  conditionNote: string
  standardNote: string
}

export type DraftField = {
  metricCode: string
  metricName: string
  field: string
  expression: string
  precision: number
  nullable: boolean
  unit: string
  ruleId: string
  ruleSource: RuleSource
  ruleVersion: string
  note: string
  changeKind: CompatKind | '不变' | '首次编译'
  previousField: string
  previousNote: string
}

export type MetricOutcome = {
  metricCode: string
  metricName: string
  winnerRuleId: string
  evaluations: RuleEvaluation[]
  conflict: boolean
  conflictReason: string
}

export type CompileDraft = {
  topic: DwsTopic
  upstream: UpstreamSnapshot
  evaluations: RuleEvaluation[]
  metricOutcomes: MetricOutcome[]
  fields: DraftField[]
  warnings: string[]
  driftNotes: string[]
  compiledKey: string
}

export type ActionOutcome = { ok: boolean; message: string; draft?: CompileDraft }

function topicById(topicId: string): DwsTopic {
  const topic = DWS_TOPICS.find((item) => item.id === topicId)
  if (!topic) {
    throw new Error(`没有登记汇总主题 ${topicId}`)
  }
  return topic
}

export function listTopics(): DwsTopic[] {
  return DWS_TOPICS
}

export function topicByIdOrThrow(topicId: string): DwsTopic {
  return topicById(topicId)
}

export function currentUpstream(table: string): UpstreamSnapshot {
  const override = contractState().upstreamOverrides[table]
  if (override) {
    return override
  }
  const snapshot = UPSTREAM_SNAPSHOTS.find((item) => item.table === table)
  if (!snapshot) {
    throw new Error(`上游 ${table} 缺少元数据快照`)
  }
  return snapshot
}

export type UpstreamDriftPlan = { version: string; dimensions: string[]; historyDays: number }

/**
 * 模拟上游治理系统在契约发布之后调整维度/历史天数。
 * 只改「当前上游元数据」，已发布契约里的 upstream 快照保持原样。
 */
export function simulateUpstreamDrift(
  table: string,
  plan: UpstreamDriftPlan,
): ActionOutcome {
  const state = contractState()
  const base = currentUpstream(table)
  const next: UpstreamSnapshot = {
    ...base,
    version: plan.version,
    dimensions: [...plan.dimensions],
    historyDays: plan.historyDays,
  }
  saveContractState({
    ...state,
    upstreamOverrides: { ...state.upstreamOverrides, [table]: next },
  })
  return {
    ok: true,
    message: `上游 ${table} 已调整为 ${next.version}：维度「${next.dimensions.join(
      '、',
    )}」，历史 ${next.historyDays} 天。已发布契约仍冻结原快照`,
  }
}

export function restoreUpstream(table: string): ActionOutcome {
  const state = contractState()
  const overrides = { ...state.upstreamOverrides }
  if (!overrides[table]) {
    return { ok: false, message: `上游 ${table} 没有模拟漂移记录` }
  }
  delete overrides[table]
  saveContractState({ ...state, upstreamOverrides: overrides })
  return { ok: true, message: `上游 ${table} 已恢复到登记快照` }
}

export function upstreamOverridden(table: string): boolean {
  return Boolean(contractState().upstreamOverrides[table])
}

function conditionText(condition: RuleCondition): string {
  const opLabel = condition.op === 'eq' ? '=' : condition.op === 'gte' ? '≥' : '≤'
  return `${condition.field} ${opLabel} ${condition.value}`
}

function evaluate(topic: DwsTopic, rule: ContractRule): RuleEvaluation {
  const channelOk =
    rule.scope.channels.includes(topic.channelScope) || rule.scope.channels.includes('全部渠道')
  const missingDimensions = topic.dimensions.filter(
    (dimension) => !rule.scope.dimensions.includes(dimension),
  )
  const inScope = channelOk && missingDimensions.length === 0
  const scopeNote = inScope
    ? `渠道「${topic.channelScope}」与维度「${topic.dimensions.join('、')}」均在规则范围内`
    : [
        channelOk ? '' : `渠道「${topic.channelScope}」不在规则范围`,
        missingDimensions.length ? `维度缺少「${missingDimensions.join('、')}」` : '',
      ]
        .filter(Boolean)
        .join('；')

  const conditionMisses = rule.conditions.filter((condition) => {
    const actual = topic.conditionContext[condition.field]
    if (actual === undefined) {
      return true
    }
    if (condition.op === 'eq') {
      return String(actual) !== String(condition.value)
    }
    const left = Number(actual)
    const right = Number(condition.value)
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return true
    }
    return condition.op === 'gte' ? left < right : left > right
  })
  const conditionsMet = conditionMisses.length === 0
  const conditionNote = conditionsMet
    ? `条件「${rule.conditions.map(conditionText).join(' 且 ') || '无'}」均成立`
    : `条件不成立：${conditionMisses
        .map(
          (item) =>
            `${conditionText(item)}（当前 ${topic.conditionContext[item.field] ?? '未提供'}）`,
        )
        .join('、')}`

  const metric = topic.metrics.find((item) => item.code === rule.metricCode)
  const issues: string[] = []
  if (metric) {
    if (rule.precision < metric.minPrecision) {
      issues.push(`精度 ${rule.precision} 位低于度量要求的 ${metric.minPrecision} 位`)
    }
    if (rule.precision !== rule.standards.precision) {
      issues.push('规则标准中的精度与产出口径不一致')
    }
    if (rule.nullable !== (rule.standards.nullPolicy !== '不允许空值')) {
      issues.push(`空值策略「${rule.standards.nullPolicy}」与字段可空标识不一致`)
    }
    if (rule.standards.errorThreshold > topic.qualityThreshold.errorThreshold) {
      issues.push(
        `错误率阈值 ${rule.standards.errorThreshold}${topic.qualityThreshold.unit} 超过主题阈值 ${topic.qualityThreshold.errorThreshold}${topic.qualityThreshold.unit}`,
      )
    }
    if (rule.unit !== metric.unit) {
      issues.push(`单位「${rule.unit}」与度量单位「${metric.unit}」不一致`)
    }
  }
  const standardMet = inScope && conditionsMet && issues.length === 0
  const standardNote = issues.length
    ? `标准不成立：${issues.join('；')}`
    : `精度 ${rule.precision} 位、${
        rule.nullable ? '允许空值' : '不允许空值'
      }、错误率阈值 ${rule.standards.errorThreshold}${topic.qualityThreshold.unit} 均符合要求`

  return {
    rule,
    inScope,
    conditionsMet,
    standardMet,
    applied: inScope && conditionsMet && standardMet,
    scopeNote,
    conditionNote,
    standardNote,
  }
}

function versionRank(version: string): number {
  const parsed = Number(version.replace(/[^0-9]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function pickWinner(evaluations: RuleEvaluation[]): RuleEvaluation | null {
  if (evaluations.length === 0) {
    return null
  }
  return [...evaluations].sort((a, b) => {
    if (a.rule.sourceTier !== b.rule.sourceTier) {
      return a.rule.sourceTier - b.rule.sourceTier
    }
    if (a.rule.priority !== b.rule.priority) {
      return b.rule.priority - a.rule.priority
    }
    return versionRank(b.rule.version) - versionRank(a.rule.version)
  })[0]
}

export function latestPublished(topicId: string): PublishedContract | null {
  const list = contractState().published.filter((item) => item.topicId === topicId)
  return list.length ? list[list.length - 1] : null
}

export function publishedContracts(topicId: string): PublishedContract[] {
  return contractState().published.filter((item) => item.topicId === topicId)
}

function changeKindOf(
  previous: PublishedContract | null,
  rule: ContractRule,
): Pick<DraftField, 'changeKind' | 'previousField' | 'previousNote'> {
  if (!previous) {
    return { changeKind: '首次编译', previousField: '', previousNote: '' }
  }
  const old = previous.fields.find((item) => item.metricCode === rule.metricCode)
  if (!old) {
    return {
      changeKind: '新增字段',
      previousField: '',
      previousNote: '上一版契约未包含该度量，本次新增输出字段',
    }
  }
  if (old.field !== rule.outputField) {
    return {
      changeKind: '字段改名',
      previousField: old.field,
      previousNote: `上一版字段为 ${old.field}，仅改名，精度与空值语义不变`,
    }
  }
  if (old.precision !== rule.precision) {
    return {
      changeKind: '精度变化',
      previousField: old.field,
      previousNote: `精度由 ${old.precision} 位改为 ${rule.precision} 位`,
    }
  }
  if (old.nullable !== rule.nullable) {
    return {
      changeKind: '空值语义变化',
      previousField: old.field,
      previousNote: `空值语义由「${old.nullable ? '可空' : '非空'}」改为「${
        rule.nullable ? '可空' : '非空'
      }」`,
    }
  }
  if (old.expression !== rule.expression || old.ruleVersion !== rule.version) {
    return {
      changeKind: '口径变化',
      previousField: old.field,
      previousNote: `口径由 ${old.ruleVersion}（${old.expression}）调整为 ${rule.version}（${rule.expression}）`,
    }
  }
  return {
    changeKind: '不变',
    previousField: old.field,
    previousNote: '字段名、精度、空值语义与口径均与上一版一致',
  }
}

function driftNotesOf(topic: DwsTopic, upstream: UpstreamSnapshot): string[] {
  const notes: string[] = []
  const missing = topic.dimensions.filter((item) => !upstream.dimensions.includes(item))
  const extra = upstream.dimensions.filter((item) => !topic.dimensions.includes(item))
  if (missing.length || extra.length) {
    notes.push(
      `上游 ${upstream.table} 当前维度「${upstream.dimensions.join('、')}」与汇总主题「${topic.dimensions.join('、')}」${
        missing.length ? `缺少 ${missing.join('、')}` : ''
      }${missing.length && extra.length ? '，' : ''}${extra.length ? `多出 ${extra.join('、')}` : ''}`,
    )
  }
  if (upstream.historyDays !== topic.historyDays) {
    notes.push(
      `上游 ${upstream.table} 当前历史天数 ${upstream.historyDays} 天，与汇总主题登记的 ${topic.historyDays} 天不一致`,
    )
  }
  return notes
}

/** 纯函数编译：相同主题 + 相同上游快照 + 相同规则判定 → 相同 compiledKey。 */
export function compileTopic(topicId: string): CompileDraft {
  const topic = topicById(topicId)
  const upstream = currentUpstream(topic.upstream.table)
  const evaluations = CONTRACT_RULES.filter((rule) =>
    topic.metrics.some((metric) => metric.code === rule.metricCode),
  ).map((rule) => evaluate(topic, rule))

  const previous = latestPublished(topicId)
  const fields: DraftField[] = []
  const metricOutcomes: MetricOutcome[] = []
  const warnings: string[] = []

  for (const metric of topic.metrics) {
    const relevant = evaluations.filter((item) => item.rule.metricCode === metric.code)
    const applied = relevant.filter((item) => item.applied)
    const winner = pickWinner(applied)
    if (!winner) {
      warnings.push(
        `度量「${metric.name}」没有同时满足范围、条件与标准的规则${
          relevant.length ? `（已登记 ${relevant.length} 条规则，均不适用）` : '（暂无登记规则）'
        }，本次不产出字段`,
      )
      metricOutcomes.push({
        metricCode: metric.code,
        metricName: metric.name,
        winnerRuleId: '',
        evaluations: relevant,
        conflict: false,
        conflictReason: '无适用规则',
      })
      continue
    }
    const losers = applied.filter((item) => item.rule.ruleId !== winner.rule.ruleId)
    metricOutcomes.push({
      metricCode: metric.code,
      metricName: metric.name,
      winnerRuleId: winner.rule.ruleId,
      evaluations: relevant,
      conflict: losers.length > 0,
      conflictReason: losers.length
        ? `同时命中 ${applied.length} 条规则，按来源层级 ${winner.rule.sourceTier} → 优先级 ${winner.rule.priority} → 版本 ${winner.rule.version} 选用 ${winner.rule.ruleId}；落选：${losers
            .map(
              (item) =>
                `${item.rule.ruleId}（${item.rule.source}，tier ${item.rule.sourceTier}，优先级 ${item.rule.priority}，${item.rule.version}）`,
            )
            .join('、')}`
        : '',
    })
    const change = changeKindOf(previous, winner.rule)
    fields.push({
      metricCode: metric.code,
      metricName: metric.name,
      field: winner.rule.outputField,
      expression: winner.rule.expression,
      precision: winner.rule.precision,
      nullable: winner.rule.nullable,
      unit: winner.rule.unit,
      ruleId: winner.rule.ruleId,
      ruleSource: winner.rule.source,
      ruleVersion: winner.rule.version,
      note: winner.rule.note,
      ...change,
    })
  }

  const compiledKey = [
    topic.id,
    topic.summaryTable,
    upstream.version,
    upstream.dimensions.join(','),
    upstream.historyDays,
    topic.dimensions.join(','),
    fields
      .map(
        (field) =>
          `${field.metricCode}:${field.ruleId}:${field.field}:${field.precision}:${field.nullable}`,
      )
      .join(','),
  ].join('|')

  return {
    topic,
    upstream,
    evaluations,
    metricOutcomes,
    fields,
    warnings,
    driftNotes: driftNotesOf(topic, upstream),
    compiledKey,
  }
}

function timestamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`
}

function nextContractIdentity(topicId: string): { contractId: string; contractVersion: string } {
  const state = contractState()
  const existing = state.published.filter((item) => item.topicId === topicId).length
  const allContracts = [...state.published, ...Object.values(state.pending)]
  const maxId = allContracts.reduce((max, item) => {
    const parsed = Number(item.contractId.replace(/[^0-9]/g, ''))
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max
  }, 0)
  return {
    contractId: `CTR-${String(maxId + 1).padStart(4, '0')}`,
    contractVersion: `v${existing + 1}`,
  }
}

function toSnapshot(field: DraftField): ContractFieldSnapshot {
  return {
    metricCode: field.metricCode,
    metricName: field.metricName,
    field: field.field,
    expression: field.expression,
    precision: field.precision,
    nullable: field.nullable,
    unit: field.unit,
    ruleId: field.ruleId,
    ruleSource: field.ruleSource,
    ruleVersion: field.ruleVersion,
  }
}

function contractOfDraft(
  topicId: string,
  draft: CompileDraft,
  compiledKey: string,
): PublishedContract {
  const identity = nextContractIdentity(topicId)
  return {
    contractId: identity.contractId,
    contractVersion: identity.contractVersion,
    topicId: draft.topic.id,
    summaryTable: draft.topic.summaryTable,
    topicName: draft.topic.name,
    compiledKey,
    compiledAt: timestamp(),
    upstream: { ...draft.upstream },
    fields: draft.fields.map(toSnapshot),
  }
}

const CHANGE_REASON: Record<CompatKind, (field: DraftField, previous: PublishedContract) => string> = {
  字段改名: (field) =>
    `字段由 ${field.previousField} 改名为 ${field.field}，仍绑定旧字段的下游会读不到数据`,
  精度变化: (field, previous) =>
    `精度由上一版 ${
      previous.fields.find((item) => item.metricCode === field.metricCode)?.precision
    } 位改为 ${field.precision} 位，「${field.metricName}」下游的对账口径会变化`,
  空值语义变化: (field, previous) =>
    `空值语义由「${
      previous.fields.find((item) => item.metricCode === field.metricCode)?.nullable ? '可空' : '非空'
    }」改为「${field.nullable ? '可空' : '非空'}」，下游空值兜底逻辑需重新确认`,
  口径变化: (field, previous) =>
    `计算口径由 ${
      previous.fields.find((item) => item.metricCode === field.metricCode)?.ruleVersion
    } 调整为 ${field.ruleVersion}，字段名与精度不变但含义已改变`,
  新增字段: (field) => `新契约新增「${field.metricName}」字段 ${field.field}，需下游显式绑定`,
  字段下线: (field) => `字段 ${field.previousField} 在新契约中不再产出，下游必须先解除绑定才能发布`,
}

function buildCompatItems(
  topicId: string,
  contractId: string,
  draft: CompileDraft,
  previous: PublishedContract | null,
): CompatItem[] {
  if (!previous) {
    return []
  }
  const currentKey = `${previous.contractId}@${previous.contractVersion}`
  const activeBindings = contractState().bindings.filter(
    (binding) => binding.boundContract === currentKey,
  )
  const items: CompatItem[] = []

  for (const field of draft.fields) {
    if (field.changeKind === '不变' || field.changeKind === '首次编译') {
      continue
    }
    const affected = affectedDownstreamOf(activeBindings, field.metricCode)
    // 只有下游确实绑定旧字段时才阻断；无下游绑定时保留为待确认提示，不静默丢弃。
    const severity: CompatItem['severity'] =
      field.changeKind === '新增字段' || affected.length === 0 ? '提示' : '阻断'
    items.push({
      itemId: `${contractId}-${field.metricCode}`,
      topicId,
      contractId,
      severity,
      kind: field.changeKind,
      metricCode: field.metricCode,
      metricName: field.metricName,
      previousField: field.previousField,
      nextField: field.field,
      affectedDownstream: affected,
      reason: CHANGE_REASON[field.changeKind](field, previous),
      resolved: false,
      resolvedBy: '',
      resolvedAt: '',
    })
  }

  for (const old of previous.fields) {
    if (draft.fields.some((field) => field.metricCode === old.metricCode)) {
      continue
    }
    const affected = affectedDownstreamOf(activeBindings, old.metricCode)
    items.push({
      itemId: `${contractId}-${old.metricCode}-drop`,
      topicId,
      contractId,
      severity: affected.length ? '阻断' : '提示',
      kind: '字段下线',
      metricCode: old.metricCode,
      metricName: old.metricName,
      previousField: old.field,
      nextField: '',
      affectedDownstream: affected,
      reason: `字段 ${old.field} 在新契约中不再产出${
        affected.length ? `，下游 ${affected.join('、')} 仍绑定该字段` : '，下游无绑定'
      }`,
      resolved: false,
      resolvedBy: '',
      resolvedAt: '',
    })
  }

  const drift = driftCompatItem(topicId, contractId, draft, previous)
  if (drift) {
    items.push(drift)
  }

  return items
}

function affectedDownstreamOf(bindings: DownstreamBinding[], metricCode: string): string[] {
  return bindings
    .filter((binding) => Object.prototype.hasOwnProperty.call(binding.boundFields, metricCode))
    .map((binding) => binding.datasetCode)
}

function driftCompatItem(
  topicId: string,
  contractId: string,
  draft: CompileDraft,
  previous: PublishedContract,
): CompatItem | null {
  const upstream = draft.upstream
  const frozen = previous.upstream
  if (
    upstream.version === frozen.version &&
    upstream.historyDays === frozen.historyDays &&
    upstream.dimensions.join(',') === frozen.dimensions.join(',')
  ) {
    return null
  }
  return {
    itemId: `${contractId}-upstream-drift`,
    topicId,
    contractId,
    severity: '提示',
    kind: '口径变化',
    metricCode: '*',
    metricName: '上游快照',
    previousField: `${frozen.table}@${frozen.version}`,
    nextField: `${upstream.table}@${upstream.version}`,
    affectedDownstream: [],
    reason: `上游 ${upstream.table} 当前口径（维度「${upstream.dimensions.join('、')}」／历史 ${
      upstream.historyDays
    } 天）与上一版冻结口径（维度「${frozen.dimensions.join('、')}」／历史 ${
      frozen.historyDays
    } 天）不同；新契约将按当前快照冻结，旧契约字段口径不随之改变`,
    resolved: false,
    resolvedBy: '',
    resolvedAt: '',
  }
}

/** 编译并入队。同一 compiledKey 重复执行只产生一份待确认结果。 */
export function enqueueCompile(topicId: string): ActionOutcome {
  const draft = compileTopic(topicId)
  const state = contractState()
  const current = state.pending[topicId]

  if (current && current.compiledKey === draft.compiledKey) {
    return {
      ok: true,
      message: `同一输入已在待确认队列中：${current.contractId}@${current.contractVersion}，本次未产生重复结果（编译幂等）`,
      draft,
    }
  }

  const previous = latestPublished(topicId)

  if (previous && draftChangesNothing(draft, previous)) {
    return {
      ok: true,
      message: `与已发布契约 ${previous.contractId}@${previous.contractVersion} 相比字段契约没有变化，无需生成新的待确认结果`,
      draft,
    }
  }

  const next = contractOfDraft(topicId, draft, draft.compiledKey)
  const compatItems = buildCompatItems(topicId, next.contractId, draft, previous)
  const keptCompat = state.compat.filter(
    (item) => item.topicId !== topicId || item.resolved || item.archived,
  )
  saveContractState({
    ...state,
    pending: { ...state.pending, [topicId]: next },
    compat: [...keptCompat, ...compatItems],
  })
  const blocking = compatItems.filter((item) => item.severity === '阻断').length
  return {
    ok: true,
    message: `${current ? '输入已变化，旧待确认结果被替换；' : ''}编译完成，生成待确认契约 ${
      next.contractId
    }@${next.contractVersion}${
      blocking ? `，含 ${blocking} 项阻断级兼容差异` : ''
    }`,
    draft,
  }
}

/** 编译结果与上一版已发布契约相比是否没有任何字段或上游快照变化。 */
function draftChangesNothing(draft: CompileDraft, previous: PublishedContract): boolean {
  const upstreamSame =
    draft.upstream.version === previous.upstream.version &&
    draft.upstream.historyDays === previous.upstream.historyDays &&
    draft.upstream.dimensions.join(',') === previous.upstream.dimensions.join(',')
  return (
    upstreamSame &&
    draft.fields.length > 0 &&
    draft.fields.every(
      (field) => field.changeKind === '不变' || field.changeKind === '首次编译',
    )
  )
}

export function pendingContract(topicId: string): PublishedContract | null {
  return contractState().pending[topicId] ?? null
}

export function compatForPending(topicId: string): CompatItem[] {
  const state = contractState()
  const pending = state.pending[topicId]
  if (!pending) {
    return []
  }
  return state.compat.filter(
    (item) => item.topicId === topicId && item.contractId === pending.contractId,
  )
}

export function resolveCompat(topicId: string, itemId: string, operator: string): ActionOutcome {
  const state = contractState()
  const item = state.compat.find((entry) => entry.itemId === itemId && entry.topicId === topicId)
  if (!item) {
    return { ok: false, message: '没有找到该兼容差异，可能已被处理' }
  }
  if (item.resolved) {
    return { ok: false, message: '该兼容差异已处理，无需重复确认' }
  }
  saveContractState({
    ...state,
    compat: state.compat.map((entry) =>
      entry.itemId === itemId
        ? { ...entry, resolved: true, resolvedBy: operator, resolvedAt: timestamp() }
        : entry,
    ),
  })
  return {
    ok: true,
    message: `已登记「${item.metricName}／${item.kind}」的处理结果，兼容责任由 ${operator} 确认`,
  }
}

export function publishPending(topicId: string, operator: string): ActionOutcome {
  const state = contractState()
  const pending = state.pending[topicId]
  if (!pending) {
    return { ok: false, message: '当前汇总主题没有待确认的编译结果，请先执行编译' }
  }
  if (!pending.fields.length) {
    return { ok: false, message: '待确认契约没有可发布字段，请先修正口径规则' }
  }
  const compat = state.compat.filter(
    (item) => item.topicId === topicId && item.contractId === pending.contractId,
  )
  const blockers = compat.filter((item) => item.severity === '阻断' && !item.resolved)
  if (blockers.length) {
    return {
      ok: false,
      message: `仍有 ${blockers.length} 项阻断级兼容差异未处理，不能发布：${blockers
        .map((item) => `${item.metricName}／${item.kind}`)
        .join('、')}`,
    }
  }

  const previous = latestPublished(topicId)
  const previousKey = previous ? `${previous.contractId}@${previous.contractVersion}` : ''
  const resolvedItems = compat.filter((item) => item.severity === '阻断' && item.resolved)
  const fieldByMetric = new Map(pending.fields.map((field) => [field.metricCode, field]))
  const bindings = state.bindings.map((binding) => {
    if (!previous || binding.boundContract !== previousKey) {
      return binding
    }
    let touched = false
    const boundFields = { ...binding.boundFields }
    for (const item of resolvedItems) {
      if (boundFields[item.metricCode] !== item.previousField) {
        continue
      }
      const nextField = fieldByMetric.get(item.metricCode)
      if (!nextField) {
        delete boundFields[item.metricCode]
      } else {
        boundFields[item.metricCode] = nextField.field
      }
      touched = true
    }
    return touched
      ? {
          ...binding,
          boundContract: `${pending.contractId}@${pending.contractVersion}`,
          boundFields,
        }
      : binding
  })

  const nextPending = { ...state.pending }
  delete nextPending[topicId]
  saveContractState({
    ...state,
    published: [...state.published, { ...pending }],
    bindings,
    pending: nextPending,
    // 兼容差异作为变更凭据保留；发布后不再阻断，仅记录处理结果
    compat: state.compat.map((item) =>
      item.topicId === topicId && item.contractId === pending.contractId && !item.resolved
        ? { ...item, archived: true }
        : item,
    ),
  })
  return {
    ok: true,
    message: `${pending.topicName} 字段契约 ${pending.contractId}@${pending.contractVersion} 已发布，上游 ${pending.upstream.table}@${pending.upstream.version}（历史 ${pending.upstream.historyDays} 天）随契约冻结；确认人：${operator}`,
  }
}

/** 已发布契约与其冻结上游的漂移检查：旧契约口径不因上游变化而改变。 */
export function frozenDrift(contract: PublishedContract): string[] {
  const topic = topicById(contract.topicId)
  const upstream = currentUpstream(topic.upstream.table)
  const notes: string[] = []
  if (upstream.version !== contract.upstream.version) {
    notes.push(
      `当前上游已到 ${upstream.version}，本契约仍冻结在 ${contract.upstream.version}`,
    )
  }
  if (upstream.historyDays !== contract.upstream.historyDays) {
    notes.push(
      `上游当前历史天数 ${upstream.historyDays} 天，本契约冻结口径为 ${contract.upstream.historyDays} 天`,
    )
  }
  if (upstream.dimensions.join(',') !== contract.upstream.dimensions.join(',')) {
    notes.push(
      `上游当前维度「${upstream.dimensions.join('、')}」，本契约冻结维度「${contract.upstream.dimensions.join('、')}」`,
    )
  }
  return notes
}

export function bindingListForContract(contract: PublishedContract): DownstreamBinding[] {
  const key = `${contract.contractId}@${contract.contractVersion}`
  return contractState().bindings.filter((binding) => binding.boundContract === key)
}

/** 按汇总主题聚合下游绑定：包含该主题已发布与待确认契约的绑定。 */
export function bindingsForTopic(topicId: string): DownstreamBinding[] {
  const state = contractState()
  const keys = new Set(
    [...state.published, ...Object.values(state.pending)]
      .filter((item) => item.topicId === topicId)
      .map((item) => `${item.contractId}@${item.contractVersion}`),
  )
  return state.bindings.filter((binding) => keys.has(binding.boundContract))
}

export type DatasetConsumption = {
  binding: DownstreamBinding
  contract: PublishedContract | null
  fields: { metricCode: string; metricName: string; field: string; precision: number; nullable: boolean }[]
  drift: string[]
}

/** 应用层视角：所有应用数据集消费了哪些字段契约、绑定了什么字段。 */
export function datasetConsumption(datasetCode?: string): DatasetConsumption[] {
  const state = contractState()
  return state.bindings
    .filter((binding) => !datasetCode || binding.datasetCode === datasetCode)
    .map((binding) => {
      const [contractId, version] = binding.boundContract.split('@')
      const contract =
        state.published.find(
          (item) => item.contractId === contractId && item.contractVersion === version,
        ) ?? null
      const fields = contract
        ? Object.entries(binding.boundFields).map(([metricCode, field]) => {
            const snapshot = contract.fields.find((item) => item.metricCode === metricCode)
            return {
              metricCode,
              metricName: snapshot?.metricName ?? metricCode,
              field,
              precision: snapshot?.precision ?? -1,
              nullable: snapshot?.nullable ?? false,
            }
          })
        : []
      const expected = contract?.fields.map((item) => item.field) ?? []
      const drift = fields
        .filter((item) => !expected.includes(item.field))
        .map(
          (item) =>
            `绑定字段 ${item.field} 不在契约 ${binding.boundContract} 中，可能存在旧含义字段`,
        )
      return { binding, contract, fields, drift }
    })
}

export function blockingCompatCount(topicId: string): number {
  return compatForPending(topicId).filter(
    (item) => item.severity === '阻断' && !item.resolved,
  ).length
}

export function sourceLabel(source: RuleSource): string {
  return RULE_SOURCES[source].label
}

export function exportContractCsv(topicId: string): { filename: string; content: string } {
  const draft = compileTopic(topicId)
  const header = [
    '汇总表',
    '汇总主题',
    '聚合维度',
    '上游明细表',
    '上游快照',
    '刷新周期',
    '应用数据集',
    '度量',
    '输出字段',
    '精度',
    '可空',
    '口径表达式',
    '规则编号',
    '规则来源',
    '规则版本',
  ]
  const lines = [header.join(',')]
  for (const field of draft.fields) {
    lines.push(
      [
        draft.topic.summaryTable,
        draft.topic.name,
        draft.topic.dimensions.join('|'),
        draft.topic.upstream.table,
        `${draft.upstream.version}（历史 ${draft.upstream.historyDays} 天）`,
        draft.topic.refreshCycle,
        `${draft.topic.ads.datasetCode}／${draft.topic.ads.outputTable}`,
        field.metricName,
        field.field,
        field.precision,
        field.nullable ? '可空' : '非空',
        field.expression,
        field.ruleId,
        field.ruleSource,
        field.ruleVersion,
      ].join(','),
    )
  }
  return {
    filename: `${draft.topic.summaryTable}-字段契约.csv`,
    content: `﻿${lines.join('\n')}`,
  }
}

export function downloadContractCsv(topicId: string): void {
  const { filename, content } = exportContractCsv(topicId)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/** 契约状态变化通知：应用层页面据此重新读取绑定关系。 */
export function onContractChange(listener: () => void): () => void {
  return subscribeContractState(listener)
}
