/**
 * 汇总层字段契约的领域数据。
 *
 * 汇总层建模是主对象：一个汇总主题把聚合维度、度量列、上游明细表与刷新周期
 * 编译成应用数据集可消费的字段契约。口径规则同时用「范围 / 条件 / 标准」判定，
 * 全部成立才算适用；同一度量被多来源规则命中时按固定的版本优先级裁决。
 */

export type RuleCondition = {
  field: string
  op: 'eq' | 'gte' | 'lte'
  value: string | number
}

export type RuleStandard = {
  errorThreshold: number
  precision: number
  nullPolicy: '不允许空值' | '允许空值' | '允许空值并说明原因'
}

export type RuleSource = '主题口径登记' | '应用层补充规则' | '历史迁移脚本'

export type ContractRule = {
  ruleId: string
  metricCode: string
  metricName: string
  source: RuleSource
  sourceTier: number
  version: string
  priority: number
  outputField: string
  expression: string
  precision: number
  nullable: boolean
  unit: string
  scope: {
    channels: string[]
    dimensions: string[]
  }
  conditions: RuleCondition[]
  standards: RuleStandard
  note: string
}

export type ContractMetric = {
  code: string
  name: string
  unit: string
  minPrecision: number
  defaultField: string
  description: string
}

export type DwsTopic = {
  id: string
  summaryTable: string
  name: string
  dimensions: string[]
  metrics: ContractMetric[]
  upstream: { table: string; name: string }
  refreshCycle: string
  historyDays: number
  channelScope: string
  conditionContext: Record<string, string | number>
  qualityThreshold: { errorThreshold: number; unit: string }
  ads: {
    datasetCode: string
    datasetName: string
    application: string
    outputTable: string
  }
  /** 用于验证「发布后上游调整不影响已冻结契约」的模拟漂移方案。 */
  driftPlan: { version: string; dimensions: string[]; historyDays: number }
}

export type UpstreamSnapshot = {
  table: string
  version: string
  dimensions: string[]
  historyDays: number
  refreshCycle: string
}

export type ContractFieldSnapshot = {
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
}

export type PublishedContract = {
  contractId: string
  contractVersion: string
  topicId: string
  summaryTable: string
  topicName: string
  compiledKey: string
  compiledAt: string
  upstream: UpstreamSnapshot
  fields: ContractFieldSnapshot[]
}

export type DownstreamBinding = {
  datasetCode: string
  datasetName: string
  application: string
  outputTable: string
  boundContract: string
  boundFields: Record<string, string>
}

export type CompatKind = '字段改名' | '精度变化' | '空值语义变化' | '口径变化' | '新增字段' | '字段下线'

export type CompatItem = {
  itemId: string
  topicId: string
  contractId: string
  severity: '阻断' | '提示'
  kind: CompatKind
  metricCode: string
  metricName: string
  previousField: string
  nextField: string
  affectedDownstream: string[]
  reason: string
  resolved: boolean
  resolvedBy: string
  resolvedAt: string
  /** 契约发布后，未确认的提示级差异作为历史凭据保留，不再计入待处理。 */
  archived?: boolean
}

export type ContractStore = {
  published: PublishedContract[]
  bindings: DownstreamBinding[]
  pending: Record<string, PublishedContract>
  compat: CompatItem[]
  /** 模拟上游治理系统后续调整：按表覆盖当前元数据快照。 */
  upstreamOverrides: Record<string, UpstreamSnapshot>
}

export const OPERATOR = '值班管理员'

export const RULE_SOURCES: Record<RuleSource, { tier: number; label: string }> = {
  主题口径登记: { tier: 1, label: '主题口径登记（平台主口径）' },
  应用层补充规则: { tier: 2, label: '应用层补充规则（应用方附加）' },
  历史迁移脚本: { tier: 3, label: '历史迁移脚本（仅作参考）' },
}

const GMV_TOPIC: DwsTopic = {
  id: 'topic-trade-gmv',
  summaryTable: 'dws_trade_gmv_di',
  name: '交易成交汇总',
  dimensions: ['日期', '渠道', '区域'],
  metrics: [
    {
      code: 'gmv',
      name: '成交金额',
      unit: '元',
      minPrecision: 2,
      defaultField: 'gmv_amt',
      description: '按支付完成时间归集的成交金额合计。',
    },
    {
      code: 'order_cnt',
      name: '成交订单数',
      unit: '笔',
      minPrecision: 0,
      defaultField: 'order_cnt',
      description: '去重后的成交订单笔数。',
    },
    {
      code: 'refund_amt',
      name: '退款金额',
      unit: '元',
      minPrecision: 2,
      defaultField: 'refund_amt',
      description: '统计窗口内发起的退款金额，按退款完成时间归集。',
    },
  ],
  upstream: { table: 'dwd_trade_order_detail', name: '交易订单明细' },
  refreshCycle: '每日 02:00',
  historyDays: 180,
  channelScope: '全部渠道',
  conditionContext: { 支付状态: '已支付', 质量错误率: 0.8 },
  qualityThreshold: { errorThreshold: 1, unit: '%' },
  ads: {
    datasetCode: 'ADS-SALES-DAILY',
    datasetName: '销售日报',
    application: '经营分析看板',
    outputTable: 'ads_sales_daily',
  },
  driftPlan: { version: 'v13', dimensions: ['日期', '渠道'], historyDays: 90 },
}

export const DWS_TOPICS: DwsTopic[] = [
  GMV_TOPIC,
  {
    id: 'topic-trade-refund',
    summaryTable: 'dws_trade_refund_di',
    name: '退款汇总',
    dimensions: ['日期', '退款渠道'],
    metrics: [
      {
        code: 'refund_amt',
        name: '退款金额',
        unit: '元',
        minPrecision: 2,
        defaultField: 'refund_amt',
        description: '统计窗口内完成的退款金额。',
      },
      {
        code: 'refund_cnt',
        name: '退款笔数',
        unit: '笔',
        minPrecision: 0,
        defaultField: 'refund_cnt',
        description: '统计窗口内完成的退款笔数。',
      },
    ],
    upstream: { table: 'dwd_trade_refund_detail', name: '退款明细' },
    refreshCycle: '每日 03:00',
    historyDays: 90,
    channelScope: '线上渠道',
    conditionContext: { 退款状态: '已完成', 质量错误率: 0.4 },
    qualityThreshold: { errorThreshold: 1, unit: '%' },
    ads: {
      datasetCode: 'ADS-REFUND-DAILY',
      datasetName: '退款日报',
      application: '售后运营看板',
      outputTable: 'ads_refund_daily',
    },
    driftPlan: { version: 'v8', dimensions: ['日期'], historyDays: 30 },
  },
  {
    id: 'topic-member-active',
    summaryTable: 'dws_member_active_di',
    name: '会员活跃汇总',
    dimensions: ['日期', '会员等级'],
    metrics: [
      {
        code: 'active_uv',
        name: '活跃用户数',
        unit: '人',
        minPrecision: 0,
        defaultField: 'active_uv',
        description: '当日有登录或下单行为的去重会员数。',
      },
      {
        code: 'avg_duration',
        name: '人均停留时长',
        unit: '秒',
        minPrecision: 1,
        defaultField: 'avg_duration_sec',
        description: '活跃会话停留时长均值，按会话去重后计算。',
      },
    ],
    upstream: { table: 'dwd_member_behavior_detail', name: '会员行为明细' },
    refreshCycle: '每日 04:00',
    historyDays: 365,
    channelScope: '全部渠道',
    conditionContext: { 质量错误率: 1.2 },
    qualityThreshold: { errorThreshold: 2, unit: '%' },
    ads: {
      datasetCode: 'ADS-MEMBER-DAILY',
      datasetName: '会员活跃日报',
      application: '会员运营看板',
      outputTable: 'ads_member_daily',
    },
    driftPlan: { version: 'v10', dimensions: ['日期'], historyDays: 30 },
  },
]

export const CONTRACT_RULES: ContractRule[] = [
  {
    ruleId: 'R-GMV-001',
    metricCode: 'gmv',
    metricName: '成交金额',
    source: '主题口径登记',
    sourceTier: 1,
    version: 'v2',
    priority: 100,
    outputField: 'gmv_amt',
    expression: "SUM(pay_amount) WHERE order_status = 'PAID'",
    precision: 2,
    nullable: false,
    unit: '元',
    scope: {
      channels: ['线上渠道', '线下渠道', '全部渠道'],
      dimensions: ['日期', '渠道', '区域'],
    },
    conditions: [
      { field: '支付状态', op: 'eq', value: '已支付' },
      { field: '质量错误率', op: 'lte', value: 1 },
    ],
    standards: { errorThreshold: 1, precision: 2, nullPolicy: '不允许空值' },
    note: '主口径：按支付完成时间归集，精度固定两位小数，不允许空值。',
  },
  {
    ruleId: 'R-GMV-002',
    metricCode: 'gmv',
    metricName: '成交金额',
    source: '应用层补充规则',
    sourceTier: 2,
    version: 'v2',
    priority: 60,
    outputField: 'gmv_amt_net',
    expression: "SUM(pay_amount - refund_amount) WHERE order_status = 'PAID'",
    precision: 2,
    nullable: false,
    unit: '元',
    scope: {
      channels: ['线上渠道', '全部渠道'],
      dimensions: ['日期', '渠道', '区域'],
    },
    conditions: [
      { field: '支付状态', op: 'eq', value: '已支付' },
      { field: '质量错误率', op: 'lte', value: 1 },
    ],
    standards: { errorThreshold: 0.5, precision: 2, nullPolicy: '不允许空值' },
    note: '经营看板曾要求的净成交额口径，扣减退款；与主口径不同名同义。',
  },
  {
    ruleId: 'R-GMV-003',
    metricCode: 'gmv',
    metricName: '成交金额',
    source: '历史迁移脚本',
    sourceTier: 3,
    version: 'v1',
    priority: 20,
    outputField: 'gmv_amt',
    expression: "SUM(order_amount) WHERE order_status IN ('PAID', 'SHIPPED')",
    precision: 0,
    nullable: true,
    unit: '元',
    scope: {
      channels: ['全部渠道'],
      dimensions: ['日期', '渠道', '区域'],
    },
    conditions: [
      { field: '支付状态', op: 'eq', value: '已支付' },
      { field: '质量错误率', op: 'lte', value: 2 },
    ],
    standards: { errorThreshold: 2, precision: 0, nullPolicy: '允许空值' },
    note: '旧脚本口径：把已发货订单也计入，精度取整并保留空值。',
  },
  {
    ruleId: 'R-ORDER-001',
    metricCode: 'order_cnt',
    metricName: '成交订单数',
    source: '主题口径登记',
    sourceTier: 1,
    version: 'v1',
    priority: 100,
    outputField: 'order_cnt',
    expression: "COUNT(DISTINCT order_id) WHERE order_status = 'PAID'",
    precision: 0,
    nullable: false,
    unit: '笔',
    scope: {
      channels: ['线上渠道', '线下渠道', '全部渠道'],
      dimensions: ['日期', '渠道', '区域'],
    },
    conditions: [
      { field: '支付状态', op: 'eq', value: '已支付' },
      { field: '质量错误率', op: 'lte', value: 1 },
    ],
    standards: { errorThreshold: 1, precision: 0, nullPolicy: '不允许空值' },
    note: '订单号去重计数，与成交金额使用同一支付状态条件。',
  },
  {
    ruleId: 'R-REFUND-001',
    metricCode: 'refund_amt',
    metricName: '退款金额',
    source: '主题口径登记',
    sourceTier: 1,
    version: 'v2',
    priority: 90,
    outputField: 'refund_amt',
    expression: "SUM(refund_amount) WHERE refund_status = 'DONE'",
    precision: 2,
    nullable: false,
    unit: '元',
    scope: {
      channels: ['线上渠道', '线下渠道', '全部渠道'],
      dimensions: ['日期', '退款渠道', '渠道', '区域'],
    },
    conditions: [{ field: '质量错误率', op: 'lte', value: 1 }],
    standards: { errorThreshold: 1, precision: 2, nullPolicy: '不允许空值' },
    note: '退款完成时间口径；升级到 v2 后要求空值补零，不再允许空值。',
  },
  {
    ruleId: 'R-REFUND-002',
    metricCode: 'refund_amt',
    metricName: '退款金额',
    source: '应用层补充规则',
    sourceTier: 2,
    version: 'v1',
    priority: 40,
    outputField: 'refund_amt_filled',
    expression: 'COALESCE(SUM(refund_amount), 0)',
    precision: 2,
    nullable: false,
    unit: '元',
    scope: { channels: ['线上渠道'], dimensions: ['日期'] },
    conditions: [{ field: '质量错误率', op: 'lte', value: 0.3 }],
    standards: { errorThreshold: 0.3, precision: 2, nullPolicy: '不允许空值' },
    note: '售后看板旧规则，只有日期维度；范围不覆盖汇总主题。',
  },
  {
    ruleId: 'R-REFUNDCNT-001',
    metricCode: 'refund_cnt',
    metricName: '退款笔数',
    source: '主题口径登记',
    sourceTier: 1,
    version: 'v1',
    priority: 100,
    outputField: 'refund_cnt',
    expression: "COUNT(DISTINCT refund_id) WHERE refund_status = 'DONE'",
    precision: 0,
    nullable: false,
    unit: '笔',
    scope: { channels: ['线上渠道', '全部渠道'], dimensions: ['日期', '退款渠道'] },
    conditions: [{ field: '退款状态', op: 'eq', value: '已完成' }],
    standards: { errorThreshold: 1, precision: 0, nullPolicy: '不允许空值' },
    note: '退款单号去重计数。',
  },
  {
    ruleId: 'R-ACTIVE-001',
    metricCode: 'active_uv',
    metricName: '活跃用户数',
    source: '主题口径登记',
    sourceTier: 1,
    version: 'v3',
    priority: 80,
    outputField: 'active_uv',
    expression: "COUNT(DISTINCT member_id) WHERE event_type IN ('LOGIN', 'ORDER')",
    precision: 0,
    nullable: false,
    unit: '人',
    scope: { channels: ['全部渠道'], dimensions: ['日期', '会员等级'] },
    conditions: [{ field: '质量错误率', op: 'lte', value: 2 }],
    standards: { errorThreshold: 2, precision: 0, nullPolicy: '不允许空值' },
    note: '按会员去重；行为明细延迟超过 2 小时不出数。',
  },
  {
    ruleId: 'R-AVG-001',
    metricCode: 'avg_duration',
    metricName: '人均停留时长',
    source: '主题口径登记',
    sourceTier: 1,
    version: 'v1',
    priority: 70,
    outputField: 'avg_duration_sec',
    expression: 'AVG(session_duration_sec)',
    precision: 1,
    nullable: true,
    unit: '秒',
    scope: { channels: ['全部渠道'], dimensions: ['日期', '会员等级'] },
    conditions: [{ field: '质量错误率', op: 'lte', value: 0.5 }],
    standards: { errorThreshold: 0.5, precision: 1, nullPolicy: '允许空值并说明原因' },
    note: '停留时长按会话去重后求均值；当前主题质量错误率超阈值，需先治理上游。',
  },
]

export const UPSTREAM_SNAPSHOTS: UpstreamSnapshot[] = [
  {
    table: 'dwd_trade_order_detail',
    version: 'v12',
    dimensions: ['日期', '渠道', '区域'],
    historyDays: 180,
    refreshCycle: '每日 02:00',
  },
  {
    table: 'dwd_trade_refund_detail',
    version: 'v7',
    dimensions: ['日期', '退款渠道'],
    historyDays: 90,
    refreshCycle: '每日 03:00',
  },
  {
    table: 'dwd_member_behavior_detail',
    version: 'v9',
    dimensions: ['日期', '会员等级', '城市等级'],
    historyDays: 365,
    refreshCycle: '每日 04:00',
  },
]

export const SEED_CONTRACT_STORE: ContractStore = {
  published: [
    {
      contractId: 'CTR-0001',
      contractVersion: 'v1',
      topicId: 'topic-trade-gmv',
      summaryTable: 'dws_trade_gmv_di',
      topicName: '交易成交汇总',
      compiledKey: 'topic-trade-gmv|v12|dws_trade_gmv_di|日期,渠道,区域|gmv,order_cnt,refund_amt|R-GMV-001,v2|R-ORDER-001,v1|R-REFUND-001,v1',
      compiledAt: '2026-10-20 10:15',
      upstream: {
        table: 'dwd_trade_order_detail',
        version: 'v12',
        dimensions: ['日期', '渠道', '区域'],
        historyDays: 180,
        refreshCycle: '每日 02:00',
      },
      fields: [
        {
          metricCode: 'gmv',
          metricName: '成交金额',
          field: 'gmv_amt',
          expression: "SUM(pay_amount) WHERE order_status = 'PAID'",
          precision: 2,
          nullable: false,
          unit: '元',
          ruleId: 'R-GMV-001',
          ruleSource: '主题口径登记',
          ruleVersion: 'v2',
        },
        {
          metricCode: 'order_cnt',
          metricName: '成交订单数',
          field: 'order_quantity',
          expression: "COUNT(DISTINCT order_id) WHERE order_status = 'PAID'",
          precision: 0,
          nullable: false,
          unit: '笔',
          ruleId: 'R-ORDER-001',
          ruleSource: '主题口径登记',
          ruleVersion: 'v1',
        },
        {
          metricCode: 'refund_amt',
          metricName: '退款金额',
          field: 'refund_amt',
          expression: "SUM(refund_amount) WHERE refund_status = 'DONE'",
          precision: 2,
          nullable: true,
          unit: '元',
          ruleId: 'R-REFUND-001',
          ruleSource: '主题口径登记',
          ruleVersion: 'v1',
        },
      ],
    },
  ],
  bindings: [
    {
      datasetCode: 'ADS-SALES-DAILY',
      datasetName: '销售日报',
      application: '经营分析看板',
      outputTable: 'ads_sales_daily',
      boundContract: 'CTR-0001@v1',
      boundFields: {
        gmv: 'gmv_amt',
        order_cnt: 'order_quantity',
        refund_amt: 'refund_amt',
      },
    },
    {
      datasetCode: 'ADS-FIN-RECON-DAILY',
      datasetName: '财务对账日报',
      application: '财务对账平台',
      outputTable: 'ads_fin_recon_daily',
      boundContract: 'CTR-0001@v1',
      boundFields: {
        gmv: 'gmv_amt',
        refund_amt: 'refund_amt',
      },
    },
  ],
  pending: {},
  compat: [],
  upstreamOverrides: {},
}
