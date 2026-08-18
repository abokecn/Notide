<script setup>
import { computed, defineAsyncComponent, defineComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { syncWorkspace, testSyncConnection } from './sync.js'

const MarkdownPreview = defineAsyncComponent(() => import('./MarkdownPreview.vue'))
const MarkdownEditor = defineAsyncComponent(() => import('./MarkdownEditor.vue'))

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
  redo: ['M15 7l5 5-5 5', 'M20 12h-9a7 7 0 0 0-7 7'],
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
const UI_STATE_KEY = 'notide-ui-state-v01'
const TOKEN_KEY = 'notide-sync-token-v01'
const SESSION_TOKEN_KEY = 'notide-sync-token-session-v01'
const LEGACY_STORAGE_KEY = 'sail-markdown-notes-v01'
const LEGACY_SETTINGS_KEY = 'sail-markdown-settings-v01'
const LEGACY_TOMBSTONE_KEY = 'sail-markdown-tombstones-v01'
const shortcutModifier = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘' : 'Ctrl'

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
    insertCallout: 'Callout',
    insertTabs: '标签页',
    moreTools: '更多格式',
    undo: '撤销',
    redo: '重做',
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
    syncToken: '同步令牌',
    rememberToken: '记住此设备',
    testConnection: '测试连接',
    connectionTesting: '正在测试连接',
    connectionReady: '连接正常，R2 可用',
    connectionLegacy: '连接正常，建议更新 Worker',
    saveAndSync: '保存并同步',
    disconnect: '留空即可关闭云同步。',
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
    insertCallout: 'Callout',
    insertTabs: 'Tabs',
    moreTools: 'More formatting',
    undo: 'Undo',
    redo: 'Redo',
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
    syncToken: 'Sync token',
    rememberToken: 'Remember on this device',
    testConnection: 'Test connection',
    connectionTesting: 'Testing connection',
    connectionReady: 'Connection ready, R2 available',
    connectionLegacy: 'Connection ready; update the Worker when convenient',
    saveAndSync: 'Save and sync',
    disconnect: 'Leave the endpoint empty to disable cloud sync.',
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

const initialSettings = loadSettings()
const initialUiState = loadUiState()
const language = ref(initialSettings.language)
const theme = ref(initialSettings.theme)
const viewMode = ref(initialUiState.viewMode || 'split')
const showSidebar = ref(true)
const showSettings = ref(false)
const searchQuery = ref('')
const searchInput = ref(null)
const activeSection = ref('all')
const sortMode = ref(initialUiState.sortMode || 'recent')
const showSortMenu = ref(false)
const showMoreTools = ref(false)
const syncState = ref('idle')
const syncEndpoint = ref(initialSettings.syncEndpoint)
const syncDisabled = ref(initialSettings.syncDisabled)
const syncToken = ref(loadSyncToken(initialSettings.syncToken))
const rememberSyncToken = ref(initialSettings.rememberToken)
const settingsDraft = ref(createSettingsDraft())
const connectionState = ref('idle')
const connectionMessage = ref('')
const editor = ref(null)
const tombstones = ref(loadTombstones())
const showDeleteConfirm = ref(false)
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth <= 860)
const isSavingSettings = ref(false)
const settingsModal = ref(null)
const settingsFirstControl = ref(null)
const deleteModal = ref(null)
const deleteCancelButton = ref(null)
const mobileMenuButton = ref(null)
const notesPanelCloseButton = ref(null)
const sortTrigger = ref(null)
const sortMenu = ref(null)
const moreToolsTrigger = ref(null)
const moreToolsMenu = ref(null)
const editorCursor = ref({ line: 1, column: 1, from: 0, to: 0 })
const editorHistory = ref({ canUndo: false, canRedo: false })
const editorStates = ref(initialUiState.editorStates || {})
let syncTimer = null
let uiStateTimer = null
let connectionController = null
let settingsReturnFocus = null
let deleteReturnFocus = null

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
const selectedId = ref(notes.value.some((note) => note.id === initialUiState.selectedId) ? initialUiState.selectedId : notes.value[0]?.id || 'welcome')
const activeNote = computed(() => notes.value.find((note) => note.id === selectedId.value) || notes.value[0])
const t = computed(() => copy[language.value])
const activeEditorState = computed(() => editorStates.value[selectedId.value] || null)
const modalOpen = computed(() => showSettings.value || showDeleteConfirm.value)
const drawerOpen = computed(() => isMobile.value && showSidebar.value && !modalOpen.value)
const settingsBusy = computed(() => connectionState.value === 'testing' || isSavingSettings.value)
const syncStatusText = computed(() => ({
  syncing: t.value.syncing,
  synced: t.value.synced,
  error: t.value.syncError,
  local: t.value.local,
}[syncState.value] || t.value.saved))

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
const wordCount = computed(() => {
  const source = activeNote.value?.content || ''
  const cjk = source.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length || 0
  const words = source.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length || 0
  return cjk + words
})

watch([notes, tombstones], ([nextNotes, nextTombstones]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextNotes))
  localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(nextTombstones))
  if (syncEndpoint.value && syncState.value !== 'syncing') scheduleSync()
}, { deep: true })
watch([language, theme, syncEndpoint, syncDisabled, rememberSyncToken], ([nextLanguage, nextTheme, nextEndpoint, nextDisabled, nextRemember]) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: nextLanguage, theme: nextTheme, syncEndpoint: nextEndpoint, syncDisabled: nextDisabled, rememberToken: nextRemember }))
})
watch([selectedId, viewMode, sortMode, editorStates], scheduleUiStateSave, { deep: true })
watch(language, (value) => {
  document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en'
}, { immediate: true })
onMounted(() => {
  updateViewport()
  if (isMobile.value) {
    showSidebar.value = false
    viewMode.value = 'edit'
  }
  if (syncEndpoint.value) window.setTimeout(syncNote, 350)
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', updateViewport)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', updateViewport)
  window.clearTimeout(syncTimer)
  window.clearTimeout(uiStateTimer)
  connectionController?.abort()
})

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
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    const embeddedToken = String(stored.syncToken || '')
    if (embeddedToken && !localStorage.getItem(TOKEN_KEY) && !sessionStorage.getItem(SESSION_TOKEN_KEY)) {
      localStorage.setItem(TOKEN_KEY, embeddedToken)
    }
    const syncDisabled = stored.syncDisabled === true
    const syncEndpoint = syncDisabled
      ? ''
      : String(stored.syncEndpoint || '').trim() || String(import.meta.env.VITE_SYNC_ENDPOINT || '').trim()
    return {
      language: stored.language === 'en' ? 'en' : 'zh',
      theme: stored.theme === 'light' ? 'light' : 'dark',
      syncEndpoint,
      syncDisabled,
      rememberToken: typeof stored.rememberToken === 'boolean' ? stored.rememberToken : isNativeClient() || Boolean(localStorage.getItem(TOKEN_KEY)),
      syncToken: embeddedToken || String(import.meta.env.VITE_SYNC_TOKEN || ''),
    }
  } catch {
    return {
      language: 'zh',
      theme: 'dark',
      syncEndpoint: String(import.meta.env.VITE_SYNC_ENDPOINT || '').trim(),
      syncDisabled: false,
      rememberToken: isNativeClient(),
      syncToken: String(import.meta.env.VITE_SYNC_TOKEN || ''),
    }
  }
}

function loadUiState() {
  try {
    const stored = JSON.parse(localStorage.getItem(UI_STATE_KEY) || '{}')
    return {
      selectedId: String(stored.selectedId || ''),
      viewMode: ['edit', 'split', 'preview'].includes(stored.viewMode) ? stored.viewMode : 'split',
      sortMode: stored.sortMode === 'title' ? 'title' : 'recent',
      editorStates: stored.editorStates && typeof stored.editorStates === 'object' ? stored.editorStates : {},
    }
  } catch {
    return { selectedId: '', viewMode: 'split', sortMode: 'recent', editorStates: {} }
  }
}

function loadSyncToken(fallback = '') {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(SESSION_TOKEN_KEY) || fallback
}

function isNativeClient() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)
}

function persistSyncToken(value, remember) {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(SESSION_TOKEN_KEY)
  if (!value) return
  if (remember) localStorage.setItem(TOKEN_KEY, value)
  else sessionStorage.setItem(SESSION_TOKEN_KEY, value)
}

function scheduleUiStateSave() {
  window.clearTimeout(uiStateTimer)
  uiStateTimer = window.setTimeout(() => {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({
      selectedId: selectedId.value,
      viewMode: viewMode.value,
      sortMode: sortMode.value,
      editorStates: editorStates.value,
    }))
  }, 180)
}

function createSettingsDraft() {
  return {
    language: language.value,
    theme: theme.value,
    syncEndpoint: syncEndpoint.value,
    syncToken: syncToken.value,
    rememberToken: rememberSyncToken.value,
  }
}

function updateViewport() {
  isMobile.value = window.innerWidth <= 860
}

function activeElementWithFocus() {
  const element = document.activeElement
  return element && typeof element.focus === 'function' ? element : null
}

function trapModalFocus(event, modal) {
  if (!modal) return
  const controls = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => element.getClientRects().length > 0)
  if (!controls.length) return
  const first = controls[0]
  const last = controls.at(-1)
  if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}

function openSettings() {
  settingsReturnFocus = activeElementWithFocus()
  settingsDraft.value = createSettingsDraft()
  connectionState.value = 'idle'
  connectionMessage.value = ''
  showSettings.value = true
  nextTick(() => settingsFirstControl.value?.focus())
}

function closeSettings() {
  if (!showSettings.value) return
  connectionController?.abort()
  connectionController = null
  showSettings.value = false
  const target = settingsReturnFocus
  settingsReturnFocus = null
  nextTick(() => target?.isConnected && target.focus())
}

function connectionErrorText(code) {
  const messages = language.value === 'zh'
    ? {
        sync_endpoint_required: '请填写 Worker 地址。',
        sync_endpoint_invalid: '地址格式无效，请填写 Worker 基础地址。',
        sync_endpoint_protocol: '只支持 HTTP 或 HTTPS 地址。',
        sync_endpoint_insecure: '公网同步必须使用 HTTPS。',
        sync_auth_unauthorized: '令牌不正确，Worker 返回 401。',
        sync_auth_forbidden: '当前令牌没有访问权限。',
        sync_endpoint_not_found: '没有找到 Notide Worker API。',
        sync_storage_unavailable: 'Worker 已连接，但 R2 绑定不可用。',
        sync_service_mismatch: '该地址不是兼容的 Notide Worker。',
        sync_response_invalid: 'Worker 返回了无法识别的响应。',
        sync_connection_aborted: '连接测试超时。',
        sync_network_or_cors: '无法连接，请检查网络、地址和 CORS。',
        sync_service_unavailable: 'Worker 服务暂时不可用。',
      }
    : {
        sync_endpoint_required: 'Enter the Worker URL.',
        sync_endpoint_invalid: 'Enter a valid Worker base URL.',
        sync_endpoint_protocol: 'Only HTTP and HTTPS URLs are supported.',
        sync_endpoint_insecure: 'Remote sync must use HTTPS.',
        sync_auth_unauthorized: 'The token is incorrect; the Worker returned 401.',
        sync_auth_forbidden: 'This token does not have access.',
        sync_endpoint_not_found: 'No compatible Notide Worker API was found.',
        sync_storage_unavailable: 'The Worker responded, but its R2 binding is unavailable.',
        sync_service_mismatch: 'This URL is not a compatible Notide Worker.',
        sync_response_invalid: 'The Worker returned an invalid response.',
        sync_connection_aborted: 'The connection test timed out.',
        sync_network_or_cors: 'Could not connect; check the network, URL, and CORS.',
        sync_service_unavailable: 'The Worker is temporarily unavailable.',
      }
  return messages[code] || (language.value === 'zh' ? '连接测试失败。' : 'Connection test failed.')
}

async function testDraftConnection() {
  connectionController?.abort()
  connectionController = new AbortController()
  const timeout = window.setTimeout(() => connectionController?.abort(), 8000)
  connectionState.value = 'testing'
  connectionMessage.value = t.value.connectionTesting
  try {
    const result = await testSyncConnection({
      endpoint: settingsDraft.value.syncEndpoint,
      token: settingsDraft.value.syncToken,
      signal: connectionController.signal,
    })
    settingsDraft.value.syncEndpoint = result.endpoint
    connectionState.value = 'ready'
    connectionMessage.value = result.legacy ? t.value.connectionLegacy : t.value.connectionReady
    return result
  } catch (error) {
    connectionState.value = 'error'
    connectionMessage.value = connectionErrorText(error?.code)
    return null
  } finally {
    window.clearTimeout(timeout)
    connectionController = null
  }
}

async function saveSettingsAndSync() {
  if (settingsBusy.value) return
  isSavingSettings.value = true
  try {
    if (settingsDraft.value.syncEndpoint.trim() && !await testDraftConnection()) return
    const endpoint = settingsDraft.value.syncEndpoint.trim()

    language.value = settingsDraft.value.language
    theme.value = settingsDraft.value.theme
    syncEndpoint.value = endpoint
    syncDisabled.value = !endpoint
    syncToken.value = settingsDraft.value.syncToken
    rememberSyncToken.value = settingsDraft.value.rememberToken
    persistSyncToken(syncToken.value, rememberSyncToken.value)
    closeSettings()
    if (syncEndpoint.value) await syncNote()
    else syncState.value = 'idle'
  } finally {
    isSavingSettings.value = false
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
  if (isMobile.value) showSidebar.value = false
  nextTick(() => editor.value?.focus())
}

function openSidebar() {
  showSidebar.value = true
  if (isMobile.value) nextTick(() => notesPanelCloseButton.value?.focus())
}

function closeSidebar({ restoreFocus = false } = {}) {
  showSidebar.value = false
  if (restoreFocus && isMobile.value) nextTick(() => mobileMenuButton.value?.focus())
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
    content: '',
  })
  selectedId.value = id
  viewMode.value = 'edit'
  nextTick(() => editor.value?.focus())
}

function updateNote(field, value) {
  if (!activeNote.value) return
  if (activeNote.value[field] === value) return
  activeNote.value[field] = value
  activeNote.value.updatedAt = Date.now()
}

function requestDelete() {
  if (!activeNote.value || notes.value.length <= 1) return
  deleteReturnFocus = activeElementWithFocus()
  showDeleteConfirm.value = true
  nextTick(() => deleteCancelButton.value?.focus())
}

function closeDeleteConfirm() {
  if (!showDeleteConfirm.value) return
  showDeleteConfirm.value = false
  const target = deleteReturnFocus
  deleteReturnFocus = null
  nextTick(() => target?.isConnected && target.focus())
}

function deleteNote() {
  if (!activeNote.value || notes.value.length <= 1) return
  const index = notes.value.findIndex((note) => note.id === activeNote.value.id)
  tombstones.value = [...tombstones.value.filter((item) => item.id !== activeNote.value.id), { id: activeNote.value.id, deletedAt: Date.now() }]
  notes.value.splice(index, 1)
  selectedId.value = notes.value[Math.max(0, index - 1)]?.id || notes.value[0].id
  showDeleteConfirm.value = false
  deleteReturnFocus = null
  nextTick(() => editor.value?.focus())
}

function toggleFavorite() {
  if (activeNote.value) updateNote('favorite', !activeNote.value.favorite)
}

function togglePinned() {
  if (activeNote.value) updateNote('pinned', !activeNote.value.pinned)
}

function undoContent() {
  editor.value?.undo()
}

function redoContent() {
  editor.value?.redo()
}

function chooseSort(mode) {
  sortMode.value = mode
  showSortMenu.value = false
  nextTick(() => sortTrigger.value?.focus())
}

function toggleSortMenu() {
  showSortMenu.value = !showSortMenu.value
  showMoreTools.value = false
  if (showSortMenu.value) nextTick(() => sortMenu.value?.querySelector('button')?.focus())
}

function toggleMoreTools() {
  showMoreTools.value = !showMoreTools.value
  showSortMenu.value = false
  if (showMoreTools.value) nextTick(() => moreToolsMenu.value?.querySelector('button')?.focus())
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
    if (showDeleteConfirm.value) return closeDeleteConfirm()
    if (showSettings.value) return closeSettings()
    if (showMoreTools.value) {
      showMoreTools.value = false
      return nextTick(() => moreToolsTrigger.value?.focus())
    }
    if (showSortMenu.value) {
      showSortMenu.value = false
      return nextTick(() => sortTrigger.value?.focus())
    }
    if (drawerOpen.value) closeSidebar({ restoreFocus: true })
  }
}

function navigateWiki(rawTarget) {
  const noteTitle = String(rawTarget || '').split('#')[0].trim()
  const target = notes.value.find((note) => note.title.trim().toLowerCase() === noteTitle.toLowerCase())
  if (target) selectNote(target.id)
}

function formatMarkdown(name) {
  if (viewMode.value === 'preview') return
  editor.value?.format(name)
  showMoreTools.value = false
}

function handleCursorChange(value) {
  editorCursor.value = value
}

function handleHistoryChange(value) {
  editorHistory.value = value
}

function handleEditorState(value) {
  if (!value?.noteId) return
  editorStates.value = { ...editorStates.value, [value.noteId]: value }
  const ids = Object.keys(editorStates.value)
  if (ids.length > 40) {
    const activeIds = new Set(notes.value.slice(0, 40).map((note) => note.id))
    editorStates.value = Object.fromEntries(Object.entries(editorStates.value).filter(([id]) => activeIds.has(id)))
  }
}

function scheduleSync() {
  window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(syncNote, 1000)
}

async function syncNote() {
  if (syncState.value === 'syncing') return
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
    <aside class="workspace-nav" :class="{ collapsed: !showSidebar }" :inert="modalOpen">
      <div class="nav-brand">
        <img src="/notide-icon.svg" alt="" aria-hidden="true" class="brand-icon" />
        <span class="brand-name">Notide</span>
        <button type="button" class="nav-collapse" :title="t.closeMenu" :aria-label="t.closeMenu" @click="closeSidebar()"><AppIcon name="close" :size="18" /></button>
      </div>

      <nav class="nav-primary" :aria-label="t.notes">
        <button v-for="item in navPrimary" :key="item.key" type="button" class="nav-item" :class="{ active: activeSection === item.key }" :aria-current="activeSection === item.key ? 'page' : undefined" @click="setSection(item.key)">
          <AppIcon :name="item.icon" :size="18" /><span>{{ item.label }}</span><b v-if="item.count != null">{{ item.count }}</b>
        </button>
      </nav>

      <div class="nav-heading">{{ t.tags }}</div>
      <nav class="tag-list" :aria-label="t.tags">
        <button v-for="([tag, count]) in tagCloud" :key="tag" type="button" class="tag-item" @click="filterTag(tag)"><AppIcon name="tag" :size="15" /><span>#{{ tag }}</span><b>{{ count }}</b></button>
        <span v-if="!tagCloud.length" class="nav-empty">#{{ language === 'zh' ? '开始记录' : 'start-writing' }}</span>
      </nav>

      <div class="nav-heading nav-heading-secondary">{{ language === 'zh' ? '系统' : 'Workspace' }}</div>
      <nav class="nav-secondary">
        <button v-for="item in navSecondary" :key="item.key" type="button" class="nav-item" :class="{ active: activeSection === item.key }" :aria-current="activeSection === item.key ? 'page' : undefined" @click="setSection(item.key)">
          <AppIcon :name="item.icon" :size="18" /><span>{{ item.label }}</span><b v-if="item.count">{{ item.count }}</b>
        </button>
      </nav>

      <div class="nav-footer">
        <button type="button" class="profile-button" :title="t.settings" @click="openSettings"><span class="profile-avatar">N</span><span><strong>Notide workspace</strong><small>{{ syncEndpoint ? t.online : t.local }}</small></span></button>
        <button type="button" class="nav-settings" :title="t.settings" :aria-label="t.settings" @click="openSettings"><AppIcon name="settings" :size="18" /></button>
      </div>
    </aside>

    <aside id="notes-panel" class="notes-panel" :class="{ collapsed: !showSidebar }" :inert="modalOpen" :role="drawerOpen ? 'dialog' : undefined" :aria-modal="drawerOpen ? 'true' : undefined" :aria-label="drawerOpen ? t.notes : undefined">
      <header class="notes-panel-header">
        <div><span class="eyebrow">NOTIDE / NOTEBOOK</span><h1>{{ sectionTitle }}</h1></div>
        <div class="notes-panel-actions"><div class="sort-control"><button ref="sortTrigger" type="button" class="panel-icon-button" :title="t.sort" :aria-label="t.sort" aria-haspopup="true" aria-controls="sort-menu" :aria-expanded="showSortMenu" @click="toggleSortMenu"><AppIcon name="sort" :size="18" /></button><div v-if="showSortMenu" id="sort-menu" ref="sortMenu" class="sort-menu" role="group" :aria-label="t.sort"><button type="button" :class="{ active: sortMode === 'recent' }" :aria-pressed="sortMode === 'recent'" @click="chooseSort('recent')">{{ t.sortRecent }}</button><button type="button" :class="{ active: sortMode === 'title' }" :aria-pressed="sortMode === 'title'" @click="chooseSort('title')">{{ t.sortTitle }}</button></div></div><button type="button" class="panel-icon-button" :title="t.settings" :aria-label="t.settings" @click="openSettings"><AppIcon name="settings" :size="18" /></button><button ref="notesPanelCloseButton" type="button" class="panel-icon-button" :title="t.closeMenu" :aria-label="t.closeMenu" @click="closeSidebar({ restoreFocus: true })"><AppIcon name="close" :size="18" /></button></div>
      </header>
      <div class="notes-search"><AppIcon name="search" :size="17" /><input ref="searchInput" v-model="searchQuery" :placeholder="t.search" :aria-label="t.search" /><kbd>{{ shortcutModifier }} K</kbd></div>
      <button type="button" class="new-note" @click="createNote"><AppIcon name="plus" :size="19" /><span>{{ t.newNote }}</span><kbd>{{ shortcutModifier }} N</kbd></button>

      <div class="notes-list">
        <div class="list-summary"><span>{{ sectionTitle }}</span><span>{{ visibleNotes.length }}</span></div>
        <div v-if="visibleNotes.length" class="note-groups">
          <div v-if="pinnedNotes.length" class="note-group pinned-group">
            <div class="folder-label"><AppIcon name="pin" :size="13" /><span>{{ t.pinned }}</span></div>
            <button v-for="note in pinnedNotes" :key="`pinned-${note.id}`" type="button" class="note-item" :class="{ selected: note.id === selectedId }" :aria-current="note.id === selectedId ? 'page' : undefined" @click="selectNote(note.id)">
              <span class="note-mark pinned"><AppIcon name="pin" :size="14" /></span>
              <span class="note-copy"><strong>{{ note.title }}</strong><small>{{ previewText(note.content) }}</small><em>{{ formatTime(note.updatedAt) }}</em></span>
            </button>
          </div>
          <div v-for="(group, folder) in groupedNotes" :key="folder" class="note-group">
            <div class="folder-label"><AppIcon name="chevron" :size="13" /><span>{{ folder }}</span></div>
            <button v-for="note in group" :key="note.id" type="button" class="note-item" :class="{ selected: note.id === selectedId }" :aria-current="note.id === selectedId ? 'page' : undefined" @click="selectNote(note.id)">
              <span class="note-mark" :class="{ favorite: note.favorite }"><AppIcon :name="note.favorite ? 'star' : 'dot'" :size="note.favorite ? 14 : 12" /></span>
              <span class="note-copy"><strong>{{ note.title }}</strong><small>{{ previewText(note.content) }}</small><em>{{ formatTime(note.updatedAt) }}</em></span>
            </button>
          </div>
        </div>
        <div v-else class="empty-state"><AppIcon name="notebook" :size="25" /><p>{{ activeSection === 'trash' ? t.trash : t.emptySearch }}</p><small>{{ activeSection === 'trash' ? `${t.trash} ${t.local.toLowerCase()}` : t.createFirst }}</small></div>
      </div>
    </aside>

    <div v-if="drawerOpen" class="drawer-scrim" aria-hidden="true" @click="closeSidebar({ restoreFocus: true })"></div>

    <main class="workspace" :inert="modalOpen || drawerOpen">
      <header class="editor-topbar">
        <div class="editor-context"><button ref="mobileMenuButton" type="button" class="mobile-menu" :title="t.openMenu" :aria-label="t.openMenu" aria-controls="notes-panel" :aria-expanded="drawerOpen" @click="openSidebar"><AppIcon name="menu" :size="19" /></button><span>Notide</span><span>/</span></div>
        <div class="title-capsule"><input class="document-title" :value="activeNote?.title" :placeholder="t.titlePlaceholder" :aria-label="t.titlePlaceholder" @input="updateNote('title', $event.target.value)" /><button type="button" class="favorite-button" :class="{ starred: activeNote?.favorite }" :title="t.toggleFavorite" :aria-label="t.toggleFavorite" :aria-pressed="Boolean(activeNote?.favorite)" @click="toggleFavorite"><AppIcon name="star" :size="20" /></button><button type="button" class="pin-button" :class="{ pinned: activeNote?.pinned }" :title="activeNote?.pinned ? t.unpin : t.pin" :aria-label="activeNote?.pinned ? t.unpin : t.pin" :aria-pressed="Boolean(activeNote?.pinned)" @click="togglePinned"><AppIcon name="pin" :size="18" /></button></div>
        <div class="topbar-actions">
          <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ syncStatusText }}</span>
          <span v-if="syncState === 'synced'" class="sync-message">✓ {{ t.synced }}</span><span v-else-if="syncState === 'syncing'" class="sync-message">◌ {{ t.syncing }}</span><span v-else-if="syncState === 'error'" class="sync-message error">× {{ t.syncError }}</span>
          <button type="button" class="icon-button" :title="t.sync" :aria-label="t.sync" :aria-busy="syncState === 'syncing'" :disabled="syncState === 'syncing'" @click="syncNote"><AppIcon name="sync" :size="18" /></button>
          <button type="button" class="icon-button danger-action" :class="{ disabled: notes.length <= 1 }" :title="t.delete" :aria-label="t.delete" :disabled="notes.length <= 1" @click="requestDelete"><AppIcon name="trash" :size="18" /></button>
          <button type="button" class="icon-button" :title="t.focus" :aria-label="t.focus" :aria-pressed="!showSidebar" @click="showSidebar = !showSidebar"><AppIcon name="more" :size="19" /></button>
        </div>
      </header>

      <div class="document-meta"><span>{{ t.today }}</span><span>·</span><span>{{ formatTime(activeNote?.updatedAt || Date.now()) }}</span><span>·</span><span>Markdown</span></div>

      <div class="toolbar">
        <div v-if="viewMode !== 'preview'" class="format-tools" role="toolbar" :aria-label="language === 'zh' ? 'Markdown 工具栏' : 'Markdown toolbar'">
          <button type="button" class="toolbar-button" :title="t.insertHeading" :aria-label="t.insertHeading" @click="formatMarkdown('heading')"><AppIcon name="notebook" :size="17" /></button>
          <button type="button" class="toolbar-button" :title="t.insertBold" :aria-label="t.insertBold" @click="formatMarkdown('bold')"><AppIcon name="bold" :size="17" /></button>
          <button type="button" class="toolbar-button" :title="t.insertTask" :aria-label="t.insertTask" @click="formatMarkdown('task')"><AppIcon name="check" :size="17" /></button>
          <button type="button" class="toolbar-button" :title="t.insertLink" :aria-label="t.insertLink" @click="formatMarkdown('link')"><AppIcon name="link" :size="17" /></button>
          <button type="button" class="toolbar-button" :title="t.insertCode" :aria-label="t.insertCode" @click="formatMarkdown('inlineCode')"><AppIcon name="code" :size="17" /></button>
          <span class="tool-divider"></span>
          <div class="more-tools-control">
            <button ref="moreToolsTrigger" type="button" class="toolbar-button" :class="{ active: showMoreTools }" :title="t.moreTools" :aria-label="t.moreTools" aria-haspopup="true" aria-controls="more-tools-menu" :aria-expanded="showMoreTools" @click="toggleMoreTools"><AppIcon name="more" :size="17" /></button>
            <div v-if="showMoreTools" id="more-tools-menu" ref="moreToolsMenu" class="more-tools-menu" role="group" :aria-label="t.moreTools">
              <button type="button" @click="formatMarkdown('italic')"><AppIcon name="italic" :size="16" />{{ t.insertItalic }}</button>
              <button type="button" @click="formatMarkdown('strike')"><AppIcon name="strike" :size="16" />{{ t.insertStrike }}</button>
              <button type="button" @click="formatMarkdown('bullet')"><AppIcon name="list" :size="16" />{{ t.insertBullet }}</button>
              <button type="button" @click="formatMarkdown('ordered')"><AppIcon name="ordered" :size="16" />{{ t.insertOrdered }}</button>
              <button type="button" @click="formatMarkdown('quote')"><AppIcon name="quote" :size="16" />{{ t.insertQuote }}</button>
              <button type="button" @click="formatMarkdown('image')"><AppIcon name="image" :size="16" />{{ t.insertImage }}</button>
              <button type="button" @click="formatMarkdown('table')"><AppIcon name="table" :size="16" />{{ t.insertTable }}</button>
              <button type="button" @click="formatMarkdown('math')"><AppIcon name="math" :size="16" />{{ t.insertMath }}</button>
              <button type="button" @click="formatMarkdown('codeBlock')"><AppIcon name="code" :size="16" />{{ t.insertCode }}</button>
              <button type="button" @click="formatMarkdown('callout')"><AppIcon name="quote" :size="16" />{{ t.insertCallout }}</button>
              <button type="button" @click="formatMarkdown('tabs')"><AppIcon name="split" :size="16" />{{ t.insertTabs }}</button>
            </div>
          </div>
        </div>
        <div class="view-switcher" role="group" :aria-label="language === 'zh' ? '编辑视图' : 'Editor view'">
          <button type="button" :class="{ active: viewMode === 'edit' }" :aria-pressed="viewMode === 'edit'" @click="viewMode = 'edit'"><AppIcon name="edit" :size="16" /><span>{{ t.edit }}</span></button>
          <button type="button" :class="{ active: viewMode === 'split' }" :aria-pressed="viewMode === 'split'" @click="viewMode = 'split'"><AppIcon name="split" :size="16" /><span>{{ t.split }}</span></button>
          <button type="button" :class="{ active: viewMode === 'preview' }" :aria-pressed="viewMode === 'preview'" @click="viewMode = 'preview'"><AppIcon name="eye" :size="16" /><span>{{ t.preview }}</span></button>
        </div>
      </div>

      <section class="editor-stage" :class="`mode-${viewMode}`">
        <div v-show="viewMode !== 'preview'" class="editor-pane">
          <MarkdownEditor
            ref="editor"
            :model-value="activeNote?.content || ''"
            :note-id="activeNote?.id || ''"
            :initial-state="activeEditorState"
            :placeholder="t.bodyPlaceholder"
            :theme="theme"
            :aria-label="language === 'zh' ? 'Markdown 编辑器' : 'Markdown editor'"
            @update:model-value="updateNote('content', $event)"
            @cursor-change="handleCursorChange"
            @history-change="handleHistoryChange"
            @state-change="handleEditorState"
          />
        </div>
        <div v-if="viewMode !== 'edit'" class="preview-pane">
          <div class="preview-label">READING VIEW</div>
          <MarkdownPreview :source="activeNote?.content || ''" :locale="language" :on-update="(value) => updateNote('content', value)" :on-navigate="navigateWiki" />
        </div>
      </section>

      <footer class="statusbar">
        <div><span class="status-dot" :class="{ online: syncEndpoint }"></span>{{ t.saved }}</div><div class="status-stats"><span>{{ wordCount }} {{ t.words }}</span><span>{{ lineCount }} {{ t.lines }}</span><span>Ln {{ editorCursor.line }}, Col {{ editorCursor.column }}</span><button type="button" class="status-action" :disabled="!editorHistory.canUndo" :title="t.undo" :aria-label="t.undo" @click="undoContent"><AppIcon name="undo" :size="15" /></button><button type="button" class="status-action" :disabled="!editorHistory.canRedo" :title="t.redo" :aria-label="t.redo" @click="redoContent"><AppIcon name="redo" :size="15" /></button></div>
      </footer>
    </main>

    <div v-if="showSettings" class="modal-backdrop" @click.self="closeSettings">
      <section ref="settingsModal" class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" @keydown.tab="trapModalFocus($event, settingsModal)">
        <div class="modal-header"><div><span class="eyebrow">NOTIDE / PREFERENCES</span><h2 id="settings-title">{{ t.settings }}</h2></div><button type="button" class="icon-button" :title="t.close" :aria-label="t.close" @click="closeSettings"><AppIcon name="close" :size="18" /></button></div>
        <label class="setting-row" for="notide-language"><span>{{ t.language }}</span><select id="notide-language" ref="settingsFirstControl" v-model="settingsDraft.language"><option value="zh">中文</option><option value="en">English</option></select></label>
        <div class="setting-row"><span>{{ t.light }} / {{ t.dark }}</span><button type="button" class="theme-toggle" role="switch" :aria-checked="settingsDraft.theme === 'dark'" :aria-label="settingsDraft.theme === 'light' ? t.dark : t.light" :title="settingsDraft.theme === 'light' ? t.dark : t.light" @click="settingsDraft.theme = settingsDraft.theme === 'light' ? 'dark' : 'light'"><span :class="{ active: settingsDraft.theme === 'light' }"><AppIcon name="sun" :size="15" /></span><span :class="{ active: settingsDraft.theme === 'dark' }"><AppIcon name="moon" :size="15" /></span></button></div>
        <div class="setting-stack">
          <label for="notide-sync-endpoint">{{ t.syncEndpoint }}</label>
          <input id="notide-sync-endpoint" v-model.trim="settingsDraft.syncEndpoint" inputmode="url" autocomplete="url" placeholder="https://notide-sync.example.workers.dev" aria-describedby="sync-endpoint-help sync-connection-result" :aria-invalid="connectionState === 'error' ? 'true' : undefined" />
          <label for="notide-sync-token">{{ t.syncToken }}</label>
          <input id="notide-sync-token" v-model="settingsDraft.syncToken" type="password" autocomplete="off" placeholder="SYNC_TOKEN" aria-describedby="sync-endpoint-help sync-connection-result" :aria-invalid="connectionState === 'error' ? 'true' : undefined" />
          <small id="sync-endpoint-help">{{ t.endpointHint }} {{ t.disconnect }}</small>
        </div>
        <label class="remember-token"><input v-model="settingsDraft.rememberToken" type="checkbox" /><span>{{ t.rememberToken }}</span></label>
        <p id="sync-connection-result" class="connection-result" :class="[connectionState, { empty: !connectionMessage }]" :role="connectionState === 'error' ? 'alert' : 'status'" aria-live="polite">{{ connectionMessage }}</p>
        <div class="modal-actions"><button type="button" class="ghost-button" @click="closeSettings">{{ t.close }}</button><button type="button" class="ghost-button" :disabled="settingsBusy" @click="testDraftConnection">{{ connectionState === 'testing' ? t.connectionTesting : t.testConnection }}</button><button type="button" class="primary-button" :disabled="settingsBusy" @click="saveSettingsAndSync">{{ isSavingSettings ? t.syncing : t.saveAndSync }}</button></div>
      </section>
    </div>

    <div v-if="showDeleteConfirm" class="modal-backdrop" @click.self="closeDeleteConfirm">
      <section ref="deleteModal" class="settings-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" @keydown.tab="trapModalFocus($event, deleteModal)">
        <div class="modal-header"><div><span class="eyebrow">NOTIDE / {{ t.delete }}</span><h2 id="delete-title">{{ t.deleteConfirm }}</h2></div><button type="button" class="icon-button" :title="t.cancel" :aria-label="t.cancel" @click="closeDeleteConfirm"><AppIcon name="close" :size="18" /></button></div>
        <div class="modal-actions"><button ref="deleteCancelButton" type="button" class="ghost-button" @click="closeDeleteConfirm">{{ t.cancel }}</button><button type="button" class="primary-button danger-button" @click="deleteNote">{{ t.confirm }}</button></div>
      </section>
    </div>
  </div>
</template>
