import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

function outputOf(block: ToolCallViewProps['block']): string {
  if (!('kind' in block)) return 'Running…'
  return block.content.map((part) => part.type === 'text' ? part.text : JSON.stringify(part)).join('\n')
}

function rows(text: string): string[][] {
  const lines = text.trim().split('\n').filter(Boolean)
  return lines.map(line => line.includes('|') ? line.split('|') : [line])
}

export function MatToolView({ toolName, block, inspect }: ToolCallViewProps): JSX.Element {
  const table = rows(outputOf(block))
  return <article className="mat-toolview" onClick={inspect} role={inspect ? 'button' : undefined}>
    <header><span className="mat-status-dock__eyebrow">MAT</span><strong>{toolName.replace('mat_', '').replaceAll('_', ' ')}</strong></header>
    <table><tbody>{table.slice(0, 12).map((cells, i) => <tr key={i}>{cells.map((cell, j) => j === 0 ? <th key={j}>{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody></table>
    {table.length > 12 ? <small>+ {table.length - 12} rows</small> : null}
  </article>
}
