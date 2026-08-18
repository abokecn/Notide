export const MAX_LOCAL_MARKDOWN_BYTES = 1024 * 1024
export const MARKDOWN_FILE_ACCEPT = '.md,.markdown,.mdown,.mkd,text/markdown'

const MARKDOWN_EXTENSION = /\.(?:md|markdown|mdown|mkd)$/i
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export function isMarkdownFileName(fileName) {
  return MARKDOWN_EXTENSION.test(String(fileName || '').trim())
}

export function markdownByteLength(content) {
  return new TextEncoder().encode(String(content ?? '')).byteLength
}

export function validateMarkdownFile(file, maxBytes = MAX_LOCAL_MARKDOWN_BYTES) {
  if (!isMarkdownFileName(file?.name)) return 'unsupported'
  const size = Number(file?.size)
  if (Number.isFinite(size) && size > maxBytes) return 'too-large'
  return ''
}

export function validateMarkdownContent(content, maxBytes = MAX_LOCAL_MARKDOWN_BYTES) {
  return markdownByteLength(content) > maxBytes ? 'too-large' : ''
}

function fileStem(fileName) {
  const leaf = String(fileName || '').split(/[\\/]/).pop() || ''
  return leaf.replace(MARKDOWN_EXTENSION, '').trim()
}

function cleanHeadingTitle(value) {
  return String(value || '')
    .replace(/\s+#+\s*$/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function firstMarkdownHeading(content) {
  const lines = String(content ?? '').split(/\r?\n/)
  let fence = null
  let inFrontMatter = lines[0]?.replace(/^\uFEFF/, '').trim() === '---'

  for (let index = 0; index < lines.length; index += 1) {
    const line = index === 0 ? lines[index].replace(/^\uFEFF/, '') : lines[index]
    if (inFrontMatter) {
      if (index > 0 && /^(?:---|\.\.\.)\s*$/.test(line.trim())) inFrontMatter = false
      continue
    }

    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (!fence) fence = { marker, length: fenceMatch[1].length }
      else if (marker === fence.marker && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) fence = null
      continue
    }
    if (fence) continue

    const heading = /^\s{0,3}#\s+(.+?)\s*$/.exec(line)
    if (heading) return cleanHeadingTitle(heading[1]).slice(0, 180)
  }
  return ''
}

export function deriveMarkdownTitle(content, fileName, fallback = 'Untitled note') {
  return firstMarkdownHeading(content) || fileStem(fileName) || fallback
}

export function markdownDownloadName(title, fallback = 'note') {
  let base = fileStem(title) || String(title || '').trim() || fallback
  base = base
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
  if (!base || base === '.' || base === '..') base = fallback
  if (WINDOWS_RESERVED_NAME.test(base)) base = `_${base}`
  base = Array.from(base).slice(0, 120).join('').replace(/[. ]+$/g, '') || fallback
  return `${base}.md`
}

export function buildImportedMarkdownNote({ id, fileName, content, folder, now = Date.now(), untitled = 'Untitled note' }) {
  const source = String(content ?? '')
  return {
    id: String(id),
    title: deriveMarkdownTitle(source, fileName, untitled),
    folder: String(folder || ''),
    favorite: false,
    pinned: false,
    archived: false,
    updatedAt: Number(now),
    content: source,
  }
}
