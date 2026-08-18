import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = new URL('..', import.meta.url)
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8')

test('responsive UI keeps mobile hit targets, safe areas, and focus states', () => {
  const css = read('src/style.css')
  const app = read('src/App.vue')
  const editor = read('src/MarkdownEditor.vue')

  assert.match(css, /height: 100dvh/)
  assert.match(css, /safe-area-inset-top/)
  assert.match(css, /\.format-tools \.toolbar-button \{ width: 48px; height: 48px; min-height: 48px/)
  assert.match(css, /\.drawer-scrim \{ position: fixed/)
  assert.match(css, /\.editor-pane:focus-within \{ box-shadow: inset 0 0 0 2px var\(--accent\)/)
  assert.match(editor, /outline: '2px solid var\(--accent\)'/)
  assert.match(app, /:inert="modalOpen \|\| drawerOpen"/)
  assert.match(app, /@keydown\.tab="trapModalFocus\(\$event, settingsModal\)"/)
})

test('controls expose selected state and settings fields expose validation context', () => {
  const app = read('src/App.vue')

  assert.match(app, /:aria-pressed="Boolean\(activeNote\?\.favorite\)"/)
  assert.match(app, /:aria-pressed="Boolean\(activeNote\?\.pinned\)"/)
  assert.match(app, /:aria-pressed="viewMode === 'edit'"/)
  assert.match(app, /id="notide-sync-endpoint"[\s\S]*aria-describedby="sync-endpoint-help sync-connection-result"/)
  assert.match(app, /id="notide-sync-token"[\s\S]*aria-describedby="sync-endpoint-help sync-connection-result"/)
  assert.match(app, /connectionState === 'error' \? 'alert' : 'status'/)
  assert.match(app, /aria-live="polite" aria-atomic="true"/)
})
