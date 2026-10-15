/**
 * P0.5 golden task 集：任务级 harness 评测的任务定义（回放泳道）。
 *
 * 设计口径（docs/harness-engineering.md 第 8 节）：
 *   - prompt 是发给 headless 会话的原文（固定不动——golden 的意义就在不改题）；
 *   - fake 是本地回放泳道（scripts/eval-fake-mat.ts）的场景参数；
 *   - expect 是零 token 的机械判定：最终答复断言 + 工具面期望/禁止；
 *   - timeoutSec 兜底杀进程，防模型死循环拖垮整轮跑批。
 *
 * 断言动词刻意保守：只断言「正确行为必然出现/必然不出现」的形态，
 * 不锁措辞（模型换种说法不该红）。新增任务时同步更新本文件头部的场景说明。
 */

export interface GoldenTask {
  id: string
  /** 发给 headless 会话的任务原文。 */
  prompt: string
  /** fake HPC 场景：作业终态 + 状态机节拍。 */
  fake: {
    scenario: 'completed' | 'failed'
    /** sbatch 后 PENDING 时长（ms）。 */
    pendingMs: number
    /** RUNNING 时长（ms）。 */
    runMs: number
    /** sinfo 追加合成分区行数（P2 长会话上下文填充）。 */
    padSinfo?: number
    /** gaussian 三相位输出前置 banner 行数（P2）。 */
    padGaussian?: number
  }
  expect: {
    /** 全部须命中最终 assistant 答复（AND）。 */
    finalMustMatch?: RegExp[]
    /** 最终答复命中任一即 FAIL（防幻觉成功）。 */
    finalMustNotMatch?: RegExp[]
    /** 工具名（子串匹配）组列表：每组内任一出现即过（OR-of-ANDs）。 */
    toolsAnyOf?: string[][]
    /** 工具名子串，出现即 FAIL。 */
    toolsMustNotAppear?: string[]
  }
  /** 单任务墙钟上限（秒），超时杀进程记 timeout。 */
  timeoutSec: number
}

export const GOLDEN_TASKS: GoldenTask[] = [
  {
    id: 'partitions-lookup',
    prompt:
      '查看 11250 集群的分区情况：用 mat_partitions 工具列出分区表，告诉我 Agent0 分区当前有多少个空闲（idle）节点。',
    fake: { scenario: 'completed', pendingMs: 0, runMs: 0 },
    expect: {
      finalMustMatch: [/Agent0/, /20/],
      toolsAnyOf: [['mat_partitions']],
      toolsMustNotAppear: ['mat_sbatch', 'mat_gaussian'],
    },
    timeoutSec: 240,
  },
  {
    id: 'sleep-watch',
    // v1.1：headless 面的 whenIdle() 不等后台作业结算唤醒（2026-10-15 基线轮实锤，
    // 宿主 bundle/headless/src/index.ts:120），异步唤醒路径留在 web 面取证
    // （docs/evidence/m1/2026-08-28-followup-wake.md）——回放泳道改测阻塞等待形态。
    prompt:
      '在 11250 集群的 Agent0 分区提交 2 个运行 sleep 20 的作业（作业脚本内容自拟），' +
      '用 mat_job_watch 工具把两个作业一次性注册成异步监控，然后用 job_output 阻塞等待' +
      '（wait: true）直到监控结算，汇报两个作业的最终状态和退出码。不要手动轮询 sacct。',
    fake: { scenario: 'completed', pendingMs: 6000, runMs: 15000 },
    expect: {
      // 退出码断言 v1.2：模型实测把「退出码」与值写在表格相邻单元格、或散文
      // "exit code = 0"——按「提及退出码且同行内出现 0」宽松匹配，不锁排版。
      finalMustMatch: [/COMPLETED/, /(?:退出码|exit\s*code)[^\n]{0,30}?\b0\b|0:0/i],
      toolsAnyOf: [['mat_job_watch'], ['job_output'], ['mat_sbatch', 'mat_exec']],
      toolsMustNotAppear: ['mat_gaussian'],
    },
    timeoutSec: 420,
  },
  {
    id: 'gaussian-onestop',
    prompt:
      '用 mat_gaussian 一站式工具对水分子做 B3LYP/6-31G(d) 的 opt+freq 计算。' +
      '水分子笛卡尔坐标（埃）：O 0.000000 0.000000 0.000000；H 0.757000 0.586000 0.000000；' +
      'H -0.757000 0.586000 0.000000。集群用 11250，分区 Agent0。' +
      '如果工具返回 CONFIRM_REQUIRED，把摘要里的参数视为我已确认，立即带 confirmed_digest 用完全相同的参数重调一次。' +
      '完成后报告：总能量（Hartree，保留 4 位小数）、优化是否收敛、虚频个数。',
    fake: { scenario: 'completed', pendingMs: 5000, runMs: 12000 },
    expect: {
      finalMustMatch: [/-76\.40/, /收敛|converged/i, /虚频|imaginary/i],
      finalMustNotMatch: [/FAILED|计算失败/],
      toolsAnyOf: [['mat_gaussian']],
      toolsMustNotAppear: ['mat_sbatch'],
    },
    timeoutSec: 420,
  },
  {
    id: 'gaussian-fail-diagnosis',
    // v1.1：同 sleep-watch——headless 面改阻塞等待（wait: true）至作业终态。
    prompt:
      '用 mat_gaussian 一站式工具对水分子做 B3LYP/6-31G(d) 的 opt 计算。' +
      '水分子笛卡尔坐标（埃）：O 0.000000 0.000000 0.000000；H 0.757000 0.586000 0.000000；' +
      'H -0.757000 0.586000 0.000000。集群用 11250，分区 Agent0。' +
      '如果工具返回 CONFIRM_REQUIRED，把摘要里的参数视为我已确认，立即带 confirmed_digest 用完全相同的参数重调一次。' +
      '提交后用 job_output 阻塞等待（wait: true）直到作业终态。' +
      '如果计算失败：不要重试、不要换参数，根据返回的诊断信息（日志关键行）告诉我失败原因和下一步建议。',
    fake: { scenario: 'failed', pendingMs: 5000, runMs: 12000 },
    expect: {
      finalMustMatch: [/FAILED|失败/, /Convergence|收敛|l9999|Optimization stopped|步数/i],
      finalMustNotMatch: [/COMPLETED/],
      toolsAnyOf: [['mat_gaussian']],
    },
    timeoutSec: 420,
  },
  {
    id: 'cancel-job',
    prompt:
      '在 11250 集群的 Agent0 分区提交一个运行 sleep 600 的作业（脚本自拟），拿到 Slurm 作业号后立刻取消它，然后向我确认取消已完成。',
    fake: { scenario: 'completed', pendingMs: 300_000, runMs: 0 },
    expect: {
      finalMustMatch: [/CANCELLED|已取消|取消成功/],
      toolsAnyOf: [['mat_cancel'], ['mat_sbatch', 'mat_exec']],
    },
    timeoutSec: 300,
  },
  {
    id: 'local-bash',
    // P1 沙箱覆盖任务：本地 bash 走 bash-sandbox 执行器（base 默认装载），
    // workspace 内合法写必须不受沙箱影响——A/B 泳道（DSH_PERMISSION_MODE）
    // 的行为面差异由本任务暴露。
    prompt:
      '用 bash 工具在当前工作目录下完成本地文件操作：创建 sandbox-check 目录，' +
      '生成 20 行数据写入 sandbox-check/data.txt（第 i 行内容为 line-i，i 从 1 到 20），' +
      '然后用 wc -l 统计行数，最后报告行数与 data.txt 的绝对路径。整个任务只用 bash 完成，不要用 write 工具。',
    fake: { scenario: 'completed', pendingMs: 0, runMs: 0 },
    expect: {
      finalMustMatch: [/20/, /sandbox-check/],
      toolsAnyOf: [['bash']],
      toolsMustNotAppear: ['mat_sbatch', 'mat_gaussian'],
    },
    timeoutSec: 240,
  },
  {
    id: 'long-composite',
    // P2 长会话任务：多计算 + 中途查询 + 末尾汇总。断言是**信息存活性测试**——
    // 开头喂入的会话代号与早期作业号必须出现在最终答复（compaction 丢信息即红）。
    // 配合 profiles/eval-compaction.yml（小 contextWindow 声明）触发压缩。
    prompt:
      '本会话代号 GOLDEN-7F3K，请全程记住。依次完成：' +
      '① 用 mat_partitions 查分区表，记下 Agent0 分区的空闲节点数；' +
      '② 提交 2 个运行 sleep 20 的作业（脚本自拟），用 mat_job_watch 一次性注册监控后，' +
      '用 job_output 阻塞等待（wait: true）直到全部终态；' +
      '③ 再用 mat_partitions 查一次分区表；' +
      '④ 最后统一汇报四项：会话代号、Agent0 空闲节点数（两次查询的值）、' +
      '两个作业的 Slurm 作业号与最终状态和退出码。',
    fake: { scenario: 'completed', pendingMs: 6000, runMs: 15000, padSinfo: 220 },
    expect: {
      finalMustMatch: [/GOLDEN-7F3K/, /20/, /COMPLETED/, /900001/, /900002/, /(?:退出码|exit\s*code)[^\n]{0,30}?\b0\b|0:0/i],
      toolsAnyOf: [['mat_partitions'], ['mat_job_watch']],
      toolsMustNotAppear: ['mat_gaussian'],
    },
    timeoutSec: 480,
  },
  {
    id: 'long-gaussian-pair',
    // P2 长会话任务：同会话两次一站式计算 + 汇总（能量/收敛/虚频来自早期
    // surface，压缩丢失即红）。padGaussian 撑大三相位输出。
    prompt:
      '本会话代号 GOLDEN-9QX2，请全程记住。对水分子（O 0.000000 0.000000 0.000000；' +
      'H 0.757000 0.586000 0.000000；H -0.757000 0.586000 0.000000）先后做两次完全相同的 ' +
      'B3LYP/6-31G(d) opt+freq 一站式计算（集群 11250、分区 Agent0）。' +
      '如果工具返回 CONFIRM_REQUIRED，把摘要参数视为我已确认，带 confirmed_digest 立即重调。' +
      '每次提交后用 job_output 阻塞等待（wait: true）至终态。两次都完成后汇报：' +
      '会话代号、两次的总能量（Hartree，4 位小数）、是否都收敛、两次的虚频个数。',
    fake: { scenario: 'completed', pendingMs: 5000, runMs: 12000, padGaussian: 100 },
    expect: {
      finalMustMatch: [/GOLDEN-9QX2/, /[-−]76\.40/, /收敛|converged/i, /虚频|imaginary/i],
      finalMustNotMatch: [/FAILED|计算失败/],
      toolsAnyOf: [['mat_gaussian']],
      toolsMustNotAppear: ['mat_sbatch'],
    },
    timeoutSec: 480,
  },
]

export function taskById(id: string): GoldenTask | undefined {
  return GOLDEN_TASKS.find((t) => t.id === id)
}
