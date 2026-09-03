/**
 * `$HOME/...` 形式 workdir 的四级解析器：producer 路径推导（零往返）→ 内存缓存 →
 * 磁盘缓存（remote-homes.json，跨重启）→ 远端 exec（成功逐级回填；空结果视为失败不缓存）。
 * 任何一步失败都回退原始值，让上层走降级路径。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { deriveRemoteHome, isShellStyleWorkdir } from 'mat-core'

export interface WorkdirResolverOptions {
  /** 磁盘缓存路径（如 `<MAT_FILE_ROOT>/remote-homes.json`）；省略则只用内存。 */
  cachePath?: string
  /** 远端取 home 的通道（exec `printf %s "$HOME"`），空串视为失败。 */
  execHome: (clusterId: string) => Promise<string>
}

export function createWorkdirResolver(options: WorkdirResolverOptions) {
  const homes = new Map<string, string>()
  const pending = new Map<string, Promise<string>>()
  let disk: Record<string, string> | undefined

  const loadDisk = async (): Promise<Record<string, string>> => {
    if (disk === undefined) {
      try {
        disk = JSON.parse(await readFile(options.cachePath!, 'utf8')) as Record<string, string>
      } catch {
        disk = {}
      }
    }
    return disk
  }

  const saveDisk = async (clusterId: string, home: string): Promise<void> => {
    if (options.cachePath === undefined) return
    try {
      const value = { ...(await loadDisk()), [clusterId]: home }
      disk = value
      await mkdir(dirname(options.cachePath), { recursive: true })
      await writeFile(options.cachePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    } catch {
      /* 缓存落盘失败静默：下次重取 */
    }
  }

  const execHomeOnce = async (clusterId: string): Promise<string> => {
    let task = pending.get(clusterId)
    if (task === undefined) {
      task = options.execHome(clusterId).then(async (home) => {
        if (home === '') throw new Error(`cluster ${clusterId} returned an empty home`)
        homes.set(clusterId, home)
        await saveDisk(clusterId, home)
        return home
      })
      task.catch(() => { pending.delete(clusterId) }) // 失败不缓存下次重试
      pending.set(clusterId, task)
    }
    return task
  }

  const expandWith = (workdir: string) => (home: string) => workdir.replace(/^\$HOME(?=\/|$)/, home)

  return {
    /** 展开一个 workdir；绝对路径与非 shell 风格值原样返回。 */
    async resolve(clusterId: string, workdir: string, hints: string[] = []): Promise<string> {
      if (!isShellStyleWorkdir(workdir)) return workdir
      const expand = expandWith(workdir)
      const derived = deriveRemoteHome(workdir, hints)
      if (derived !== undefined) return expand(derived)
      const memory = homes.get(clusterId)
      if (memory !== undefined) return expand(memory)
      if (options.cachePath !== undefined) {
        const cached = (await loadDisk())[clusterId]
        if (cached !== undefined) {
          homes.set(clusterId, cached)
          return expand(cached)
        }
      }
      try {
        return expand(await execHomeOnce(clusterId))
      } catch {
        return workdir
      }
    },

    /** 裸 home（供调用方自行展开其它路径）：内存 → 磁盘 → exec。 */
    async home(clusterId: string): Promise<string> {
      const memory = homes.get(clusterId)
      if (memory !== undefined) return memory
      if (options.cachePath !== undefined) {
        const cached = (await loadDisk())[clusterId]
        if (cached !== undefined) {
          homes.set(clusterId, cached)
          return cached
        }
      }
      return execHomeOnce(clusterId)
    },
  }
}

export type WorkdirResolver = ReturnType<typeof createWorkdirResolver>
