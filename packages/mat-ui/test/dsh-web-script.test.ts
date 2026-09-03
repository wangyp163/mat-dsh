import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const scriptUrl = new URL('../../../scripts/dsh-web.sh', import.meta.url)

describe('dsh-web operations script', () => {
  it('boots the profile that owns Harmony and turn-fold', async () => {
    const script = await readFile(scriptUrl, 'utf8')
    expect(script).toContain('DSH_HOME_DIR=~/.local/share/mat-dsh')
    expect(script).toContain('HARMONY_BIN="$DSH_HOME_DIR/profiles/web/node_modules/dsh-harmony/lib/bin.js"')
    expect(script).toContain('DEV_DSH_ENTRY="$DSH_HOME_DIR/profiles/web/node_modules/@deepseek-ai/dsh/lib/bin.js"')
    expect(script).toContain('MAT_UI_LINK="$DSH_HOME_DIR/profiles/web/node_modules/mat-ui"')
    expect(script).toContain('ln -sfn "$MAT_UI_PACKAGE" "$MAT_UI_LINK"')
    expect(script).toContain('MAT_UI_BUILD=~/mat-harness/mat-dsh/scripts/build-mat-ui.mjs')
    expect(script).toContain('node "$MAT_UI_BUILD"')
    expect(script).toContain('exec setsid env DSH_HOME="$DSH_HOME_DIR" DSH_HARMONY_DSH_ENTRY="$DEV_DSH_ENTRY"')
    expect(script).toContain('node "$HARMONY_BIN" --profile web --patch "$OVERLAY" --no-open')
  })

  it('launches the file channel on the fetch transport (5x faster roundtrips than curl)', async () => {
    const script = await readFile(scriptUrl, 'utf8')
    expect(script).toContain('MAT_TRANSPORT=fetch')
  })
})
