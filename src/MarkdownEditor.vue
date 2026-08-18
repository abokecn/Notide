<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { runMarkdownCommand } from './editor/markdownCommands.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  noteId: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  theme: { type: String, default: 'dark' },
  lineWrapping: { type: Boolean, default: true },
  ariaLabel: { type: String, default: 'Markdown editor' },
  initialState: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue', 'cursor-change', 'history-change', 'state-change', 'ready'])
const host = ref(null)
const stateCache = new Map()
let view = null
let currentNoteId = props.noteId
let restoring = false
const themeCompartment = new Compartment()
const lineWrappingCompartment = new Compartment()

function createEditorTheme(isDark) {
  return EditorView.theme({
    '&': {
      width: '100%',
      height: '100%',
      minWidth: '0',
      backgroundColor: 'var(--paper)',
      color: 'var(--ink)',
      fontSize: '14px',
    },
    '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'var(--mono)',
      lineHeight: '1.75',
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '22px 24px 42px',
      caretColor: 'var(--accent)',
    },
    '.cm-line': { padding: '0 3px' },
    '.cm-gutters': {
      minWidth: '44px',
      paddingTop: '22px',
      borderRight: '1px solid var(--line)',
      backgroundColor: 'var(--paper)',
      color: 'var(--muted)',
    },
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '32px', padding: '0 10px 0 4px' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '.cm-panels': { borderColor: 'var(--line)', backgroundColor: 'var(--paper-deep)', color: 'var(--ink)' },
    '.cm-search': { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 10px' },
    '.cm-search input': { border: '1px solid var(--line)', borderRadius: '7px', background: 'var(--paper)', color: 'var(--ink)' },
    '.cm-search button': { border: '1px solid var(--line)', borderRadius: '7px', background: 'var(--paper)', color: 'var(--ink)' },
    '.cm-tooltip': { border: '1px solid var(--line)', borderRadius: '9px', backgroundColor: 'var(--paper)', color: 'var(--ink)' },
    '.cm-placeholder': { color: 'var(--muted)' },
  }, { dark: isDark })
}

function clampPosition(value, length) {
  return Math.max(0, Math.min(Number(value) || 0, length))
}

function initialSelection(doc, saved) {
  const length = doc.length
  const anchor = clampPosition(saved?.anchor, length)
  const head = clampPosition(saved?.head ?? anchor, length)
  return EditorSelection.single(anchor, head)
}

function extensions() {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    markdown({ base: markdownLanguage, addKeymap: false, pasteURLAsLink: true }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([
      ...markdownKeymap,
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    placeholder(props.placeholder),
    EditorView.contentAttributes.of({
      'aria-label': props.ariaLabel,
      autocapitalize: 'sentences',
      autocomplete: 'off',
      spellcheck: 'true',
    }),
    EditorView.updateListener.of((update) => {
      if (restoring) return
      if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
      if (update.docChanged || update.selectionSet) emitEditorState(update.state)
    }),
    EditorView.domEventHandlers({
      scroll: () => {
        emitSavedState()
        return false
      },
    }),
    lineWrappingCompartment.of(props.lineWrapping ? EditorView.lineWrapping : []),
    themeCompartment.of(createEditorTheme(props.theme === 'dark')),
  ]
}

function createState(doc, saved = props.initialState) {
  return EditorState.create({
    doc,
    selection: initialSelection(doc, saved),
    extensions: extensions(),
  })
}

function emitEditorState(state = view?.state) {
  if (!state) return
  const selection = state.selection.main
  const line = state.doc.lineAt(selection.head)
  emit('cursor-change', {
    line: line.number,
    column: selection.head - line.from + 1,
    from: selection.from,
    to: selection.to,
  })
  emit('history-change', { canUndo: undoDepth(state) > 0, canRedo: redoDepth(state) > 0 })
  emitSavedState()
}

function emitSavedState() {
  if (!view || restoring) return
  const selection = view.state.selection.main
  emit('state-change', {
    noteId: currentNoteId,
    anchor: selection.anchor,
    head: selection.head,
    scrollTop: Math.round(view.scrollDOM.scrollTop),
  })
}

function cacheCurrentState() {
  if (!view || !currentNoteId) return
  stateCache.delete(currentNoteId)
  stateCache.set(currentNoteId, { state: view.state, scrollTop: view.scrollDOM.scrollTop })
  while (stateCache.size > 20) stateCache.delete(stateCache.keys().next().value)
}

function restoreNote(noteId) {
  if (!view) return
  cacheCurrentState()
  currentNoteId = noteId
  const cached = stateCache.get(noteId)
  const matching = cached?.state.doc.toString() === props.modelValue
  restoring = true
  view.setState(matching ? cached.state : createState(props.modelValue, props.initialState))
  nextTick(() => {
    view.scrollDOM.scrollTop = matching ? cached.scrollTop : Number(props.initialState?.scrollTop) || 0
    restoring = false
    emitEditorState()
  })
}

onMounted(() => {
  view = new EditorView({ state: createState(props.modelValue), parent: host.value })
  view.scrollDOM.scrollTop = Number(props.initialState?.scrollTop) || 0
  emitEditorState()
  emit('ready')
})

onBeforeUnmount(() => {
  cacheCurrentState()
  view?.destroy()
  view = null
})

watch(() => props.noteId, (noteId) => {
  if (noteId !== currentNoteId) restoreNote(noteId)
})

watch(() => props.modelValue, (value) => {
  if (!view || value === view.state.doc.toString()) return
  restoring = true
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
    annotations: Transaction.addToHistory.of(false),
  })
  restoring = false
  emitEditorState()
})

watch(() => props.ariaLabel, (value) => view?.contentDOM.setAttribute('aria-label', value))
watch(() => props.theme, (value) => {
  const extension = createEditorTheme(value === 'dark')
  if (view) view.dispatch({ effects: themeCompartment.reconfigure(extension) })
  for (const cached of stateCache.values()) {
    cached.state = cached.state.update({ effects: themeCompartment.reconfigure(extension) }).state
  }
})
watch(() => props.lineWrapping, (value) => {
  const extension = value ? EditorView.lineWrapping : []
  if (view) view.dispatch({ effects: lineWrappingCompartment.reconfigure(extension) })
  for (const cached of stateCache.values()) {
    cached.state = cached.state.update({ effects: lineWrappingCompartment.reconfigure(extension) }).state
  }
})

function focus() { view?.focus() }
function format(name) { return runMarkdownCommand(view, name) }
function undoEdit() { return view ? undo(view) : false }
function redoEdit() { return view ? redo(view) : false }
function goToLine(lineNumber) {
  if (!view) return false
  const number = Math.max(1, Math.min(Math.trunc(Number(lineNumber)) || 1, view.state.doc.lines))
  const position = view.state.doc.line(number).from
  view.dispatch({
    selection: EditorSelection.cursor(position),
    effects: EditorView.scrollIntoView(position, { y: 'center' }),
  })
  view.focus()
  emitEditorState()
  return true
}

defineExpose({ focus, format, undo: undoEdit, redo: redoEdit, goToLine })
</script>

<template>
  <div ref="host" class="markdown-editor"></div>
</template>

<style scoped>
.markdown-editor {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
</style>
