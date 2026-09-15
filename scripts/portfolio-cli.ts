/**
 * portfolio-cli——batch-subagent spike 的 manifest 操作入口（主 agent 经 bash 调用）。
 *
 * 组合经理不手搓 JSON：所有清单操作走本 CLI（确定性 + 上下文经济——show 只回紧凑表）。
 * 核心逻辑在 mat-core（portfolio/contracts，均有测试）；本文件只做参数解析与 IO。
 *
 * 用法：
 *   portfolio-cli init --id <portfolioId> --tasks <tasks.json> --out <manifest.json>
 *   portfolio-cli show <manifest.json>                     # 紧凑任务表
 *   portfolio-cli update <manifest.json> <taskId> [--phase P] [--jobid J] [--note S] [--verdict-file F]
 *   portfolio-cli retry <manifest.json> <taskId>           # attempts+1、相位回 prepared
 *   portfolio-cli diff <before.json> <after.json>          # 增量行
 *   portfolio-cli validate prep|triage|interpret <payload.json|->   # 契约校验（exit 1 = 拒收）
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  createPortfolio,
  updateTask,
  resetForRetry,
  portfolioToJson,
  portfolioFromJson,
  diffPortfolio,
  parsePrepVerdict,
  parseTriageVerdict,
  parseInterpretVerdict,
  verdictToLines,
} from '../packages/mat-core/src/index.js'

function fail(message: string): never {
  console.error(`PORTFOLIO_CLI_FAIL: ${message}`)
  process.exit(1)
}

function readPayload(arg: string): string {
  return arg === '-' ? readFileSync('/dev/stdin', 'utf8') : readFileSync(arg, 'utf8')
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2)
  switch (cmd) {
    case 'init': {
      const { values } = parseArgs({
        args: rest,
        options: {
          id: { type: 'string' },
          tasks: { type: 'string' },
          out: { type: 'string' },
          budget: { type: 'string' },
        },
      })
      if (values.id === undefined || values.tasks === undefined || values.out === undefined) {
        fail('init requires --id --tasks --out')
      }
      const tasks = JSON.parse(readPayload(values.tasks))
      const budget = values.budget !== undefined ? (JSON.parse(values.budget) as never) : undefined
      const portfolio = createPortfolio({
        portfolioId: values.id,
        ...(budget !== undefined ? { budget } : {}),
        tasks,
      })
      writeFileSync(values.out, portfolioToJson(portfolio))
      console.log(`initialized ${values.id}: ${portfolio.tasks.length} tasks -> ${values.out}`)
      return
    }
    case 'stale': {
      // 自愈扫描（scale-round E3）：submitted 但未结算的任务 = 重启/中断后的接续面。
      const [path] = rest
      if (path === undefined) fail('stale requires <manifest.json>')
      const p = portfolioFromJson(readFileSync(path, 'utf8'))
      const stale = p.tasks.filter((t) => t.phase === 'submitted')
      if (stale.length === 0) {
        console.log('no stale tasks (none in submitted phase)')
        return
      }
      for (const t of stale) {
        console.log(`${t.taskId} submitted job=${t.jobId ?? '-'} spec=${t.spec?.task ?? '-'}`)
      }
      process.exitCode = 2
      return
    }
    case 'show': {
      const [path] = rest
      if (path === undefined) fail('show requires <manifest.json>')
      const p = portfolioFromJson(readFileSync(path, 'utf8'))
      for (const t of p.tasks) {
        const inj = t.kind === 'injected' ? ` [injected: ${t.injectedNote ?? ''}]` : ''
        const job = t.jobId !== undefined ? ` job=${t.jobId}` : ''
        const att = t.attempts > 0 ? ` attempts=${t.attempts}` : ''
        console.log(`${t.taskId} ${t.phase}${job}${att} (${t.system})${inj}`)
      }
      return
    }
    case 'update': {
      const [path, taskId] = rest
      if (path === undefined || taskId === undefined) fail('update requires <manifest.json> <taskId>')
      const { values } = parseArgs({
        args: rest.slice(2),
        options: {
          phase: { type: 'string' },
          jobid: { type: 'string' },
          note: { type: 'string' },
          workdir: { type: 'string' },
          spec: { type: 'string' },
          'verdict-file': { type: 'string' },
          'properties-file': { type: 'string' },
        },
      })
      const p = portfolioFromJson(readFileSync(path, 'utf8'))
      const verdict = values['verdict-file'] !== undefined
        ? (JSON.parse(readPayload(values['verdict-file'])) as Record<string, unknown>)
        : undefined
      const properties = values['properties-file'] !== undefined
        ? (JSON.parse(readPayload(values['properties-file'])) as Record<string, unknown>)
        : undefined
      const t = updateTask(p, taskId, {
        ...(values.phase !== undefined ? { phase: values.phase as never } : {}),
        ...(values.jobid !== undefined ? { jobId: values.jobid } : {}),
        ...(values.note !== undefined ? { note: values.note } : {}),
        ...(values.workdir !== undefined ? { workdir: values.workdir } : {}),
        ...(values.spec !== undefined ? { spec: JSON.parse(values.spec) as never } : {}),
        ...(verdict !== undefined ? { verdict } : {}),
        ...(properties !== undefined ? { properties } : {}),
      })
      writeFileSync(path, portfolioToJson(p))
      console.log(`${t.taskId} -> ${t.phase}${t.jobId !== undefined ? ` job=${t.jobId}` : ''}`)
      return
    }
    case 'retry': {
      const [path, taskId] = rest
      if (path === undefined || taskId === undefined) fail('retry requires <manifest.json> <taskId>')
      const p = portfolioFromJson(readFileSync(path, 'utf8'))
      const t = resetForRetry(p, taskId)
      writeFileSync(path, portfolioToJson(p))
      console.log(`${t.taskId} retry: attempts=${t.attempts} phase=${t.phase}`)
      return
    }
    case 'diff': {
      const [before, after] = rest
      if (before === undefined || after === undefined) fail('diff requires <before.json> <after.json>')
      const lines = diffPortfolio(
        portfolioFromJson(readFileSync(before, 'utf8')),
        portfolioFromJson(readFileSync(after, 'utf8')),
      )
      for (const l of lines) console.log(l)
      return
    }
    case 'validate': {
      const [kind, file] = rest
      if (kind === undefined || file === undefined) fail('validate requires prep|triage|interpret <payload|->')
      const parsed = parsePayload(kind, readPayload(file))
      if (!parsed.ok) {
        console.error(`REJECTED: ${parsed.issues.join('; ')}`)
        process.exit(1)
      }
      for (const l of verdictToLines(parsed.value)) console.log(l)
      return
    }
    default:
      fail(`unknown command '${cmd ?? ''}' (init|show|stale|update|retry|diff|validate)`)
  }
}

function parsePayload(kind: string, text: string) {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    fail(`payload is not valid JSON: ${text.slice(0, 120)}`)
  }
  if (kind === 'prep') return parsePrepVerdict(payload)
  if (kind === 'triage') return parseTriageVerdict(payload)
  if (kind === 'interpret') return parseInterpretVerdict(payload)
  return fail(`unknown verdict kind '${kind}'`)
}

main()
