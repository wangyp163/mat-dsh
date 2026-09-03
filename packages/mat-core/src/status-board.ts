/**
 * HPC 后台作业状态板（纯内存，无 cordis/IO 依赖；时钟注入可测）。
 *
 * watch/gaussian producer 每 sacct 轮 upsert 实时状态，结算时 settle 写入
 * 终态与物性；web 插件经 HTTP 把 list() 快照喂给浏览器状态卡。UI 不得读
 * job_output（单消费游标归模型），状态板是前端唯一实时通道。
 */

/** post 透传的单条绘图产物（与 result.json plots 元素同形）。 */
export interface PlotEntry {
  kind: string
  /** PNG 路径；环境缺 matplotlib 时为 null（数据仍在 data CSV）。 */
  image: string | null
  data: string
}

/** 单个 slurm 作业在状态板里的投影（JSON-safe）。 */
export interface SlurmEntrySnapshot {
  id: string
  state: string
  exitCode?: number
  elapsedSeconds?: number
}

/** 一条 mat 后台作业的快照（/mat-status/jobs 载荷元素）。 */
export interface MatJobStatus {
  jobId: string
  /** 'mat-watch' | 'mat-slurm'（字符串不窄化，工具面可扩展新 kind）。 */
  kind: string
  label: string
  clusterId: string
  ownerSession?: string
  startedAt: number
  updatedAt: number
  phase: 'monitoring' | 'settled'
  task?: string
  workdir?: string
  /** Host-local workspace reserved for this job at submission time. */
  localWorkspace?: string
  partition?: string
  converged?: boolean
  slurm?: SlurmEntrySnapshot[]
  settledAt?: number
  outcomeStatus?: 'completed' | 'killed' | 'failed'
  detail?: string
  properties?: Record<string, unknown>
  files?: string[]
  plots?: PlotEntry[]
}

/** settle 一次写入的终态信息。 */
export interface StatusSettle {
  outcomeStatus: 'completed' | 'killed' | 'failed'
  converged?: boolean
  detail?: string
  properties?: Record<string, unknown>
  files?: string[]
  plots?: PlotEntry[]
}

/** upsert 增量补丁：首建须含 identity 字段（kind/label/clusterId/startedAt）。 */
export type StatusUpsert = Partial<Omit<MatJobStatus, 'jobId' | 'phase' | 'settledAt'>>

/** createStatusBoard 的注入依赖。 */
export interface StatusBoardOptions {
  /** 时钟（默认 Date.now）；测试注入固定时钟。 */
  now?: () => number
  /** settled 条目保留上限（默认 20，防无界增长；monitoring 永不裁剪）。 */
  maxSettled?: number
  /** 启动时恢复的 JSON-safe 快照。 */
  initialEntries?: MatJobStatus[]
  /** 状态变化后的旁路通知；不得影响状态板主流程。 */
  onChange?: (entries: MatJobStatus[]) => void
}

/** 状态板句柄。 */
export interface StatusBoard {
  /** 增量合并补丁并刷新 updatedAt；phase=settled 后不回退，只更新 slurm 等实时字段。 */
  upsert(jobId: string, patch: StatusUpsert): void
  /** 结算：合并终态信息，phase → settled；未知 jobId 抛错（暴露接线缺陷）。 */
  settle(jobId: string, settle: StatusSettle): void
  remove(jobId: string): void
  /** JSON-safe 快照（插入序）；返回拷贝，改返回值不影响板内。 */
  list(): MatJobStatus[]
}

/**
 * 创建状态板。settled 超出 maxSettled 时按 settledAt 移除最旧者。
 */
export function createStatusBoard(options: StatusBoardOptions = {}): StatusBoard {
  const now = options.now ?? Date.now
  const maxSettled = options.maxSettled ?? 20
  const entries = new Map<string, MatJobStatus>(
    (options.initialEntries ?? []).map((entry): [string, MatJobStatus] => [entry.jobId, {
      ...entry,
      slurm: entry.slurm?.map((item) => ({ ...item })),
    }]),
  )

  function snapshot(): MatJobStatus[] {
    return [...entries.values()].map((entry) => ({
      ...entry,
      slurm: entry.slurm?.map((item) => ({ ...item })),
    }))
  }

  function changed(): void {
    try { options.onChange?.(snapshot()) } catch { /* 旁路持久化失败不影响状态板 */ }
  }

  function pruneSettled(): void {
    const settledIds = [...entries.values()]
      .filter((e) => e.phase === 'settled' && e.jobId !== undefined)
      .sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0))
      .map((e) => e.jobId)
    for (const id of settledIds.slice(0, Math.max(0, settledIds.length - maxSettled))) {
      entries.delete(id)
    }
  }

  pruneSettled()

  return {
    upsert(jobId, patch) {
      const existing = entries.get(jobId)
      if (existing === undefined) {
        const updatedAt = now()
        entries.set(jobId, {
          jobId,
          kind: patch.kind ?? 'mat-watch',
          label: patch.label ?? jobId,
          clusterId: patch.clusterId ?? '',
          startedAt: patch.startedAt ?? updatedAt,
          updatedAt,
          phase: 'monitoring',
          ...clean(patch),
        })
        changed()
        return
      }
      // settled 后不复活：phase/settledAt/outcome 保持，其余字段照常合并
      const merged: MatJobStatus = {
        ...existing,
        ...clean(patch),
        phase: existing.phase,
        updatedAt: now(),
      }
      if (existing.phase === 'settled') {
        merged.settledAt = existing.settledAt
        merged.outcomeStatus = existing.outcomeStatus
        merged.detail = patch.detail ?? existing.detail
        merged.properties = existing.properties
        merged.files = existing.files
        merged.plots = existing.plots
      }
      entries.set(jobId, merged)
      changed()
    },

    settle(jobId, settle) {
      const existing = entries.get(jobId)
      if (existing === undefined) {
        throw new Error(`status-board: settle unknown job ${jobId}`)
      }
      const settledAt = now()
      entries.set(jobId, {
        ...existing,
        ...clean(settle),
        phase: 'settled',
        settledAt,
        updatedAt: settledAt,
      })
      pruneSettled()
      changed()
    },

    remove(jobId) {
      if (entries.delete(jobId)) changed()
    },

    list() {
      return snapshot()
    },
  }
}

/** 去掉 undefined 值的浅拷贝（合并时不下覆盖已有字段）。 */
function clean<T extends object>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) out[k] = v
  }
  return out as Partial<T>
}
