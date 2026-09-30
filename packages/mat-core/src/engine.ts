/**
 * engine.ts — 引擎假设的集中声明（R10：不消除 Gaussian 绑定，而是标注出来）。
 *
 * 背景与取舍：
 *   mat-core 的整个数据模型都硬编码了 Gaussian 的形态——三个 JSON
 *   （pre/run/post）、三阶段命令、slurm.sh、properties 的字段名。接入第二个
 *   引擎（ABACUS/VASP）等于重写下半部分，不是"插一个 adapter"的工作量。
 *
 *   在没有真实第二引擎需求时做完整抽象是投机性架构：会付出可观的复杂度，
 *   却因为没有第二个实现来检验，抽象大概率是错的。所以本期**不做**抽象，
 *   只做一件事：把散落各处的 Gaussian 假设收敛到此处一份声明里，让"哪些
 *   东西是 Gaussian 专有的"可被查阅、可被 grep、将来可被替换。
 *
 * 纪律：新增任何依赖引擎语义的常量（properties 键名、相位名、脚本名），
 * 先看这里有没有；没有就加到这里，不要散落回各模块。
 */

/** V1 引擎面（TaskPackage.engine 的取值域）。扩展新引擎时在此加值。 */
export type EngineId = 'gaussian' | 'vasp'

/**
 * 模型可见的核心物性键名（引擎契约的一部分）。
 *
 * 这些键名同时出现在：远端 post JSON、wave-gate 的门判定、db 的列映射、
 * status-board 的展示。改名 = 跨四个模块的破坏性变更，故集中声明。
 */
export const GAUSSIAN_PROPERTY_KEYS = {
  /** 电子能（Hartree）。 */
  energy: 'energy',
  /** 几何是否收敛。 */
  converged: 'converged',
  /** 虚频个数（TS 验收：恰 1）。 */
  imaginaryFrequencyCount: 'imaginary_frequency_count',
  /** 振动频率数组（cm⁻¹，含虚频的负值）。 */
  frequencies: 'frequencies_cm-1',
  /** IRC 实际点数。 */
  ircPointCount: 'irc_point_count',
  /** 电子能 + 热校正的吉布斯自由能总和（Hartree）。 */
  sumElectronicFreeEnergy: 'sum_electronic_free_energy_hartree',
  /** 电子能 + 焓校正（Hartree）。 */
  sumElectronicEnthalpy: 'sum_electronic_enthalpy_hartree',
} as const

/**
 * 图谱 kind 值（plots 数组的 kind 字段）。
 * irc_profile 是 R8b 方向门的数据源；其余目前只透传不消费。
 */
export const GAUSSIAN_PLOT_KINDS = {
  ircProfile: 'irc_profile',
  reactionPath: 'reaction_path',
  irSpectrum: 'ir_spectrum',
  uvvisSpectrum: 'uvvis_spectrum',
  emissionSpectrum: 'emission_spectrum',
  scfConvergence: 'scf_convergence',
} as const

/**
 * VASP（matstream 引擎）模型可见物性键名。与 GAUSSIAN_PROPERTY_KEYS 同位声明。
 *
 * energy/converged 刻意与 gaussian 同名同义（db 列映射与状态板直接复用）；
 * energy_per_task_eV 是 vasp 专有的分任务能量表（链式任务各有 OUTCAR）。
 */
export const VASP_PROPERTY_KEYS = {
  /** 链末自洽任务的能量（eV，OUTCAR TOTEN 解析；自洽任务集见 vasp.ts）。 */
  energy: 'energy',
  /** relax 族任务是否达到离子收敛（OSZICAR accuracy 标记；无 relax 族任务时缺省）。 */
  converged: 'converged',
  /** 分任务能量表（eV）——键为 Task 目录名。 */
  energyPerTask: 'energy_per_task_eV',
} as const

/**
 * 三阶段命令的构造接口（R10 的唯一"接口化"动作）。
 *
 * pipeline-driver 此前直接 import gaussian.ts 的三个命令构造函数；改为可注入
 * 后，替换引擎至少在**命令构造**这一层不需要改 driver。这不是完整抽象——
 * driver 仍假设"三阶段 + slurm.sh + sacct"的执行形态——但它标出了第一条缝。
 * 注意：VASP 不走此接口（执行形态不同，见 ENGINE_BOUNDARY_NOTES.vaspNotes），
 * pipeline/pool 仍是 gaussian 专属。
 */
export interface EnginePhaseCommands {
  /** pre 阶段：生成并校验输入。 */
  pre(workdir: string, task: string): string
  /** run 阶段：渲染提交脚本（不提交）。 */
  run(workdir: string, task: string): string
  /** post 阶段：解析结果产出 result.json。 */
  post(workdir: string, task: string): string
}

/**
 * 引擎当前的已知边界（供文档与 code review 引用，不参与运行时逻辑）。
 *
 * 写在代码里而不是文档里的理由：文档会漂移，而这个常量会随着代码走，
 * 且能被 grep 到。任何声称"支持新引擎"的改动都应当先更新这里。
 */
export const ENGINE_BOUNDARY_NOTES = {
  implemented: ['gaussian', 'vasp'] as const,
  /**
   * 有 skill 文档但**无 mat-core 代码整合**——LLM 按 SKILL.md 散文操作
   * 集群命令，不经过结构化调度层（无 engine 字段、无 adapter、无结果解析、
   * 无门检）。不要把它当作"已支持"。
   */
  documentedOnly: ['abacus'] as const,
  hardcodedAssumptions: [
    'three JSON control files (pre/run/post.json) in a single workdir',
    'three-phase command sequence (pre → run → post) with the same task DSL string',
    'Slurm submission via a rendered slurm.sh under {workdir}/{task}/<step>/',
    'terminal state from sacct; result from a calcflow.result.v1 JSON line',
    'property key names as declared in GAUSSIAN_PROPERTY_KEYS',
  ] as const,
  /**
   * VASP（matstream）的执行形态与 gaussian 不同构（AGENTS.md §3.10 逐条评估结论，
   * 2026-09-23 接入；2026-09-24 运行时从 apptainer sif 切换为家目录自部署）。
   * 它**不接入** pipeline/pool/wave-gate（gaussian 专属层），编排面收敛在 vasp.ts
   * （prepare → sbatch → sacct watch → harvest）。
   */
  vaspNotes: [
    'in-job whole-chain execution: `matstream run` performs pre+run+post for the whole `;`-chain in ONE Slurm job; chain handoffs (CONTCAR propagation, WAVECAR/CHGCAR reuse) only hold inside a single matstream run process — no login-node phase split',
    'home-deployed doublet (gaussian-demo style): workflow_env $HOME/workspace/matstream (conda-pack py3.11 + matstream wheel, VERSION-anchored) + vasp_env $HOME/workspace/vasp-hy (public 5.4.4-iOptCell copy, SCRIPTDIR rewritten, mpi/* unload loop — job env preloads mpi/hpcx which conflicts with intelmpi)',
    'VASP launched via CALCULATOR_VASP_COMMAND=srun --mpi=pmi2 vasp_std (engine env override point; np follows --ntasks-per-node; validated by real scf job 2026-09-24)',
    'harvest contract: matstream.json one-line JSON (context/files/image/slurm_path on success, error on failure) + OSZICAR/OUTCAR probes — the engine itself ships NO convergence check (README TODO), dsh probes compensate',
    'partition kshcnormal is the sane default on cluster 11250 (probed 2026-09-23; stress r1 2026-09-30 showed Agent0 still exists but runs ~saturated at 624/640 cores)',
    'property key names as declared in VASP_PROPERTY_KEYS (energy/converged shared with gaussian for db/board reuse)',
    'historical: 2026-09-23~24 briefly ran on the public apptainer sif (/public/software/apps/sag-tool/matsoft/vasp/matstream/matstream.sif, sha256 head 8d4f4071b114b809) — replaced by the home doublet for version control',
  ] as const,
} as const
