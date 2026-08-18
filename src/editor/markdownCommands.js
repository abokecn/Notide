import { EditorSelection } from '@codemirror/state'

function dispatchChange(view, spec) {
  view.dispatch({ ...spec, scrollIntoView: true, userEvent: 'input' })
  view.focus()
  return true
}

export function wrapSelection(prefix, suffix = prefix, placeholder = 'text') {
  return (view) => {
    const { state } = view
    const transaction = state.changeByRange((range) => {
      const selected = state.sliceDoc(range.from, range.to)
      const wrapped = selected.startsWith(prefix) && selected.endsWith(suffix) && selected.length >= prefix.length + suffix.length
      if (wrapped) {
        const value = selected.slice(prefix.length, selected.length - suffix.length)
        return {
          changes: { from: range.from, to: range.to, insert: value },
          range: EditorSelection.range(range.from, range.from + value.length),
        }
      }

      const value = selected || placeholder
      const insert = `${prefix}${value}${suffix}`
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from + prefix.length, range.from + prefix.length + value.length),
      }
    })
    return dispatchChange(view, transaction)
  }
}

export function toggleLinePrefix(prefix, matcher = prefix) {
  return (view) => {
    const { state } = view
    const selection = state.selection.main
    const firstLine = state.doc.lineAt(selection.from)
    const lastLine = state.doc.lineAt(selection.to)
    const value = state.sliceDoc(firstLine.from, lastLine.to)
    const lines = value.split('\n')
    const expression = typeof matcher === 'string'
      ? new RegExp(`^${matcher.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
      : matcher
    const remove = lines.every((line) => !line.trim() || expression.test(line))
    const next = lines.map((line, index) => {
      if (!line && lines.length === 1) return remove ? '' : typeof prefix === 'function' ? prefix(index) : prefix
      if (remove) return line.replace(expression, '')
      return `${typeof prefix === 'function' ? prefix(index) : prefix}${line}`
    }).join('\n')
    dispatchChange(view, {
      changes: { from: firstLine.from, to: lastLine.to, insert: next },
      selection: EditorSelection.range(firstLine.from, firstLine.from + next.length),
    })
    return true
  }
}

export function insertBlock(content, selectStart = 0, selectLength = 0) {
  return (view) => {
    const { state } = view
    const range = state.selection.main
    const selected = state.sliceDoc(range.from, range.to)
    const block = content.replace('{selection}', selected || '')
    const before = range.from > 0 && state.sliceDoc(range.from - 1, range.from) !== '\n' ? '\n\n' : ''
    const after = range.to < state.doc.length && state.sliceDoc(range.to, range.to + 1) !== '\n' ? '\n\n' : ''
    const insert = `${before}${block}${after}`
    const anchor = range.from + before.length + selectStart
    dispatchChange(view, {
      changes: { from: range.from, to: range.to, insert },
      selection: EditorSelection.range(anchor, anchor + selectLength),
    })
    return true
  }
}

const orderedPrefix = (index) => `${index + 1}. `

export const markdownCommands = {
  heading: toggleLinePrefix('## ', /^#{1,6}\s+/),
  bold: wrapSelection('**', '**', 'text'),
  italic: wrapSelection('*', '*', 'text'),
  strike: wrapSelection('~~', '~~', 'text'),
  inlineCode: wrapSelection('`', '`', 'code'),
  bullet: toggleLinePrefix('- ', /^[-+*]\s+/),
  ordered: toggleLinePrefix(orderedPrefix, /^\d+[.)]\s+/),
  task: toggleLinePrefix('- [ ] ', /^[-+*]\s+\[[ xX]\]\s+/),
  quote: toggleLinePrefix('> ', /^>\s?/),
  link: wrapSelection('[', '](https://)', 'link text'),
  image: wrapSelection('![', '](https://)', 'image description'),
  math: wrapSelection('$', '$', 'x = y'),
  codeBlock: insertBlock('```\n{selection}\n```', 4),
  table: insertBlock('| Column | Column |\n| --- | --- |\n| value | value |', 2, 6),
  callout: insertBlock('> [!NOTE]\n> {selection}', 12),
  tabs: insertBlock(':::{tab-set}\n:::{tab-item} First\n{selection}\n:::\n:::{tab-item} Second\n\n:::\n:::', 32),
}

export function runMarkdownCommand(view, name) {
  const command = markdownCommands[name]
  return Boolean(view && command && command(view))
}
