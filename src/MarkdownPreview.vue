<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { enhanceMermaid, renderMarkdown } from './markdown.js'

const props = defineProps({
  source: { type: String, default: '' },
  locale: { type: String, default: 'zh' },
  onUpdate: { type: Function, default: null },
  onNavigate: { type: Function, default: null },
})
const root = ref(null)
const rendered = computed(() => {
  void props.locale
  return renderMarkdown(props.source)
})

watch(rendered, () => nextTick(() => enhanceMermaid(root.value)))
onMounted(() => nextTick(() => enhanceMermaid(root.value)))

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
  <article ref="root" class="markdown-body" v-html="rendered" @click="handleClick" @change="handleChange"></article>
</template>
