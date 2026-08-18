import test from 'node:test'
import assert from 'node:assert/strict'
import { indentWithTab } from '@codemirror/commands'
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { markdownCommands } from '../src/editor/markdownCommands.js'

function editor(doc, anchor = 0, head = anchor, extensions = []) {
  let state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions })
  return {
    get state() { return state },
    dispatch(...specs) {
      if (specs.length === 1 && specs[0]?.state instanceof EditorState) state = specs[0].state
      else state = state.update(...specs).state
    },
    focus() {},
  }
}

test('inline Markdown commands wrap and toggle the current selection', () => {
  const view = editor('alpha beta', 6, 10)
  markdownCommands.bold(view)
  assert.equal(view.state.doc.toString(), 'alpha **beta**')
  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), 'beta')

  view.dispatch({ selection: EditorSelection.single(6, 14) })
  markdownCommands.bold(view)
  assert.equal(view.state.doc.toString(), 'alpha beta')
})

test('block commands toggle task markers and number selected lines', () => {
  const tasks = editor('first\nsecond', 0, 12)
  markdownCommands.task(tasks)
  assert.equal(tasks.state.doc.toString(), '- [ ] first\n- [ ] second')
  markdownCommands.task(tasks)
  assert.equal(tasks.state.doc.toString(), 'first\nsecond')

  const ordered = editor('first\nsecond', 0, 12)
  markdownCommands.ordered(ordered)
  assert.equal(ordered.state.doc.toString(), '1. first\n2. second')
})

test('heading command adds and removes a level-two marker', () => {
  const heading = editor('Heading', 0, 7)
  markdownCommands.heading(heading)
  assert.equal(heading.state.doc.toString(), '## Heading')
  markdownCommands.heading(heading)
  assert.equal(heading.state.doc.toString(), 'Heading')
})

test('CodeMirror continues lists and tasks and exits empty list items', () => {
  const extensions = [markdown({ base: markdownLanguage })]
  const cases = [
    ['- item', '- item\n- '],
    ['- [ ] task', '- [ ] task\n- [ ] '],
    ['1. item', '1. item\n2. '],
    ['- ', ''],
    ['- [ ] ', ''],
  ]

  for (const [source, expected] of cases) {
    const view = editor(source, source.length, source.length, extensions)
    assert.equal(insertNewlineContinueMarkup(view), true)
    assert.equal(view.state.doc.toString(), expected)
  }
})

test('Tab and Shift+Tab indent and outdent the active Markdown list item', () => {
  const source = '- one\n- two'
  const view = editor(source, source.length, source.length, [markdown({ base: markdownLanguage })])
  assert.equal(indentWithTab.run(view), true)
  assert.equal(view.state.doc.toString(), '- one\n  - two')
  assert.equal(indentWithTab.shift(view), true)
  assert.equal(view.state.doc.toString(), source)
})

test('advanced commands insert valid Notide callout and tab syntax', () => {
  const callout = editor('remember this', 0, 13)
  markdownCommands.callout(callout)
  assert.equal(callout.state.doc.toString(), '> [!NOTE]\n> remember this')

  const tabs = editor('', 0)
  markdownCommands.tabs(tabs)
  assert.match(tabs.state.doc.toString(), /^:::\{tab-set\}/)
  assert.match(tabs.state.doc.toString(), /:::\{tab-item\} Second/)
})
