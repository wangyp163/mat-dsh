export interface TreeEntry {
  path: string
  name: string
  size: number
  directory: boolean
  regularFile: boolean
  symbolicLink: boolean
  readable: boolean
  origin: string
  status: string
}

export interface VisibleTreeEntry extends TreeEntry { depth: number }

function parent(path: string): string | undefined {
  const index = path.lastIndexOf('/')
  return index < 0 ? undefined : path.slice(0, index)
}

export function visibleTreeEntries(entries: TreeEntry[], expanded: string[]): VisibleTreeEntry[] {
  const open = new Set(expanded)
  return [...entries]
    .sort((a, b) => a.path.localeCompare(b.path))
    .filter(entry => {
      let current = parent(entry.path)
      while (current !== undefined) {
        if (!open.has(current)) return false
        current = parent(current)
      }
      return true
    })
    .map(entry => ({ ...entry, depth: entry.path.split('/').length - 1 }))
}

export function mergeTreeEntries(current: TreeEntry[], root: string, children: TreeEntry[]): TreeEntry[] {
  const prefix = `${root}/`
  return [...current.filter(entry => entry.path !== root && !entry.path.startsWith(prefix)), ...current.filter(entry => entry.path === root), ...children]
    .sort((a, b) => a.path.localeCompare(b.path))
}
