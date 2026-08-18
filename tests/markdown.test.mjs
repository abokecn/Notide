import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { detectNotideSyntaxDependencies, extractFrontMatter, preprocessNotideSyntax } from '../src/markdown.js'

const root = new URL('..', import.meta.url)
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8')

test('Notide syntax dependencies stay lazy and retain the highlight.js common profile', () => {
  const commonLanguages = [
    'xml', 'bash', 'c', 'cpp', 'csharp', 'css', 'markdown', 'diff', 'ruby', 'go', 'graphql', 'ini',
    'java', 'javascript', 'json', 'kotlin', 'less', 'lua', 'makefile', 'perl', 'objectivec', 'php',
    'php-template', 'plaintext', 'python', 'python-repl', 'r', 'rust', 'scss', 'shell', 'sql', 'swift',
    'yaml', 'typescript', 'vbnet', 'wasm',
  ]
  const source = commonLanguages.flatMap((language) => [`\`\`\`${language}`, 'value', '\`\`\`']).join('\n')
  assert.deepEqual(detectNotideSyntaxDependencies(source).languages, [...commonLanguages].sort())

  const aliases = ['```tsx', 'const value: number = 1', '```', '```html', '<p>Hi</p>', '```', '```shellsession', '$ echo hi', '```', '```yml', 'key: value', '```'].join('\n')
  assert.deepEqual(detectNotideSyntaxDependencies(aliases).languages, ['shell', 'typescript', 'xml', 'yaml'])

  const markdown = read('src/markdown.js')
  assert.match(markdown, /preprocessNotideSyntax/)
  assert.match(markdown, /notide_math_inline/)
  assert.equal(markdown.includes(['preprocess', 'Ink', 'stone', 'Syntax'].join('')), false)
  assert.equal(markdown.includes(['ink', 'math'].join('_')), false)
  assert.doesNotMatch(markdown, /highlight\.js\/lib\/common/)
  assert.doesNotMatch(markdown, /^import .* from ['"](?:yaml|katex)['"]/m)
})

test('dependency detection respects fences and scans md-example previews', () => {
  const fenced = ['```text', '$not-math$', '---', 'key: not-frontmatter', '---', '```'].join('\n')
  assert.deepEqual(detectNotideSyntaxDependencies(fenced), { frontMatter: false, math: false, languages: ['plaintext'] })

  const example = ['````md-example', '---', 'title: Nested', '---', '$E=mc^2$', '```py', 'print("ok")', '```', '````'].join('\n')
  assert.deepEqual(detectNotideSyntaxDependencies(example), { frontMatter: true, math: true, languages: ['python'] })
})

test('Notide preprocessing keeps front matter and fenced extension boundaries intact', async () => {
  const source = [
    '---',
    'title: Test note',
    'tags: [one, two]',
    '---',
    '',
    '```md',
    '> [!NOTE] This stays source',
    '```',
    '',
    '> [!NOTE]+ Visible callout',
    '> Body',
    '',
    '[[Target#Heading|Alias]] and ((block-id)) #tag',
  ].join('\n')
  assert.deepEqual(await extractFrontMatter(source), { title: 'Test note', tags: ['one', 'two'] })
  const prepared = await preprocessNotideSyntax(source)
  assert.match(prepared, /frontmatter-properties/)
  assert.match(prepared, /```md\n> \[!NOTE\] This stays source\n```/)
  assert.match(prepared, /::: callout \+note \[Visible callout\]/)
  assert.match(prepared, /data-wikilink="Target#Heading"/)
  assert.match(prepared, /data-block-ref="block-id"/)
  assert.match(prepared, /data-tag="tag"/)

  const invalid = await preprocessNotideSyntax(['---', 'title: [broken', '---', '# Body'].join('\n'))
  assert.match(invalid, /frontmatter-error/)
  assert.match(invalid, /Front Matter/)
})

test('tab containers transform outside fences and remain literal inside examples', async () => {
  const source = [
    '```md',
    '::: tabs',
    '@tab Literal',
    'Inside code',
    ':::',
    '```',
    '',
    '::: tabs',
    '@tab First',
    'Visible panel',
    '@tab Second',
    'Another panel',
    ':::',
  ].join('\n')
  const prepared = await preprocessNotideSyntax(source)
  assert.match(prepared, /```md\n::: tabs\n@tab Literal\nInside code\n:::\n```/)
  assert.match(prepared, /class="markdown-tabs"/)
  assert.match(prepared, /data-tab-button="0"/)
  assert.match(prepared, /Visible panel/)
})

test('preview discards stale async renders and observes Mermaid near the viewport', () => {
  const preview = read('src/MarkdownPreview.vue')
  const markdown = read('src/markdown.js')
  assert.match(preview, /const currentRender = \+\+renderId/)
  assert.match(preview, /currentRender !== renderId/)
  assert.match(preview, /onBeforeUnmount\(\(\) => \{ renderId\+\+; disposeMermaid\(\) \}\)/)
  assert.match(markdown, /IntersectionObserver/)
  assert.match(markdown, /rootMargin: '320px 0px'/)
  assert.match(markdown, /observer\.unobserve\(entry\.target\)/)
})
