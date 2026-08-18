import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorSelection, EditorState } from '@codemirror/state'
import { markdownCommands } from '../src/editor/markdownCommands.js'

function editor(doc, anchor = 0, head = anchor) {
  let state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) })
  return {
    get state() { return state },
    dispatch(spec) { state = state.update(spec).state },
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

test('advanced commands insert valid Notide callout and tab syntax', () => {
  const callout = editor('remember this', 0, 13)
  markdownCommands.callout(callout)
  assert.equal(callout.state.doc.toString(), '> [!NOTE]\n> remember this')

  const tabs = editor('', 0)
  markdownCommands.tabs(tabs)
  assert.match(tabs.state.doc.toString(), /^:::\{tab-set\}/)
  assert.match(tabs.state.doc.toString(), /:::\{tab-item\} Second/)
})
