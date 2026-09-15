/**
 * manifest 快照钩子（shepherd spike 工程修正 C1）。
 *
 * 两个写入点（都只在 task_ref 给出时生效，失败不连坐业务——快照丢了大不了
 * 相位间退回远端补读，但结算/提交绝不能被清单写坏挡住）：
 * - recordWorkdir：sbatch 成功后，把远端 workdir 绝对路径记进任务字段
 *   （上 spike E 相路径狩猎的根治）。
 * - snapshotProperties：producer settle（onResult）时，把物性摘要快照进任务字段
 *   （相位间数据传递走清单，根治跨会话 job_output 的 8KB/生命周期局限）。
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { updateTask, portfolioFromJson, portfolioToJson } from 'mat-core'
import { parseBudgetTaskRef, type BudgetTaskRef } from './budget-hook.ts'

export type ManifestRef = BudgetTaskRef

/** 与预算闸同一 task_ref 形状（{portfolio_file, task_id}）；undefined = 不挂钩。 */
export function parseManifestRef(raw: unknown): ManifestRef | undefined {
  return parseBudgetTaskRef(raw)
}

function mutateManifest(ref: ManifestRef, mutate: (task: { taskId: string }) => void): void {
  try {
    const manifest = portfolioFromJson(readFileSync(ref.portfolioFile, 'utf8'))
    mutate(manifest as unknown as { taskId: string })
    const temporary = `${ref.portfolioFile}.part`
    writeFileSync(temporary, portfolioToJson(manifest))
    renameSync(temporary, ref.portfolioFile)
  } catch (error) {
    console.error(`manifest-hook: snapshot failed for ${ref.taskId} (${error instanceof Error ? error.message : String(error)})`)
  }
}

/** sbatch 成功后记录远端 workdir（绝对路径；调用方传什么记什么）。 */
export function recordWorkdir(ref: ManifestRef, workdir: string): void {
  mutateManifest(ref, (manifest) => {
    updateTask(manifest as never, ref.taskId, { workdir })
  })
}

/** producer 结算时快照物性摘要（properties 全量 + files 截断 + 终态）。 */
export function snapshotProperties(
  ref: ManifestRef,
  result: { status: string; detail?: string; properties?: Record<string, unknown>; files?: string[] },
): void {
  mutateManifest(ref, (manifest) => {
    updateTask(manifest as never, ref.taskId, {
      properties: {
        status: result.status,
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
        ...(result.properties ?? {}),
        ...(result.files !== undefined ? { files: result.files.slice(0, 20) } : {}),
      },
    })
  })
}
