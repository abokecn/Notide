<script setup>
import { computed, defineAsyncComponent, defineComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { syncWorkspace } from './sync.js'

const MarkdownPreview = defineAsyncComponent(() => import('./MarkdownPreview.vue'))

const iconPaths = {
  notebook: ['M5 4.5h12a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z', 'M7 4.5v15', 'M9.5 8h6', 'M9.5 12h6', 'M9.5 16h4'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  star: ['M12 3.8l2.55 5.17 5.71.83-4.13 4.03.98 5.69L12 16.83l-5.11 2.69.98-5.69-4.13-4.03 5.71-.83z'],
  pin: ['M15 4v5l3 3v2H6v-2l3-3V4', 'M12 14v7'],
  archive: ['M4 7h16v12H4z', 'M3 4h18v3H3z', 'M9 11h6'],
  trash: ['M5 7h14', 'M10 11v5', 'M14 11v5', 'M8 7l1 13h6l1-13', 'M9 4h6l1 3H8z'],
  tag: ['M20 13l-7 7-9-9V4h7z', 'M7.5 7.5h.01'],
  search: ['M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4z', 'M16.1 16.1L21 21'],
  plus: ['M12 5v14', 'M5 12h14'],
  settings: ['M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 1.7-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56v.1h-2.4v-.1a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.7-1.7.06-.06A1.7 1.7 0 0 0 8.4 15a1.7 1.7 0 0 0-1.56-1.03h-.1v-2.4h.1A1.7 1.7 0 0 0 8.4 10a1.7 1.7 0 0 0-.34-1.88L8 8.06l1.7-1.7.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 12.67 5v-.1h2.4V5a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.7 1.7-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.9 10h.1v2.4h-.1A1.7 1.7 0 0 0 19.4 15z'],
  chevron: ['M7 10l5 5 5-5'],
  sort: ['M6 5v14', 'M3 16l3 3 3-3', 'M13 7h8', 'M13 12h6', 'M13 17h4'],
  edit: ['M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3z', 'M14.5 7.5l2 2'],
  split: ['M4 5h16v14H4z', 'M12 5v14'],
  eye: ['M2.5 12s3.4-5 9.5-5 9.5 5 9.5 5-3.4 5-9.5 5-9.5-5-9.5-5z', 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  sync: ['M20 11a8 8 0 0 0-14.7-4L3 10', 'M3 5v5h5', 'M4 13a8 8 0 0 0 14.7 4L21 14', 'M21 19v-5h-5'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  bold: ['M7 5h5.5a3.5 3.5 0 0 1 0 7H7z', 'M7 12h6.5a3.5 3.5 0 0 1 0 7H7z', 'M7 5v14'],
  italic: ['M10 5h8', 'M6 19h8', 'M14 5L10 19'],
  strike: ['M5 12h14', 'M8 8.2A4 4 0 0 1 15.5 7', 'M16 15.8A4 4 0 0 1 8.5 17'],
  code: ['M9 7l-4 5 4 5', 'M15 7l4 5-4 5', 'M13 5l-2 14'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  ordered: ['M10 6h10', 'M10 12h10', 'M10 18h10', 'M4 5h1v3', 'M4 11h2l-2 3h2', 'M4 17h2l-2 3h2'],
  check: ['M5 6h2', 'M10 6h10', 'M5 12h2', 'M10 12h10', 'M5 18h2', 'M10 18h10', 'M4 6l1 1 2-2', 'M4 12l1 1 2-2', 'M4 18l1 1 2-2'],
  quote: ['M6 7h5v5H7v5', 'M14 7h5v5h-4v5'],
  link: ['M10 13.5a4 4 0 0 0 5.7.2l2-2a4 4 0 0 0-5.7-5.7l-1.1 1.1', 'M14 10.5a4 4 0 0 0-5.7-.2l-2 2A4 4 0 0 0 12 18l1.1-1.1'],
  image: ['M4 5h16v14H4z', 'M8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M4 16l4-4 3 3 2-2 7 5'],
  table: ['M4 5h16v14H4z', 'M4 10h16', 'M4 15h16', 'M10 5v14', 'M16 5v14'],
  math: ['M5 6h14', 'M7 18l5-12 5 12', 'M9 14h6'],
  undo: ['M9 7L4 12l5 5', 'M4 12h9a7 7 0 0 1 7 7'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  sun: ['M12 4V2', 'M12 22v-2', 'M4.93 4.93L3.5 3.5', 'M20.5 20.5l-1.43-1.43', 'M4 12H2', 'M22 12h-2', 'M4.93 19.07L3.5 20.5', 'M20.5 3.5l-1.43 1.43', 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z'],
  moon: ['M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5z'],
  dot: ['M12 12h.01'],
}

const AppIcon = defineComponent({
  name: 'AppIcon',
  props: { name: { type: String, default: 'dot' }, size: { type: [String, Number], default: 17 } },
  setup(props) {
    return () => h('svg', { width: props.size, height: props.size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, (iconPaths[props.name] || iconPaths.dot).map((d, index) => h('path', { d, key: index })))
  },
})

const STORAGE_KEY = 'notide-notes-v01'
const SETTINGS_KEY = 'notide-settings-v01'
const TOMBSTONE_KEY = 'notide-tombstones-v01'
const LEGACY_STORAGE_KEY = 'sail-markdown-notes-v01'
const LEGACY_SETTINGS_KEY = 'sail-markdown-settings-v01'
const LEGACY_TOMBSTONE_KEY = 'sail-markdown-tombstones-v01'

function migrateStorage() {
  if (typeof localStorage === 'undefined') return
  for (const [legacyKey, currentKey] of [[LEGACY_STORAGE_KEY, STORAGE_KEY], [LEGACY_SETTINGS_KEY, SETTINGS_KEY], [LEGACY_TOMBSTONE_KEY, TOMBSTONE_KEY]]) {
    if (localStorage.getItem(currentKey) == null && localStorage.getItem(legacyKey) != null) localStorage.setItem(currentKey, localStorage.getItem(legacyKey))
    if (localStorage.getItem(legacyKey) != null) localStorage.removeItem(legacyKey)
  }
}

migrateStorage()

const copy = {
  zh: {
    notes: '笔记',
    allNotes: '全部笔记',
    favorites: '收藏',
    recent: '最近编辑',
    uncategorized: '未归类',
    tags: '标签',
    archive: '归档',
    trash: '回收站',
    pinned: '置顶',
    todayGroup: '今天',
    yesterdayGroup: '昨天',
    sort: '排序',
    openMenu: '打开笔记列表',
    closeMenu: '关闭笔记列表',
    toggleFavorite: '切换收藏',
    insertHeading: '标题',
    insertBold: '粗体',
    insertItalic: '斜体',
    insertStrike: '删除线',
    insertCode: '行内代码',
    insertBullet: '无序列表',
    insertOrdered: '有序列表',
    insertTask: '任务列表',
    insertQuote: '引用',
    insertLink: '链接',
    insertImage: '图片',
    insertTable: '表格',
    insertMath: '公式',
    undo: '撤销',
    search: '搜索笔记',
    newNote: '新建笔记',
    untitled: '未命名笔记',
    saved: '已保存',
    local: '本地模式',
    online: '云端已连接',
    edit: '编辑',
    split: '分屏',
    preview: '预览',
    sync: '同步',
    synced: '刚刚同步',
    syncing: '同步中',
    syncError: '同步失败',
    emptySearch: '没有找到匹配笔记',
    titlePlaceholder: '给这篇笔记一个标题',
    bodyPlaceholder: '从一句话开始写…',
    words: '字数',
    lines: '行数',
    cursor: '光标',
    today: '今天',
    settings: '设置',
    focus: '专注模式',
    light: '浅色',
    dark: '深色',
    syncEndpoint: '同步端点',
    endpointHint: '可选。填写 Cloudflare Worker 地址后启用跨端同步。',
    close: '关闭',
    language: '语言',
    noNotes: '还没有笔记',
    createFirst: '创建第一篇笔记',
    delete: '删除笔记',
    deleteConfirm: '确定删除这篇笔记吗？',
    cancel: '取消',
    confirm: '确认删除',
    pin: '置顶笔记',
    unpin: '取消置顶',
    sortRecent: '最近编辑',
    sortTitle: '按标题',
  },
  en: {
    notes: 'Notes',
    allNotes: 'All notes',
    favorites: 'Favorites',
    recent: 'Recently edited',
    uncategorized: 'Uncategorized',
    tags: 'Tags',
    archive: 'Archive',
    trash: 'Trash',
    pinned: 'Pinned',
    todayGroup: 'Today',
    yesterdayGroup: 'Yesterday',
    sort: 'Sort notes',
    openMenu: 'Open notes list',
    closeMenu: 'Close notes list',
    toggleFavorite: 'Toggle favorite',
    insertHeading: 'Heading',
    insertBold: 'Bold',
    insertItalic: 'Italic',
    insertStrike: 'Strikethrough',
    insertCode: 'Inline code',
    insertBullet: 'Bulleted list',
    insertOrdered: 'Numbered list',
    insertTask: 'Task list',
    insertQuote: 'Quote',
    insertLink: 'Link',
    insertImage: 'Image',
    insertTable: 'Table',
    insertMath: 'Formula',
    undo: 'Undo',
    search: 'Search notes',
    newNote: 'New note',
    untitled: 'Untitled note',
    saved: 'Saved',
    local: 'Local mode',
    online: 'Cloud connected',
    edit: 'Edit',
    split: 'Split',
    preview: 'Preview',
    sync: 'Sync',
    synced: 'Synced just now',
    syncing: 'Syncing',
    syncError: 'Sync failed',
    emptySearch: 'No matching notes',
    titlePlaceholder: 'Give this note a title',
    bodyPlaceholder: 'Start with one sentence…',
    words: 'words',
    lines: 'lines',
    cursor: 'cursor',
    today: 'Today',
    settings: 'Settings',
    focus: 'Focus mode',
    light: 'Light',
    dark: 'Dark',
    syncEndpoint: 'Sync endpoint',
    endpointHint: 'Optional. Add a Cloudflare Worker URL to enable multi-device sync.',
    close: 'Close',
    language: 'Language',
    noNotes: 'No notes yet',
    createFirst: 'Create your first note',
    delete: 'Delete note',
    deleteConfirm: 'Delete this note?',
    cancel: 'Cancel',
    confirm: 'Delete',
    pin: 'Pin note',
    unpin: 'Unpin note',
    sortRecent: 'Recently edited',
    sortTitle: 'By title',
  },
}

const language = ref('zh')
const theme = ref('dark')
const viewMode = ref('split')
const showSidebar = ref(true)
const showSettings = ref(false)
const searchQuery = ref('')
const searchInput = ref(null)
const activeSection = ref('all')
const sortMode = ref('recent')
const showSortMenu = ref(false)
const syncState = ref('idle')
const syncEndpoint = ref(import.meta.env.VITE_SYNC_ENDPOINT || '')
const syncToken = ref(import.meta.env.VITE_SYNC_TOKEN || '')
const editor = ref(null)
const tombstones = ref(loadTombstones())
const showDeleteConfirm = ref(false)
const contentHistory = ref([])
const restoringHistory = ref(false)
let syncTimer = null

const seedNotes = [
  {
    id: 'welcome',
    title: 'Welcome to Notide',
    folder: 'Getting started',
    favorite: true,
    pinned: true,
    updatedAt: Date.now(),
    content: `# Welcome to Notide\n\nA calm place for notes that stay yours.\n\n## Start here\n\n- Write in plain Markdown\n- Switch between edit, split, and preview\n- Keep working offline, then sync when you are ready\n\n> Your notes are saved locally as you type.\n\n\`Notide v0.2\``,
  },
  {
    id: 'ideas',
    title: 'Small ideas, kept close',
    folder: 'Personal',
    favorite: false,
    pinned: false,
    updatedAt: Date.now() - 86_400_000,
    content: `# Small ideas, kept close\n\nA notebook should feel lighter than a project tracker.\n\n- One thought per line\n- A little structure, never too much\n- Search when memory is fuzzy`,
  },
  {
    id: 'roadmap',
    title: 'Notide roadmap',
    folder: 'Work',
    favorite: false,
    pinned: false,
    updatedAt: Date.now() - 172_800_000,
    content: `# Notide roadmap\n\n## v0.2\n\n- [x] Markdown editing\n- [x] Offline persistence\n- [x] Chinese and English UI\n- [x] Cloudflare sync\n\n## Later\n\n- Attachments\n- Note links\n- Version history`,
  },
]

const notes = ref(loadNotes())
const selectedId = ref(notes.value[0]?.id || 'welcome')
const activeNote = computed(() => notes.value.find((note) => note.id === selectedId.value) || notes.value[0])
const t = computed(() => copy[language.value])

const visibleNotes = computed(() => {
  let source = [...notes.value]
  if (activeSection.value === 'trash') source = []
  if (activeSection.value === 'favorites') source = source.filter((note) => note.favorite)
  if (activeSection.value === 'uncategorized') source = source.filter((note) => !note.folder || /^(未分类|Unsorted)$/i.test(note.folder))
  if (activeSection.value === 'archive') source = source.filter((note) => note.archived)
  else source = source.filter((note) => !note.archived)
  source.sort(sortMode.value === 'title'
    ? (a, b) => a.title.localeCompare(b.title, language.value === 'zh' ? 'zh-CN' : 'en')
    : (a, b) => b.updatedAt - a.updatedAt)
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return source
  return source.filter((note) => `${note.title} ${note.content} ${note.folder || ''}`.toLowerCase().includes(query))
})

const groupedNotes = computed(() => {
  return visibleNotes.value.reduce((groups, note) => {
    if (note.pinned) return groups
    const key = note.folder || (language.value === 'zh' ? '未分类' : 'Unsorted')
    if (!groups[key]) groups[key] = []
    groups[key].push(note)
    return groups
  }, {})
})
const pinnedNotes = computed(() => visibleNotes.value.filter((note) => note.pinned))

const sectionTitle = computed(() => ({ all: t.value.allNotes, recent: t.value.recent, favorites: t.value.favorites, uncategorized: t.value.uncategorized, archive: t.value.archive, trash: t.value.trash }[activeSection.value] || t.value.allNotes))
const tagCloud = computed(() => {
  const counts = new Map()
  for (const note of notes.value) {
    for (const tag of note.content.matchAll(/(^|[\s(\[>、，；;])#([\p{L}\p{N}_\-/·]{1,60})/gu)) counts.set(tag[2], (counts.get(tag[2]) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8)
})
const navPrimary = computed(() => [
  { key: 'all', label: t.value.allNotes, icon: 'notebook', count: notes.value.length },
  { key: 'recent', label: t.value.recent, icon: 'clock' },
  { key: 'favorites', label: t.value.favorites, icon: 'star', count: notes.value.filter((note) => note.favorite).length },
  { key: 'uncategorized', label: t.value.uncategorized, icon: 'archive', count: notes.value.filter((note) => !note.folder || /^(未分类|Unsorted)$/i.test(note.folder)).length },
])
const navSecondary = computed(() => [
  { key: 'archive', label: t.value.archive, icon: 'archive', count: notes.value.filter((note) => note.archived).length },
  { key: 'trash', label: t.value.trash, icon: 'trash', count: tombstones.value.length },
])

const lineCount = computed(() => (activeNote.value?.content || '').split('\n').length)
const wordCount = computed(() => (activeNote.value?.content || '').trim().split(/\s+/).filter(Boolean).length)

watch([notes, tombstones], ([nextNotes, nextTombstones]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextNotes))
  localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(nextTombstones))
  if (syncEndpoint.value && syncState.value !== 'syncing') scheduleSync()
}, { deep: true })
watch([language, theme, syncEndpoint, syncToken], ([nextLanguage, nextTheme, nextEndpoint, nextToken]) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: nextLanguage, theme: nextTheme, syncEndpoint: nextEndpoint, syncToken: nextToken }))
})
watch(language, (value) => {
  document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en'
}, { immediate: true })
onMounted(() => {
  const settings = loadSettings()
  language.value = settings.language
  theme.value = settings.theme
  syncEndpoint.value = settings.syncEndpoint
  syncToken.value = settings.syncToken
  if (window.innerWidth <= 680) showSidebar.value = false
  if (syncEndpoint.value) window.setTimeout(syncNote, 350)
  window.addEventListener('keydown', handleKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

function loadNotes() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    return Array.isArray(stored) && stored.length ? stored.map((note) => ({ favorite: false, pinned: false, archived: false, ...note })) : seedNotes
  } catch {
    return seedNotes
  }
}

function loadSettings() {
  try {
    return { language: 'zh', theme: 'dark', syncEndpoint: '', syncToken: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return { language: 'zh', theme: 'dark', syncEndpoint: '', syncToken: '' }
  }
}

function loadTombstones() {
  try {
    const stored = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || '[]')
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

function selectNote(id) {
  selectedId.value = id
  if (window.innerWidth <= 680) showSidebar.value = false
  nextTick(() => editor.value?.focus())
}

function setSection(section) {
  activeSection.value = section
  searchQuery.value = ''
}

function filterTag(tag) {
  activeSection.value = 'all'
  searchQuery.value = `#${tag}`
}

function previewText(content) {
  return String(content || '').replace(/^---[\s\S]*?---\s*/m, '').replace(/[#>*_`\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 82) || (language.value === 'zh' ? '空白笔记' : 'Empty note')
}

function createNote() {
  const id = `note-${Date.now()}`
  notes.value.unshift({
    id,
    title: t.value.untitled,
    folder: language.value === 'zh' ? '未分类' : 'Unsorted',
    favorite: false,
    pinned: false,
    updatedAt: Date.now(),
    content: `# ${t.value.untitled}\n\n`,
  })
  selectedId.value = id
  viewMode.value = 'edit'
  nextTick(() => editor.value?.focus())
}

function updateNote(field, value) {
  if (!activeNote.value) return
  if (field === 'content' && !restoringHistory.value && value !== activeNote.value.content) {
    contentHistory.value = [...contentHistory.value.slice(-29), { id: activeNote.value.id, content: activeNote.value.content }]
  }
  activeNote.value[field] = value
  activeNote.value.updatedAt = Date.now()
}

function requestDelete() {
  if (activeNote.value && notes.value.length > 1) showDeleteConfirm.value = true
}

function deleteNote() {
  if (!activeNote.value || notes.value.length <= 1) return
  const index = notes.value.findIndex((note) => note.id === activeNote.value.id)
  tombstones.value = [...tombstones.value.filter((item) => item.id !== activeNote.value.id), { id: activeNote.value.id, deletedAt: Date.now() }]
  notes.value.splice(index, 1)
  selectedId.value = notes.value[Math.max(0, index - 1)]?.id || notes.value[0].id
  showDeleteConfirm.value = false
}

function toggleFavorite() {
  if (activeNote.value) updateNote('favorite', !activeNote.value.favorite)
}

function togglePinned() {
  if (activeNote.value) updateNote('pinned', !activeNote.value.pinned)
}

function undoContent() {
  if (!activeNote.value) return
  const index = [...contentHistory.value].reverse().findIndex((entry) => entry.id === activeNote.value.id)
  if (index < 0) return
  const actualIndex = contentHistory.value.length - 1 - index
  const entry = contentHistory.value[actualIndex]
  contentHistory.value.splice(actualIndex, 1)
  restoringHistory.value = true
  activeNote.value.content = entry.content
  activeNote.value.updatedAt = Date.now()
  nextTick(() => { restoringHistory.value = false; editor.value?.focus() })
}

function chooseSort(mode) {
  sortMode.value = mode
  showSortMenu.value = false
}

function handleKeydown(event) {
  const key = event.key.toLowerCase()
  if ((event.metaKey || event.ctrlKey) && key === 'k') {
    event.preventDefault()
    showSidebar.value = true
    nextTick(() => searchInput.value?.focus())
  } else if ((event.metaKey || event.ctrlKey) && key === 'n') {
    event.preventDefault()
    createNote()
  } else if (event.key === 'Escape') {
    showSettings.value = false
    showDeleteConfirm.value = false
    showSortMenu.value = false
    if (window.innerWidth <= 680) showSidebar.value = false
  }
}

function navigateWiki(rawTarget) {
  const noteTitle = String(rawTarget || '').split('#')[0].trim()
  const target = notes.value.find((note) => note.title.trim().toLowerCase() === noteTitle.toLowerCase())
  if (target) selectNote(target.id)
}

function insertMarkdown(prefix, suffix = prefix) {
  const textarea = editor.value
  if (!textarea || !activeNote.value) return
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selected = activeNote.value.content.slice(start, end) || (language.value === 'zh' ? '文字' : 'text')
  updateNote('content', `${activeNote.value.content.slice(0, start)}${prefix}${selected}${suffix}${activeNote.value.content.slice(end)}`)
  nextTick(() => {
    textarea.focus()
    textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length)
  })
}

function insertLinePrefix(prefix) {
  const textarea = editor.value
  if (!textarea || !activeNote.value) return
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const content = activeNote.value.content
  const lineStart = content.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const lineEnd = content.indexOf('\n', end) === -1 ? content.length : content.indexOf('\n', end)
  const selected = content.slice(lineStart, lineEnd)
  const next = selected.split('\n').map((line) => `${prefix}${line}`).join('\n')
  updateNote('content', `${content.slice(0, lineStart)}${next}${content.slice(lineEnd)}`)
  nextTick(() => { textarea.focus(); textarea.setSelectionRange(lineStart, lineStart + next.length) })
}

function insertHeading() { insertLinePrefix('## ') }
function insertBullet() { insertLinePrefix('- ') }
function insertOrdered() { insertLinePrefix('1. ') }
function insertTask() { insertLinePrefix('- [ ] ') }
function insertQuote() { insertLinePrefix('> ') }
function insertLink() { insertMarkdown('[', '](https://)') }
function insertImage() { insertMarkdown('![', '](https://)') }
function insertTable() { insertMarkdown('| Column | Column |\n| --- | --- |\n| ', ' | value |') }
function insertMath() { insertMarkdown('$', '$') }
function insertCodeBlock() { insertMarkdown('```\n', '\n```') }

function scheduleSync() {
  window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(syncNote, 1000)
}

async function syncNote() {
  if (!activeNote.value && !notes.value.length) return
  if (!syncEndpoint.value.trim()) {
    syncState.value = 'local'
    window.setTimeout(() => (syncState.value = 'idle'), 1600)
    return
  }
  syncState.value = 'syncing'
  try {
    const result = await syncWorkspace({
      endpoint: syncEndpoint.value,
      token: syncToken.value,
      notes: notes.value,
      tombstones: tombstones.value,
    })
    notes.value = result.notes
    tombstones.value = result.tombstones
    syncState.value = 'synced'
  } catch {
    syncState.value = 'error'
  } finally {
    window.setTimeout(() => (syncState.value = 'idle'), 2200)
  }
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(language.value === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}
</script>

<template>
  <div class="app-shell" :class="{ 'navigation-hidden': !showSidebar }" :data-theme="theme">
    <aside class="workspace-nav" :class="{ collapsed: !showSidebar }">
      <div class="nav-brand">
        <img src="/notide-icon.svg" alt="Notide" class="brand-icon" />
        <span class="brand-name">Notide</span>
        <button class="nav-collapse" :title="t.closeMenu" :aria-label="t.closeMenu" @click="showSidebar = false"><AppIcon name="close" :size="18" /></button>
      </div>

      <nav class="nav-primary" :aria-label="t.notes">
        <button v-for="item in navPrimary" :key="item.key" class="nav-item" :class="{ active: activeSection === item.key }" @click="setSection(item.key)">
          <AppIcon :name="item.icon" :size="18" /><span>{{ item.label }}</span><b v-if="item.count != null">{{ item.count }}</b>
        </button>
      </nav>

      <div class="nav-heading">{{ t.tags }}</div>
      <nav class="tag-list" :aria-label="t.tags">
        <button v-for="([tag, count]) in tagCloud" :key="tag" class="tag-item" @click="filterTag(tag)"><AppIcon name="tag" :size="15" /><span>#{{ tag }}</span><b>{{ count }}</b></button>
        <span v-if="!tagCloud.length" class="nav-empty">#{{ language === 'zh' ? '开始记录' : 'start-writing' }}</span>
      </nav>

      <div class="nav-heading nav-heading-secondary">{{ language === 'zh' ? '系统' : 'Workspace' }}</div>
      <nav class="nav-secondary">
        <button v-for="item in navSecondary" :key="item.key" class="nav-item" :class="{ active: activeSection === item.key }" @click="setSection(item.key)">
          <AppIcon :name="item.icon" :size="18" /><span>{{ item.label }}</span><b v-if="item.count">{{ item.count }}</b>
        </button>
      </nav>

      <div class="nav-footer">
        <button class="profile-button" title="Notide workspace"><span class="profile-avatar">N</span><span><strong>Notide workspace</strong><small>{{ syncEndpoint ? t.online : t.local }}</small></span></button>
        <button class="nav-settings" :title="t.settings" :aria-label="t.settings" @click="showSettings = true"><AppIcon name="settings" :size="18" /></button>
      </div>
    </aside>

    <aside class="notes-panel" :class="{ collapsed: !showSidebar }">
      <header class="notes-panel-header">
        <div><span class="eyebrow">NOTIDE / NOTEBOOK</span><h1>{{ sectionTitle }}</h1></div>
        <div class="notes-panel-actions"><div class="sort-control"><button class="panel-icon-button" :title="t.sort" :aria-label="t.sort" :aria-expanded="showSortMenu" @click="showSortMenu = !showSortMenu"><AppIcon name="sort" :size="18" /></button><div v-if="showSortMenu" class="sort-menu" role="menu"><button type="button" :class="{ active: sortMode === 'recent' }" role="menuitem" @click="chooseSort('recent')">{{ t.sortRecent }}</button><button type="button" :class="{ active: sortMode === 'title' }" role="menuitem" @click="chooseSort('title')">{{ t.sortTitle }}</button></div></div><button class="panel-icon-button" :title="t.closeMenu" :aria-label="t.closeMenu" @click="showSidebar = false"><AppIcon name="close" :size="18" /></button></div>
      </header>
      <div class="notes-search"><AppIcon name="search" :size="17" /><input ref="searchInput" v-model="searchQuery" :placeholder="t.search" :aria-label="t.search" /><kbd>⌘ K</kbd></div>
      <button class="new-note" @click="createNote"><AppIcon name="plus" :size="19" /><span>{{ t.newNote }}</span><kbd>⌘ N</kbd></button>

      <div class="notes-list">
        <div class="list-summary"><span>{{ sectionTitle }}</span><span>{{ visibleNotes.length }}</span></div>
        <div v-if="visibleNotes.length" class="note-groups">
          <div v-if="pinnedNotes.length" class="note-group pinned-group">
            <div class="folder-label"><AppIcon name="pin" :size="13" /><span>{{ t.pinned }}</span></div>
            <button v-for="note in pinnedNotes" :key="`pinned-${note.id}`" class="note-item" :class="{ selected: note.id === selectedId }" @click="selectNote(note.id)">
              <span class="note-mark pinned"><AppIcon name="pin" :size="14" /></span>
              <span class="note-copy"><strong>{{ note.title }}</strong><small>{{ previewText(note.content) }}</small><em>{{ formatTime(note.updatedAt) }}</em></span>
            </button>
          </div>
          <div v-for="(group, folder) in groupedNotes" :key="folder" class="note-group">
            <div class="folder-label"><AppIcon name="chevron" :size="13" /><span>{{ folder }}</span></div>
            <button v-for="note in group" :key="note.id" class="note-item" :class="{ selected: note.id === selectedId }" @click="selectNote(note.id)">
              <span class="note-mark" :class="{ favorite: note.favorite }"><AppIcon :name="note.favorite ? 'star' : 'dot'" :size="note.favorite ? 14 : 12" /></span>
              <span class="note-copy"><strong>{{ note.title }}</strong><small>{{ previewText(note.content) }}</small><em>{{ formatTime(note.updatedAt) }}</em></span>
            </button>
          </div>
        </div>
        <div v-else class="empty-state"><AppIcon name="notebook" :size="25" /><p>{{ activeSection === 'trash' ? t.trash : t.emptySearch }}</p><small>{{ activeSection === 'trash' ? `${t.trash} ${t.local.toLowerCase()}` : t.createFirst }}</small></div>
      </div>
    </aside>

    <main class="workspace">
      <header class="editor-topbar">
        <div class="editor-context"><button class="mobile-menu" :title="t.openMenu" :aria-label="t.openMenu" @click="showSidebar = true"><AppIcon name="menu" :size="19" /></button><span>Notide</span><span>/</span></div>
        <div class="title-capsule"><input class="document-title" :value="activeNote?.title" :placeholder="t.titlePlaceholder" :aria-label="t.titlePlaceholder" @input="updateNote('title', $event.target.value)" /><button class="favorite-button" :class="{ starred: activeNote?.favorite }" :title="t.toggleFavorite" :aria-label="t.toggleFavorite" @click="toggleFavorite"><AppIcon name="star" :size="20" /></button><button class="pin-button" :class="{ pinned: activeNote?.pinned }" :title="activeNote?.pinned ? t.unpin : t.pin" :aria-label="activeNote?.pinned ? t.unpin : t.pin" @click="togglePinned"><AppIcon name="pin" :size="18" /></button></div>
        <div class="topbar-actions">
          <span v-if="syncState === 'synced'" class="sync-message">✓ {{ t.synced }}</span><span v-else-if="syncState === 'syncing'" class="sync-message">◌ {{ t.syncing }}</span><span v-else-if="syncState === 'error'" class="sync-message error">× {{ t.syncError }}</span>
          <button class="icon-button" :title="t.sync" :aria-label="t.sync" @click="syncNote"><AppIcon name="sync" :size="18" /></button>
          <button class="icon-button danger-action" :class="{ disabled: notes.length <= 1 }" :title="t.delete" :aria-label="t.delete" :disabled="notes.length <= 1" @click="requestDelete"><AppIcon name="trash" :size="18" /></button>
          <button class="icon-button" :title="t.focus" :aria-label="t.focus" @click="showSidebar = false"><AppIcon name="more" :size="19" /></button>
        </div>
      </header>

      <div class="document-meta"><span>{{ t.today }}</span><span>·</span><span>{{ formatTime(activeNote?.updatedAt || Date.now()) }}</span><span>·</span><span>Markdown</span></div>

      <div class="toolbar">
        <div class="format-tools" role="toolbar" :aria-label="language === 'zh' ? 'Markdown 工具栏' : 'Markdown toolbar'">
          <button class="toolbar-button" :title="t.insertHeading" :aria-label="t.insertHeading" @click="insertHeading"><AppIcon name="notebook" :size="17" /></button>
          <span class="tool-divider"></span>
          <button class="toolbar-button" :title="t.insertBold" :aria-label="t.insertBold" @click="insertMarkdown('**')"><AppIcon name="bold" :size="17" /></button>
          <button class="toolbar-button" :title="t.insertItalic" :aria-label="t.insertItalic" @click="insertMarkdown('*')"><AppIcon name="italic" :size="17" /></button>
          <button class="toolbar-button" :title="t.insertStrike" :aria-label="t.insertStrike" @click="insertMarkdown('~~')"><AppIcon name="strike" :size="17" /></button>
          <button class="toolbar-button" :title="t.insertCode" :aria-label="t.insertCode" @click="insertMarkdown('`')"><AppIcon name="code" :size="17" /></button>
          <span class="tool-divider"></span>
          <button class="toolbar-button" :title="t.insertBullet" :aria-label="t.insertBullet" @click="insertBullet"><AppIcon name="list" :size="17" /></button>
          <button class="toolbar-button" :title="t.insertOrdered" :aria-label="t.insertOrdered" @click="insertOrdered"><AppIcon name="ordered" :size="17" /></button>
          <button class="toolbar-button" :title="t.insertTask" :aria-label="t.insertTask" @click="insertTask"><AppIcon name="check" :size="17" /></button>
          <button class="toolbar-button" :title="t.insertQuote" :aria-label="t.insertQuote" @click="insertQuote"><AppIcon name="quote" :size="17" /></button>
          <span class="tool-divider"></span>
          <button class="toolbar-button" :title="t.insertLink" :aria-label="t.insertLink" @click="insertLink"><AppIcon name="link" :size="17" /></button>
          <button class="toolbar-button" :title="t.insertImage" :aria-label="t.insertImage" @click="insertImage"><AppIcon name="image" :size="17" /></button>
          <button class="toolbar-button" :title="t.insertTable" :aria-label="t.insertTable" @click="insertTable"><AppIcon name="table" :size="17" /></button>
          <button class="toolbar-button" :title="t.insertMath" :aria-label="t.insertMath" @click="insertMath"><AppIcon name="math" :size="17" /></button>
          <button class="toolbar-button" :title="t.insertCode" :aria-label="t.insertCode" @click="insertCodeBlock"><AppIcon name="code" :size="17" /></button>
        </div>
        <div class="view-switcher" role="tablist">
          <button :class="{ active: viewMode === 'edit' }" :aria-selected="viewMode === 'edit'" @click="viewMode = 'edit'"><AppIcon name="edit" :size="16" /><span>{{ t.edit }}</span></button>
          <button :class="{ active: viewMode === 'split' }" :aria-selected="viewMode === 'split'" @click="viewMode = 'split'"><AppIcon name="split" :size="16" /><span>{{ t.split }}</span></button>
          <button :class="{ active: viewMode === 'preview' }" :aria-selected="viewMode === 'preview'" @click="viewMode = 'preview'"><AppIcon name="eye" :size="16" /><span>{{ t.preview }}</span></button>
        </div>
      </div>

      <section class="editor-stage" :class="`mode-${viewMode}`">
        <div v-if="viewMode !== 'preview'" class="editor-pane">
          <div class="editor-gutter" aria-hidden="true"><span v-for="line in lineCount" :key="line">{{ String(line).padStart(2, '0') }}</span></div>
          <textarea ref="editor" class="editor-input" :value="activeNote?.content" :placeholder="t.bodyPlaceholder" spellcheck="false" @input="updateNote('content', $event.target.value)"></textarea>
        </div>
        <div v-if="viewMode !== 'edit'" class="preview-pane">
          <div class="preview-label">READING VIEW</div>
          <MarkdownPreview :source="activeNote?.content || ''" :locale="language" :on-update="(value) => updateNote('content', value)" :on-navigate="navigateWiki" />
        </div>
      </section>

      <footer class="statusbar">
        <div><span class="status-dot"></span>{{ t.saved }}</div><div class="status-stats"><span>{{ wordCount }} {{ t.words }}</span><span>{{ lineCount }} {{ t.lines }}</span><span>Ln 01, Col 01</span><button class="status-action" :class="{ disabled: !contentHistory.length }" :disabled="!contentHistory.length" :title="t.undo" :aria-label="t.undo" @click="undoContent"><AppIcon name="undo" :size="15" /></button></div>
      </footer>
    </main>

    <div v-if="showSettings" class="modal-backdrop" @click.self="showSettings = false">
      <section class="settings-modal" role="dialog" aria-modal="true" :aria-label="t.settings">
        <div class="modal-header"><div><span class="eyebrow">NOTIDE / PREFERENCES</span><h2>{{ t.settings }}</h2></div><button class="icon-button" :title="t.close" :aria-label="t.close" @click="showSettings = false"><AppIcon name="close" :size="18" /></button></div>
        <label class="setting-row"><span>{{ t.language }}</span><select v-model="language"><option value="zh">中文</option><option value="en">English</option></select></label>
        <label class="setting-row"><span>{{ t.light }} / {{ t.dark }}</span><button class="theme-toggle" :title="theme === 'light' ? t.dark : t.light" @click="theme = theme === 'light' ? 'dark' : 'light'"><span :class="{ active: theme === 'light' }"><AppIcon name="sun" :size="15" /></span><span :class="{ active: theme === 'dark' }"><AppIcon name="moon" :size="15" /></span></button></label>
        <label class="setting-stack"><span>{{ t.syncEndpoint }}</span><input v-model="syncEndpoint" placeholder="https://notide-sync.example.workers.dev" /><input v-model="syncToken" type="password" placeholder="SYNC_TOKEN (optional)" /><small>{{ t.endpointHint }}</small></label>
        <div class="modal-actions"><button class="ghost-button" @click="showSettings = false">{{ t.close }}</button><button class="primary-button" @click="syncNote(); showSettings = false">{{ t.sync }}</button></div>
      </section>
    </div>

    <div v-if="showDeleteConfirm" class="modal-backdrop" @click.self="showDeleteConfirm = false">
      <section class="settings-modal confirm-modal" role="dialog" aria-modal="true" :aria-label="t.delete">
        <div class="modal-header"><div><span class="eyebrow">NOTIDE / {{ t.delete }}</span><h2>{{ t.deleteConfirm }}</h2></div><button class="icon-button" :title="t.cancel" :aria-label="t.cancel" @click="showDeleteConfirm = false"><AppIcon name="close" :size="18" /></button></div>
        <div class="modal-actions"><button class="ghost-button" @click="showDeleteConfirm = false">{{ t.cancel }}</button><button class="primary-button danger-button" @click="deleteNote">{{ t.confirm }}</button></div>
      </section>
    </div>
  </div>
</template>
