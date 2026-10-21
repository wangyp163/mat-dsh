/**
 * HPC packaged skill provider.
 *
 * 注册一个只读 `ctx.skills` provider，把本包 `skills/` 目录下的全部
 * SKILL.md（目录束形态：<name>/SKILL.md + 任意 references/templates/scripts
 * 资源）作为 'bundled' 技能供模型渐进式披露。技能根经 `import.meta.url`
 * 自解析——不依赖 MAT_DSH_ROOT 等环境变量或固定绝对路径，包安装到任何
 * dsh 发行版的任何位置都能定位自身；`config.skillsDir` 可显式覆盖（测试
 * 或非标准布局用）。
 *
 * 与 `dsh-skill-filesystem` 的分工：filesystem provider 负责项目/用户级
 * 根的发现与监听；本 provider 只讲本包随发的技能，宿主本地直读（打包
 * 资产即受信源），不做监听——list 每次重扫目录，get 每次重读文件，目录
 * 变更在下一个发现周期自然生效。
 *
 * @module mat-skills
 */

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  isSkillName,
  type SkillCandidate,
  type SkillDefinition,
  type SkillInvocationPolicy,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'
import { parse as parseYaml } from 'yaml'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'

export const name = 'mat-skills'
export const inject = ['skills']

/** 打包技能根：包内 skills/，经 import.meta.url 定位（发布/软链/嵌套安装均成立）。 */
export const PACKAGED_SKILLS_DIR = fileURLToPath(new URL('../skills', import.meta.url))

export interface Config {
  /** 技能根覆盖；缺省用包内 skills/。 */
  skillsDir?: string
}

export const Config: Schema<Config> = z.object({
  skillsDir: z.string(),
})

interface ParsedSkill {
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocationPolicy
  metadata?: Record<string, unknown>
  content: string
}

/** 与 dsh-skill-filesystem 同形的 frontmatter 解析：`---` 包围的 YAML 头 + markdown 正文。 */
function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return undefined
  let lineStart = firstLineEnd + 1
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      const parsed = parseYaml(raw.slice(firstLineEnd + 1, lineStart)) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
      return {
        data: parsed as Record<string, unknown>,
        body: nextNewline < 0 ? '' : raw.slice(nextNewline + 1),
      }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

function parseInvocationPolicy(data: Record<string, unknown>): SkillInvocationPolicy {
  const bool = (key: string): boolean | undefined => {
    if (!Object.hasOwn(data, key)) return undefined
    const value = data[key]
    if (typeof value === 'boolean') return value
    if (value === 1 || value === '1') return true
    if (value === 0 || value === '0') return false
    if (typeof value === 'string') {
      switch (value.toLowerCase()) {
        case 'true': case 'yes': case 'on': return true
        case 'false': case 'no': case 'off': return false
      }
    }
    throw new TypeError(`frontmatter field "${key}" must be a boolean`)
  }
  const disableModelInvocation = bool('disable-model-invocation')
  const userInvocable = bool('user-invocable')
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}

async function parseSkillFile(path: string, warn: (message: string) => void, signal?: AbortSignal): Promise<ParsedSkill | undefined> {
  let raw: string
  try {
    raw = await readFile(path, { encoding: 'utf8', signal })
  } catch {
    // 单个技能文件缺失/暂不可读不致命：发现期跳过该技能。
    return undefined
  }
  const parsed = parseFrontmatter(raw)
  if (parsed === undefined) {
    warn(`skill file ${path} ignored: missing or invalid YAML frontmatter`)
    return undefined
  }
  const name = typeof parsed.data.name === 'string' ? parsed.data.name : ''
  const description = typeof parsed.data.description === 'string' ? parsed.data.description : ''
  if (name === '' || description === '') {
    warn(`skill file ${path} ignored: frontmatter requires name and description`)
    return undefined
  }
  if (!isSkillName(name)) {
    warn(`skill file ${path} ignored: invalid skill name "${name}"`)
    return undefined
  }
  let invocation: SkillInvocationPolicy
  try {
    invocation = parseInvocationPolicy(parsed.data)
  } catch (error) {
    warn(`skill file ${path} ignored: ${(error as Error).message}`)
    return undefined
  }
  const whenToUse = typeof parsed.data.whenToUse === 'string' && parsed.data.whenToUse.length > 0
    ? parsed.data.whenToUse
    : undefined
  const metadata = typeof parsed.data.metadata === 'object' && parsed.data.metadata !== null && !Array.isArray(parsed.data.metadata)
    ? parsed.data.metadata as Record<string, unknown>
    : undefined
  return { name, description, whenToUse, invocation, metadata, content: parsed.body.trim() }
}

/**
 * 构造 HPC 打包技能 provider。独立导出供测试直接驱动（不依赖 Cordis 运行时）。
 * @param root - 技能根（其下每个子目录一个 <name>/SKILL.md）。
 * @param warn - 无效技能的告警通道（运行时接 ctx.logger.warn）。
 */
export function createMatSkillProvider(root: string, warn: (message: string) => void = () => {}): SkillProvider {
  const candidate = (dir: string, parsed: ParsedSkill): SkillCandidate => ({
    name: parsed.name,
    description: parsed.description,
    ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
    invocation: parsed.invocation,
    source: 'bundled',
    provider: 'mat',
    resourceBase: { kind: 'directory', path: dir },
    rank: BUNDLED_SKILL_RANK,
    locator: { file: join(dir, 'SKILL.md') },
    path: join(dir, 'SKILL.md'),
    ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
  })
  return {
    name: 'mat',
    async list(options) {
      options.signal?.throwIfAborted()
      let entries
      try {
        entries = await readdir(root, { withFileTypes: true, signal: options.signal })
      } catch {
        // 根缺失（裁剪安装等）＝空目录：提供空目录而非失败。
        return []
      }
      const candidates: SkillCandidate[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const dir = join(root, entry.name)
        const parsed = await parseSkillFile(join(dir, 'SKILL.md'), warn, options.signal)
        if (parsed !== undefined) candidates.push(candidate(dir, parsed))
      }
      candidates.sort((a, b) => a.name.localeCompare(b.name))
      return candidates
    },
    async get(raw, options) {
      options.signal?.throwIfAborted()
      const locator = raw.locator as { file: string } | undefined
      if (locator === undefined || typeof locator.file !== 'string') return undefined
      const parsed = await parseSkillFile(locator.file, warn, options.signal)
      if (parsed === undefined) return undefined
      const definition: SkillDefinition = {
        ...candidate(dirname(locator.file), parsed),
        content: parsed.content,
      }
      return definition
    },
  }
}

export function apply(ctx: Context, config: Config): void {
  const provider = createMatSkillProvider(
    config.skillsDir ?? PACKAGED_SKILLS_DIR,
    (message) => ctx.logger.warn(message),
  )
  ctx.skills.registerProvider(() => provider)
}
