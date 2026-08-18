<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { enhanceMermaid, renderMarkdown } from './markdown.js'

const props = defineProps({
  source: { type: String, default: '' },
  locale: { type: String, default: 'zh' },
  onUpdate: { type: Function, default: null },
  onNavigate: { type: Function, default: null },
})
const root = ref(null)
const rendered = ref('')
const rendering = ref(false)
let renderId = 0
let disposeMermaid = () => {}

async function refreshPreview() {
  const currentRender = ++renderId
  rendering.value = true
  try {
    const html = await renderMarkdown(props.source)
    if (currentRender !== renderId) return
    disposeMermaid()
    disposeMermaid = () => {}
    rendered.value = html
    await nextTick()
    if (currentRender !== renderId) return
    disposeMermaid = enhanceMermaid(root.value)
  } catch (error) {
    console.error('Markdown preview rendering failed', error)
  } finally {
    if (currentRender === renderId) rendering.value = false
  }
}

watch(() => [props.source, props.locale], refreshPreview, { immediate: true })
onBeforeUnmount(() => { renderId++; disposeMermaid() })

function handleClick(event) {
  const target = event.target instanceof Element ? event.target : null
  const tab = target?.closest('[data-tab-button]')
  if (tab) {
    const tabs = tab.closest('[data-tabs]')
    if (!tabs) return
    const selected = tab.dataset.tabButton
    tabs.querySelectorAll('[data-tab-button]').forEach((button) => {
      const active = button === tab
      button.setAttribute('aria-selected', String(active))
      button.setAttribute('tabindex', active ? '0' : '-1')
    })
    tabs.querySelectorAll('[data-tab-panel]').forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== selected })
    tab.focus()
    return
  }
  const wiki = target?.closest('[data-wikilink]')
  if (wiki) {
    event.preventDefault()
    props.onNavigate?.(wiki.dataset.wikilink || '')
  }
}

function handleChange(event) {
  const target = event.target instanceof HTMLInputElement ? event.target : null
  if (!target || target.type !== 'checkbox' || !props.onUpdate) return
  const checkboxes = Array.from(root.value?.querySelectorAll('input[type="checkbox"]') || [])
  const index = checkboxes.indexOf(target)
  if (index < 0) return
  let taskIndex = 0
  const next = props.source.split('\n').map((line) => {
    if (!/^\s*[-+*]\s+\[[ xX]\](?:\s|$)/.test(line)) return line
    if (taskIndex++ !== index) return line
    return line.replace(/^(\s*[-+*]\s+\[)[ xX](\])/, `$1${target.checked ? 'x' : ' '}$2`)
  }).join('\n')
  props.onUpdate(next)
}
</script>

<template>
  <article ref="root" class="markdown-body" :aria-busy="rendering" v-html="rendered" @click="handleClick" @change="handleChange"></article>
</template>
