import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import markdownIt from 'markdown-it'
import container from 'markdown-it-container'
import deflist from 'markdown-it-deflist'
import footnote from 'markdown-it-footnote'
import ins from 'markdown-it-ins'
import mark from 'markdown-it-mark'
import multimdTable from 'markdown-it-multimd-table'
import sub from 'markdown-it-sub'
import sup from 'markdown-it-sup'
import taskLists from 'markdown-it-task-lists'

// Keep the client and native WebView on one lightweight Markdown-it profile.
const md = markdownIt({ html: true, linkify: true, breaks: false, typographer: false, langPrefix: 'language-', highlight() { return '' } })
// markdown-it-multimd-table still calls this helper removed from newer markdown-it.
md.utils.assign = Object.assign
md.use(deflist).use(footnote).use(ins).use(mark).use(multimdTable, { multiline: true, rowspan: true, headerless: true }).use(sub).use(sup).use(taskLists, { enabled: true, label: true, labelAfter: true })

const CALLOUT_ALIASES = { summary: 'abstract', tldr: 'abstract', hint: 'tip', important: 'tip', check: 'success', done: 'success', help: 'question', faq: 'question', caution: 'warning', attention: 'warning', fail: 'failure', missing: 'failure', error: 'danger', bug: 'danger', cite: 'quote' }
const calloutFoldStack = []
const HIGHLIGHT_LANGUAGE_SPECS = {
  xml: { aliases: ['html', 'xhtml', 'rss', 'atom', 'xjb', 'xsd', 'xsl', 'plist', 'wsf', 'svg'], dependencies: ['css', 'javascript'], load: () => import('highlight.js/lib/languages/xml') },
  bash: { aliases: ['sh', 'zsh'], load: () => import('highlight.js/lib/languages/bash') },
  c: { aliases: ['h'], load: () => import('highlight.js/lib/languages/c') },
  cpp: { aliases: ['cc', 'c++', 'h++', 'hpp', 'hh', 'hxx', 'cxx'], load: () => import('highlight.js/lib/languages/cpp') },
  csharp: { aliases: ['cs', 'c#'], load: () => import('highlight.js/lib/languages/csharp') },
  css: { load: () => import('highlight.js/lib/languages/css') },
  markdown: { aliases: ['md', 'mkdown', 'mkd'], dependencies: ['xml'], load: () => import('highlight.js/lib/languages/markdown') },
  diff: { aliases: ['patch'], load: () => import('highlight.js/lib/languages/diff') },
  ruby: { aliases: ['rb', 'gemspec', 'podspec', 'thor', 'irb'], load: () => import('highlight.js/lib/languages/ruby') },
  go: { aliases: ['golang'], load: () => import('highlight.js/lib/languages/go') },
  graphql: { aliases: ['gql'], load: () => import('highlight.js/lib/languages/graphql') },
  ini: { aliases: ['toml'], load: () => import('highlight.js/lib/languages/ini') },
  java: { aliases: ['jsp'], load: () => import('highlight.js/lib/languages/java') },
  javascript: { aliases: ['js', 'jsx', 'mjs', 'cjs'], dependencies: ['xml', 'css', 'graphql'], load: () => import('highlight.js/lib/languages/javascript') },
  json: { aliases: ['jsonc', 'json5'], load: () => import('highlight.js/lib/languages/json') },
  kotlin: { aliases: ['kt', 'kts', 'ktm', 'ktx'], load: () => import('highlight.js/lib/languages/kotlin') },
  less: { load: () => import('highlight.js/lib/languages/less') },
  lua: { aliases: ['pluto'], load: () => import('highlight.js/lib/languages/lua') },
  makefile: { aliases: ['mk', 'mak', 'make'], load: () => import('highlight.js/lib/languages/makefile') },
  perl: { aliases: ['pl', 'pm'], load: () => import('highlight.js/lib/languages/perl') },
  objectivec: { aliases: ['mm', 'objc', 'obj-c', 'obj-c++', 'objective-c++'], load: () => import('highlight.js/lib/languages/objectivec') },
  php: { load: () => import('highlight.js/lib/languages/php') },
  'php-template': { dependencies: ['xml', 'php'], load: () => import('highlight.js/lib/languages/php-template') },
  plaintext: { aliases: ['text', 'txt'], load: () => import('highlight.js/lib/languages/plaintext') },
  python: { aliases: ['py', 'gyp', 'ipython'], load: () => import('highlight.js/lib/languages/python') },
  'python-repl': { aliases: ['pycon'], dependencies: ['python'], load: () => import('highlight.js/lib/languages/python-repl') },
  r: { load: () => import('highlight.js/lib/languages/r') },
  rust: { aliases: ['rs'], load: () => import('highlight.js/lib/languages/rust') },
  scss: { load: () => import('highlight.js/lib/languages/scss') },
  shell: { aliases: ['console', 'shellsession'], dependencies: ['bash'], load: () => import('highlight.js/lib/languages/shell') },
  sql: { load: () => import('highlight.js/lib/languages/sql') },
  swift: { load: () => import('highlight.js/lib/languages/swift') },
  yaml: { aliases: ['yml'], dependencies: ['ruby'], load: () => import('highlight.js/lib/languages/yaml') },
  typescript: { aliases: ['ts', 'tsx', 'mts', 'cts'], dependencies: ['xml', 'css', 'graphql'], load: () => import('highlight.js/lib/languages/typescript') },
  vbnet: { aliases: ['vb'], load: () => import('highlight.js/lib/languages/vbnet') },
  wasm: { load: () => import('highlight.js/lib/languages/wasm') },
}
const HIGHLIGHT_LANGUAGE_ALIASES = Object.fromEntries(Object.entries(HIGHLIGHT_LANGUAGE_SPECS).flatMap(([name, spec]) => (spec.aliases || []).map((alias) => [alias, name])))
const highlightLoadPromises = new Map()
let yamlParser = null
let yamlLoadPromise = null
let yamlLoadError = ''
let katexRenderer = null
let katexLoadPromise = null
let mermaidLoadPromise = null
let mermaidSequence = 0
const MARKDOWN_COPY = {
  zh: { properties: '属性', details: '详情', tabs: '标签页', tab: '标签', code: '代码', markdownExample: 'Markdown 示例', invalidFrontMatter: 'Front Matter 解析失败', note: '提示', abstract: '摘要', info: '信息', todo: '待办', tip: '技巧', success: '成功', question: '问题', warning: '警告', failure: '失败', danger: '危险', example: '示例', quote: '引用' },
  en: { properties: 'Properties', details: 'Details', tabs: 'Tabs', tab: 'Tab', code: 'Code', markdownExample: 'Markdown example', invalidFrontMatter: 'Invalid Front Matter', note: 'Note', abstract: 'Abstract', info: 'Info', todo: 'Todo', tip: 'Tip', success: 'Success', question: 'Question', warning: 'Warning', failure: 'Failure', danger: 'Danger', example: 'Example', quote: 'Quote' },
}

for (const kind of ['note', 'tip', 'info', 'success', 'warning', 'danger', 'abstract', 'todo', 'question', 'failure', 'example', 'quote']) {
  md.use(container, kind, {
    render(tokens, index) {
      const token = tokens[index]
      return token.nesting === 1 ? `<aside class="callout callout-${kind}"><div class="callout-label">${markdownLabel(kind)}</div><div class="callout-content">` : '</div></aside>'
    },
  })
}

md.use(container, 'callout', {
  validate(info) { return /^callout\b/i.test(info.trim()) },
  render(tokens, index) {
    const token = tokens[index]
    if (token.nesting === -1) {
      const fold = calloutFoldStack.pop() || ''
      return `</div>${fold ? '</details>' : '</aside>'}`
    }
    const info = token.info.trim().replace(/^callout\s*/i, '')
    const match = /^(\+|-)?\s*([A-Za-z][\w-]*)(?:\s+(.+))?$/i.exec(info)
    const fold = match?.[1] || ''
    const type = normalizeCalloutType(match?.[2] || 'note')
    const title = stripBracketTitle(match?.[3] || '') || calloutTitle(type)
    calloutFoldStack.push(fold)
    return fold
      ? `<details class="callout callout-${escapeAttr(type)}" data-callout="${escapeAttr(type)}"${fold === '+' ? ' open' : ''}><summary class="callout-title">${escapeHtml(title)}</summary><div class="callout-content">`
      : `<aside class="callout callout-${escapeAttr(type)}" data-callout="${escapeAttr(type)}"><div class="callout-title">${escapeHtml(title)}</div><div class="callout-content">`
  },
})

md.use(container, 'details', {
  validate(info) { return /^details\b/i.test(info.trim()) },
  render(tokens, index) {
    const token = tokens[index]
    if (token.nesting === -1) return '</details>'
    const raw = token.info.trim().replace(/^details\s*/i, '')
    const detailInfo = stripBracketTitle(raw) || raw
    const open = /^(?:open\b|\+)\s*/i.test(detailInfo)
    const title = stripBracketTitle(detailInfo.replace(/^(?:open\b|\+)\s*/i, '')) || markdownLabel('details')
    return `<details class="details-block"${open ? ' open' : ''}><summary>${escapeHtml(title)}</summary>`
  },
})

let tabSequence = 0
installMathRules()
installHeadingRules()
installMediaRules()

export async function renderMarkdown(source = '') {
  const value = String(source)
  await prepareSyntaxDependencies(value)
  return renderMarkdownSync(value)
}

function renderMarkdownSync(source) {
  const prepared = preprocessNotideSyntaxSync(source)
  const env = { headingIds: new Set() }
  const raw = md.render(prepared, env)
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['details', 'summary', 'mark', 'ins', 'kbd', 'figure', 'figcaption', 'section', 'span', 'aside'],
    ADD_ATTR: ['open', 'hidden', 'target', 'rel', 'loading', 'decoding', 'referrerpolicy', 'start', 'id', 'class', 'role', 'tabindex', 'type', 'checked', 'disabled', 'aria-label', 'aria-controls', 'aria-selected', 'aria-labelledby', 'aria-busy', 'data-wikilink', 'data-embed-target', 'data-block-ref', 'data-block-id', 'data-tag', 'data-callout', 'data-tabs', 'data-tab-button', 'data-tab-panel', 'data-lang', 'data-code-start', 'data-line-numbers', 'data-highlight-lines', 'data-line'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'base'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onchange', 'oninput', 'onfocus', 'srcdoc', 'formaction', 'action'],
    ALLOW_DATA_ATTR: true,
  })
}

export function enhanceMermaid(root) {
  const nodes = Array.from(root?.querySelectorAll('.mermaid-block') || [])
  if (!nodes.length) return () => {}
  let active = true
  let observer = null
  const renderNode = async (node) => {
    if (!active || node.dataset.mermaidState) return
    node.dataset.mermaidState = 'loading'
    try {
      const mermaid = await loadMermaid()
      if (!active || !node.isConnected) return
      const dark = Boolean(root.closest('[data-theme="dark"]'))
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: dark ? { primaryColor: '#3b2925', lineColor: '#e0664a', primaryTextColor: '#eee7e1', secondaryColor: '#282321' } : { primaryColor: '#f1dfd5', lineColor: '#17313a', primaryTextColor: '#1d292c' } })
      const source = node.dataset.mermaid || node.textContent || ''
      const result = await mermaid.render(`notide-mermaid-${Date.now()}-${++mermaidSequence}`, source)
      if (!active || !node.isConnected) return
      node.innerHTML = result.svg
      node.classList.remove('mermaid-fallback')
      node.dataset.mermaidState = 'rendered'
    } catch {
      if (active && node.isConnected) {
        node.classList.add('mermaid-fallback')
        node.dataset.mermaidState = 'failed'
      }
    }
  }
  if (typeof globalThis.IntersectionObserver === 'function') {
    observer = new globalThis.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer.unobserve(entry.target)
        void renderNode(entry.target)
      }
    }, { root: root.closest('.preview-pane') || null, rootMargin: '320px 0px', threshold: 0.01 })
    nodes.forEach((node) => observer.observe(node))
  } else {
    nodes.forEach((node) => { void renderNode(node) })
  }
  return () => { active = false; observer?.disconnect() }
}

export async function extractFrontMatter(source = '') {
  const value = String(source)
  await prepareSyntaxDependencies(value)
  const parsed = parseFrontMatterBlock(value)
  return parsed.present ? parsed.data : null
}

// Exported for regression tests and future native editor tooling.
export async function preprocessNotideSyntax(source = '') {
  const value = String(source)
  await prepareSyntaxDependencies(value)
  return preprocessNotideSyntaxSync(value)
}

function preprocessNotideSyntaxSync(source = '') {
  const parsed = parseFrontMatterBlock(String(source))
  let value = parsed.body
  if (parsed.present) value = `${renderFrontMatter(parsed)}\n\n${value}`
  value = transformOutsideFences(value, transformObsidianCallouts)
  value = transformOutsideFences(value, transformTabBlocks)
  return mapOutsideFences(value, (line) => {
    let next = line
    next = next.replace(/^(#{1,6}\s+.+?)\s+\^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\s*$/, '$1 {#^$2}')
    next = next.replace(/^(#{1,6})\s+(.+?)\s+\{([^{}\n]+)\}\s*$/, (_, hashes, title, attrs) => {
      const renderedTitle = md.renderInline(title)
      const blockId = findBlockId(attrs)
    const ref = blockId ? `<a class="block-ref" id="^${escapeAttr(blockId)}" data-block-ref="${escapeAttr(blockId)}" href="#^${escapeAttr(blockId)}">^${escapeHtml(blockId)}</a>` : ''
      return `<h${hashes.length}${pandocAttributes(attrs)}>${renderedTitle}${ref}</h${hashes.length}>`
    })
    next = next.replace(/^(?!<h\d)(.+?)\s+\^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\s*$/, '$1 <a class="block-ref" id="^$2" data-block-ref="$2" href="#^$2">^$2</a>')
    next = next.replace(/\[([^\]\n]+)\]\{([^{}\n]+)\}/g, (_, text, attrs) => `<span${pandocAttributes(attrs)}>${md.renderInline(text)}</span>`)
    next = next.replace(/!\[\[([^\]|#]+(?:#[^\]|]+)?(?:\|[^\]]+)?)\]\]/g, (_, raw) => {
      const target = parseWikiTarget(raw)
      return `<span class="note-embed" data-embed-target="${escapeAttr(target.raw)}"><span>↳</span> ${escapeHtml(target.alias || target.raw)}</span>`
    })
    next = next.replace(/\[\[([^\]\n]+)\]\]/g, (_, raw) => {
      const target = parseWikiTarget(raw)
      return `<a href="#" class="wiki-link" data-wikilink="${escapeAttr(target.raw)}">${escapeHtml(target.alias || target.raw)}</a>`
    })
    next = next.replace(/\(\(([A-Za-z0-9][A-Za-z0-9_-]{0,63})\)\)/g, (_, id) => `<a href="#^${escapeAttr(id)}" class="block-reference" data-block-ref="${escapeAttr(id)}">((${escapeHtml(id)}))</a>`)
    next = next.replace(/(^|[\s(\[>、，；;])#([\p{L}\p{N}_\-/·]{1,60})(?![\p{L}\p{N}_\-/·])/gu, (_, prefix, tag) => `${prefix}<span class="inline-tag" data-tag="${escapeAttr(tag)}" role="link" tabindex="0">#${escapeHtml(tag)}</span>`)
    return next
  })
}

export function detectNotideSyntaxDependencies(source = '') {
  const requirements = { frontMatter: false, math: false, languages: new Set() }
  collectSyntaxDependencies(String(source), requirements)
  return { frontMatter: requirements.frontMatter, math: requirements.math, languages: [...requirements.languages].sort() }
}

async function prepareSyntaxDependencies(source) {
  const requirements = detectNotideSyntaxDependencies(source)
  await Promise.all([
    requirements.frontMatter ? ensureYamlParser() : null,
    requirements.math ? ensureKatexRenderer() : null,
    ensureHighlightLanguages(requirements.languages),
  ])
}

function collectSyntaxDependencies(source, requirements, depth = 0) {
  if (depth > 16) return
  const frontMatter = matchFrontMatterBlock(source)
  if (frontMatter) {
    const bytes = new TextEncoder().encode(frontMatter[2]).byteLength
    if (bytes <= 64 * 1024) requirements.frontMatter = true
    source = source.slice(frontMatter[0].length)
  }
  const lines = source.split('\n')
  let fence = null
  for (const line of lines) {
    const marker = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      const closes = marker && marker[2][0] === fence.char && marker[2].length >= fence.length && !marker[3].trim()
      if (!closes) {
        if (fence.example) fence.body.push(line)
        continue
      }
      if (fence.example) collectSyntaxDependencies(fence.body.join('\n'), requirements, depth + 1)
      fence = null
      continue
    }
    if (marker) {
      const info = parseFenceInfo(marker[3] || '')
      const language = resolveHighlightLanguage(info.language)
      if (language && !['mermaid', 'md-example', 'markdown-example'].includes(info.language)) requirements.languages.add(language)
      fence = { char: marker[2][0], length: marker[2].length, example: ['md-example', 'markdown-example'].includes(info.language), body: [] }
      continue
    }
    if (/^\s*\$\$/.test(line) || /\$(?!\s)(?:[^$\\]|\\.)+?(?<!\s)\$/.test(line)) requirements.math = true
  }
}

function resolveHighlightLanguage(language) {
  const normalized = String(language || '').toLowerCase()
  return HIGHLIGHT_LANGUAGE_SPECS[normalized] ? normalized : HIGHLIGHT_LANGUAGE_ALIASES[normalized] || ''
}

async function ensureHighlightLanguages(languages) {
  const required = new Set()
  const collect = (language) => {
    const canonical = resolveHighlightLanguage(language)
    if (!canonical || required.has(canonical)) return
    required.add(canonical)
    for (const dependency of HIGHLIGHT_LANGUAGE_SPECS[canonical].dependencies || []) collect(dependency)
  }
  languages.forEach(collect)
  await Promise.all([...required].map(loadHighlightLanguage))
}

async function loadHighlightLanguage(language) {
  if (hljs.getLanguage(language)) return true
  if (!highlightLoadPromises.has(language)) {
    const promise = HIGHLIGHT_LANGUAGE_SPECS[language].load()
      .then((module) => {
        if (!hljs.getLanguage(language)) hljs.registerLanguage(language, module.default || module)
        return true
      })
      .catch(() => {
        highlightLoadPromises.delete(language)
        return false
      })
    highlightLoadPromises.set(language, promise)
  }
  return highlightLoadPromises.get(language)
}

async function ensureYamlParser() {
  if (yamlParser) return yamlParser
  if (!yamlLoadPromise) {
    yamlLoadPromise = import('yaml')
      .then((module) => {
        yamlParser = module.parse
        yamlLoadError = ''
        return yamlParser
      })
      .catch((error) => {
        yamlLoadError = error?.message || 'YAML parser is unavailable'
        yamlLoadPromise = null
        return null
      })
  }
  return yamlLoadPromise
}

async function ensureKatexRenderer() {
  if (katexRenderer) return katexRenderer
  if (!katexLoadPromise) {
    katexLoadPromise = import('katex')
      .then(async (module) => {
        if (typeof globalThis.document !== 'undefined') await import('katex/dist/katex.min.css').catch(() => null)
        katexRenderer = module.default || module
        return katexRenderer
      })
      .catch(() => {
        katexLoadPromise = null
        return null
      })
  }
  return katexLoadPromise
}

async function loadMermaid() {
  if (!mermaidLoadPromise) mermaidLoadPromise = import('mermaid').then((module) => module.default || module)
  try { return await mermaidLoadPromise } catch (error) { mermaidLoadPromise = null; throw error }
}

function renderMath(source, displayMode) {
  if (katexRenderer) return katexRenderer.renderToString(source, { displayMode, throwOnError: false })
  const delimiter = displayMode ? '$$' : '$'
  return `<code class="math-fallback">${delimiter}${escapeHtml(source)}${delimiter}</code>`
}

function installMathRules() {
  md.inline.ruler.before('escape', 'notide_math_inline', (state, silent) => {
    if (state.src[state.pos] !== '$') return false
    const match = /^\$(?!\s)((?:[^$\\]|\\.)+?)(?<!\s)\$/.exec(state.src.slice(state.pos))
    if (!match) return false
    if (!silent) { const token = state.push('notide_math_inline', 'span', 0); token.content = match[1] }
    state.pos += match[0].length
    return true
  })
  md.block.ruler.before('fence', 'notide_math_block', (state, startLine, endLine, silent) => {
    const first = blockLine(state, startLine)
    if (!/^\$\$/.test(first)) return false
    let content = first.slice(2)
    let next = startLine
    let found = false
    if (content.trim().endsWith('$$')) { content = content.trim().slice(0, -2); found = true }
    else {
      while (++next < endLine) {
        const line = blockLine(state, next)
        if (line.trim().endsWith('$$')) { content += `\n${line.slice(0, line.lastIndexOf('$$'))}`; found = true; break }
        content += `\n${line}`
      }
    }
    if (!found) return false
    if (silent) return true
    const token = state.push('notide_math_block', 'div', 0)
    token.content = content.trim()
    token.map = [startLine, next + 1]
    state.line = next + 1
    return true
  })
  md.renderer.rules.notide_math_inline = (tokens, index) => renderMath(tokens[index].content, false)
  md.renderer.rules.notide_math_block = (tokens, index) => `<div class="math-block">${renderMath(tokens[index].content, true)}</div>`
}

function installHeadingRules() {
  md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const token = tokens[index]
    const text = tokens[index + 1]?.content || ''
    const base = token.attrGet('id') || slugifyHeading(text)
    let id = base || 'section'
    let suffix = 2
    while (env.headingIds.has(id)) id = `${base}-${suffix++}`
    env.headingIds.add(id)
    token.attrSet('id', id)
    token.attrSet('data-line', String(token.map?.[0] ?? 0))
    return self.renderToken(tokens, index, options)
  }
  md.renderer.rules.heading_close = (tokens, index) => `<a class="heading-anchor" href="#${escapeAttr(tokens[index - 2]?.attrGet?.('id') || '')}" aria-hidden="true"></a></${tokens[index].tag}>`
}

function installMediaRules() {
  md.renderer.rules.fence = (tokens, index) => renderFence(tokens[index])
  const defaultImage = md.renderer.rules.image
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    tokens[index].attrSet('loading', 'lazy'); tokens[index].attrSet('decoding', 'async'); tokens[index].attrSet('referrerpolicy', 'no-referrer')
    const rendered = defaultImage ? defaultImage(tokens, index, options, env, self) : self.renderToken(tokens, index, options)
    const title = tokens[index].attrGet('title')
    return title ? `<figure>${rendered}<figcaption>${escapeHtml(title)}</figcaption></figure>` : rendered
  }
  const defaultLink = md.renderer.rules.link_open
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const href = tokens[index].attrGet('href') || ''
    if (/^https?:/i.test(href)) { tokens[index].attrSet('target', '_blank'); tokens[index].attrSet('rel', 'noopener noreferrer') }
    return defaultLink ? defaultLink(tokens, index, options, env, self) : self.renderToken(tokens, index, options)
  }
  md.renderer.rules.table_open = (tokens, index) => `<div class="table-wrap"${tokens[index].map ? ` data-line="${tokens[index].map[0]}"` : ''}><table>`
  md.renderer.rules.table_close = () => '</table></div>'
}

function renderFence(token) {
  const info = parseFenceInfo(token.info || '')
  const line = token.map ? ` data-line="${token.map[0]}"` : ''
  if (info.language === 'mermaid') return `<div class="mermaid-block"${line} data-mermaid="${escapeAttr(token.content)}">${escapeHtml(token.content)}</div>`
  if (info.language === 'md-example' || info.language === 'markdown-example') {
    const preview = md.render(preprocessNotideSyntaxSync(token.content), { headingIds: new Set() })
    return `<section class="markdown-example"${line}><div class="markdown-example-head"><span>${escapeHtml(info.title || markdownLabel('markdownExample'))}</span></div><div class="markdown-example-grid"><div class="markdown-example-preview">${preview}</div><pre class="markdown-example-source"><code>${escapeHtml(token.content)}</code></pre></div></section>`
  }
  let highlighted = escapeHtml(token.content)
  if (info.language && hljs.getLanguage(info.language)) { try { highlighted = hljs.highlight(token.content, { language: info.language }).value } catch { /* preserve escaped code */ } }
  const classes = info.classes.length ? ` ${escapeAttr(info.classes.join(' '))}` : ''
  const attrs = [`data-lang="${escapeAttr(info.language)}"`, `data-code-start="${info.startLine}"`, info.lineNumbers ? 'data-line-numbers="true"' : '', info.highlightedLines.length ? `data-highlight-lines="${info.highlightedLines.join(',')}"` : ''].filter(Boolean).join(' ')
  return `<div class="code-block${classes}"${line} ${attrs}><div class="code-block-head"><span class="code-title">${escapeHtml(info.title || info.language || markdownLabel('code'))}</span>${info.title && info.language ? `<span class="code-lang">${escapeHtml(info.language)}</span>` : ''}</div><pre><code>${highlighted}</code></pre></div>`
}

export function parseFenceInfo(source = '') {
  let rest = source.trim(); let language = ''; let title = ''; let lineNumbers = false; let startLine = 1; const highlightedLines = new Set(); const classes = []
  const leading = /^\{([^{}]+)\}/.exec(rest)
  if (leading) {
    const attrs = pandocAttributes(leading[1]); const classMatch = /class="([^"]*)"/.exec(attrs)
    if (classMatch) classes.push(...classMatch[1].split(/\s+/).filter(Boolean))
    const languageClass = classes.find((name) => !['line-numbers', 'linenos', 'numberLines'].includes(name.toLowerCase()))
    language = languageClass?.toLowerCase() || ''; lineNumbers = classes.some((name) => ['line-numbers', 'linenos', 'numberLines'].includes(name.toLowerCase()))
    const titleMatch = /title="([^"]*)"/.exec(attrs); if (titleMatch) title = titleMatch[1]
    rest = rest.slice(leading[0].length).trim()
  }
  if (!language) { const languageMatch = /^([^\s{]+)/.exec(rest); if (languageMatch) { language = languageMatch[1].toLowerCase(); rest = rest.slice(languageMatch[0].length).trim() } }
  const titleMatch = /(?:^|\s)title=(?:"([^"]*)"|'([^']*)'|([^\s]+))/.exec(rest); if (titleMatch) title = titleMatch[1] || titleMatch[2] || titleMatch[3] || ''
  const bracketTitle = /(?:^|\s)\[([^\]\n]+)\]/.exec(rest); if (!title && bracketTitle) title = bracketTitle[1].trim()
  lineNumbers ||= /(?:^|\s)(?:line-numbers|linenos|numberLines)(?=\s|$)/.test(rest)
  const start = /(?:^|\s)(?:start|startFrom)=(?:"(\d+)"|'(\d+)'|(\d+))/.exec(rest); if (start) startLine = clamp(Number(start[1] || start[2] || start[3]), 1, 100000)
  const highlight = /(?:^|\s)\{(\d[\d,\s-]*)\}/.exec(rest) || /(?:^|\s)(?:hl_lines|highlight)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/.exec(rest); if (highlight) parseLineSpec(highlight[1] || highlight[2] || highlight[3] || '').forEach((line) => highlightedLines.add(line))
  return { language, title, lineNumbers, startLine, highlightedLines: [...highlightedLines].sort((a, b) => a - b), classes }
}

function transformObsidianCallouts(source) {
  const lines = source.split('\n'); const output = []
  for (let index = 0; index < lines.length; index++) {
    const match = /^>\s*\[!([A-Za-z][\w-]*)\]([+-])?(?:\s+(.+?))?\s*$/.exec(lines[index])
    if (!match) { output.push(lines[index]); continue }
    const body = []; let cursor = index + 1
    while (cursor < lines.length && /^>\s?/.test(lines[cursor])) { body.push(lines[cursor].replace(/^>\s?/, '')); cursor++ }
    const type = normalizeCalloutType(match[1]); const suffix = match[2] || ''; const title = match[3] ? ` [${match[3]}]` : ''
    output.push(`::: callout ${suffix}${type}${title}`, ...body, ':::'); index = cursor - 1
  }
  return output.join('\n')
}

function transformTabBlocks(source) {
  const lines = source.split('\n'); const output = []
  for (let index = 0; index < lines.length; index++) {
    const legacy = /^(:{3,})\s+tabs\b(?:\s+.*)?$/.exec(lines[index]); const modern = /^(:{3,})\{tab-set\}\s*(.*?)\s*$/.exec(lines[index])
    if (!legacy && !modern) { output.push(lines[index]); continue }
    const marker = (legacy || modern)[1]; const end = modern ? findModernTabSetEnd(lines, index + 1, marker.length) : findColonEnd(lines, index + 1, marker.length)
    if (end < 0) { output.push(lines[index]); continue }
    const segments = legacy ? parseLegacyTabs(lines, index + 1, end) : parseModernTabs(lines, index + 1, end, marker.length)
    if (!segments.length) { output.push(lines[index]); continue }
    const id = `notide-tabs-${++tabSequence}`; const buttons = segments.map((segment, tabIndex) => `<button type="button" role="tab" id="${id}-tab-${tabIndex}" aria-controls="${id}-panel-${tabIndex}" aria-selected="${tabIndex === 0}" tabindex="${tabIndex === 0 ? 0 : -1}" data-tab-button="${tabIndex}">${escapeHtml(segment.title)}</button>`).join('')
    const panels = segments.map((segment, tabIndex) => `<section class="tab-panel" role="tabpanel" id="${id}-panel-${tabIndex}" aria-labelledby="${id}-tab-${tabIndex}" data-tab-panel="${tabIndex}"${tabIndex === 0 ? '' : ' hidden'}>${md.render(preprocessNotideSyntaxSync(segment.body), { headingIds: new Set() })}</section>`).join('')
    output.push(`<div class="markdown-tabs" data-tabs><div class="tab-list" role="tablist" aria-label="${escapeAttr(markdownLabel('tabs'))}">${buttons}</div>${panels}</div>`); index = end
  }
  return output.join('\n')
}

function parseLegacyTabs(lines, start, end) {
  const markers = []; for (let index = start; index < end; index++) { const match = /^@tab\s+(.+?)\s*$/.exec(lines[index]); if (match) markers.push({ line: index, title: stripBracketTitle(match[1]) || markdownLabel('tab') }) }
  return markers.map((marker, index) => ({ title: marker.title, body: lines.slice(marker.line + 1, markers[index + 1]?.line || end).join('\n') }))
}
function parseModernTabs(lines, start, end, markerLength) {
  const segments = []
  for (let index = start; index < end;) {
    const open = new RegExp(`^:{${markerLength},}\\{tab-item\\}(?:\\s+(.*?))?\\s*$`).exec(lines[index]); if (!open) { index++; continue }
    const close = findColonEnd(lines, index + 1, markerLength); if (close < 0 || close > end) return []
    let contentStart = index + 1; let selected = false
    while (contentStart < close && /^:[a-z][\w-]*:/i.test(lines[contentStart])) { if (/^:selected:/i.test(lines[contentStart])) selected = true; contentStart++ }
    if (!lines[contentStart]?.trim()) contentStart++
    segments.push({ title: stripBracketTitle(open[1] || '') || markdownLabel('tab'), body: lines.slice(contentStart, close).join('\n'), selected }); index = close + 1
  }
  const selected = segments.findIndex((segment) => segment.selected); if (selected > 0) { const [item] = segments.splice(selected, 1); segments.unshift(item) }
  return segments
}
function findColonEnd(lines, start, markerLength) { for (let index = start; index < lines.length; index++) if (new RegExp(`^:{${markerLength},}\\s*$`).test(lines[index])) return index; return -1 }
function findModernTabSetEnd(lines, start, markerLength) {
  let nested = 0
  for (let index = start; index < lines.length; index++) {
    if (new RegExp(`^:{${markerLength},}\\{tab-item\\}`).test(lines[index])) { nested++; continue }
    if (!new RegExp(`^:{${markerLength},}\\s*$`).test(lines[index])) continue
    if (nested > 0) nested--
    else return index
  }
  return -1
}

function mapOutsideFences(source, callback) {
  let fence = null
  return source.split('\n').map((line) => { const opening = /^(\s*)(`{3,}|~{3,})/.exec(line); if (opening) { if (!fence) fence = { char: opening[2][0], length: opening[2].length }; else if (opening[2][0] === fence.char && opening[2].length >= fence.length) fence = null; return line } return fence ? line : callback(line) }).join('\n')
}

function transformOutsideFences(source, transform) {
  const lines = String(source).split('\n')
  const output = []
  const outside = []
  let fence = null
  const flushOutside = () => {
    if (outside.length) output.push(transform(outside.splice(0).join('\n')))
  }
  for (const line of lines) {
    const opening = /^(\s*)(`{3,}|~{3,})/.exec(line)
    if (!opening) {
      if (fence) output.push(line)
      else outside.push(line)
      continue
    }
    flushOutside()
    output.push(line)
    if (!fence) fence = { char: opening[2][0], length: opening[2].length }
    else if (opening[2][0] === fence.char && opening[2].length >= fence.length) fence = null
  }
  flushOutside()
  return output.join('\n')
}

function parseFrontMatterBlock(source) {
  const match = matchFrontMatterBlock(source)
  if (!match) return { present: false, data: {}, raw: '', body: source, errors: [] }
  const raw = match[2]; const errors = []; let data = {}
  if (new TextEncoder().encode(raw).byteLength > 64 * 1024) errors.push('Front Matter exceeds the 64 KiB safety limit')
  else if (!yamlParser) errors.push(yamlLoadError || 'YAML parser is unavailable')
  else { try { const parsed = yamlParser(raw); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed; else if (parsed != null) errors.push('Front Matter root must be a YAML mapping') } catch (error) { errors.push(error?.message || 'Invalid YAML') } }
  return { present: true, data, raw, body: source.slice(match[0].length), errors }
}
function matchFrontMatterBlock(source) { return /^---\r?\n/.test(source) ? /^(---\r?\n)([\s\S]*?)(?:\r?\n---)(?:\r?\n|$)/.exec(source) : null }
function renderFrontMatter(parsed) {
  if (parsed.errors.length) return `<aside class="frontmatter-error"><strong>${escapeHtml(markdownLabel('invalidFrontMatter'))}</strong><ul>${parsed.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul></aside>`
  const rows = Object.entries(parsed.data).map(([key, value]) => `<div class="frontmatter-row"><dt>${escapeHtml(key)}</dt><dd>${renderFrontMatterValue(value)}</dd></div>`).join(''); return rows ? `<details class="frontmatter-properties"><summary>${escapeHtml(markdownLabel('properties'))}</summary><dl>${rows}</dl></details>` : ''
}
function renderFrontMatterValue(value) { if (value == null) return '<span class="frontmatter-empty">-</span>'; if (Array.isArray(value)) return value.map((item) => `<span class="frontmatter-chip">${escapeHtml(String(item))}</span>`).join(''); if (typeof value === 'object') return `<code>${escapeHtml(JSON.stringify(value))}</code>`; return escapeHtml(String(value)) }
function parseWikiTarget(source) { const pipe = source.indexOf('|'); return { raw: (pipe >= 0 ? source.slice(0, pipe) : source).trim(), alias: pipe >= 0 ? source.slice(pipe + 1).trim() : '' } }
function findBlockId(attrs) { const match = /(?:^|\s)#([\w:-]+)/.exec(attrs); return match ? match[1] : '' }
function pandocAttributes(raw) {
  const attrs = []; const classes = []; const pattern = /(?:^|\s)(#[A-Za-z][\w:.-]{0,63}|\.[A-Za-z][\w-]{0,63}|[A-Za-z][\w:-]*(?:=(?:"[^"]*"|'[^']*'|[^\s]+))?)/g
  for (const match of raw.matchAll(pattern)) { const part = match[1]; if (part.startsWith('#')) attrs.push(` id="${escapeAttr(part.slice(1))}"`); else if (part.startsWith('.')) classes.push(part.slice(1)); else { const equals = part.indexOf('='); const name = (equals >= 0 ? part.slice(0, equals) : part).toLowerCase(); let value = equals >= 0 ? part.slice(equals + 1) : name; value = value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2'); if (/^on/.test(name) || ['style', 'src', 'href', 'action', 'formaction', 'srcdoc'].includes(name)) continue; if (['title', 'width', 'height', 'lang', 'dir', 'open', 'start', 'startfrom', 'hl_lines', 'highlight'].includes(name) || /^aria-[a-z-]+$/.test(name) || /^data-[a-z0-9-]+$/.test(name)) attrs.push(` ${name}="${escapeAttr(value.slice(0, 512))}"`) } }
  if (classes.length) attrs.push(` class="${escapeAttr(classes.join(' '))}"`); return attrs.join('')
}
function normalizeCalloutType(value) { const lower = String(value || 'note').toLowerCase(); return CALLOUT_ALIASES[lower] || lower.replace(/[^a-z0-9_-]/g, '') || 'note' }
function calloutTitle(type) { return markdownLabel(type) }
function markdownLabel(key) { const locale = globalThis.document?.documentElement?.lang?.toLowerCase().startsWith('zh') ? 'zh' : 'en'; return MARKDOWN_COPY[locale][key] || MARKDOWN_COPY.en[key] || key }
function stripBracketTitle(value) { const trimmed = String(value).trim(); return /^\[[\s\S]*\]$/.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed }
function slugifyHeading(value) { return String(value).normalize('NFKC').toLowerCase().trim().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section' }
function blockLine(state, line) { return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]) }
function parseLineSpec(source) { const lines = new Set(); for (const part of String(source).split(/[ ,]+/).filter(Boolean)) { const range = /^(\d+)-(\d+)$/.exec(part); if (range) for (let i = Number(range[1]); i <= Math.min(Number(range[2]), Number(range[1]) + 1000); i++) lines.add(i); else if (/^\d+$/.test(part)) lines.add(Number(part)) } return [...lines] }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.trunc(value) : min)) }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]) || char) }
function escapeAttr(value) { return escapeHtml(value).replace(/\n/g, '&#10;') }
