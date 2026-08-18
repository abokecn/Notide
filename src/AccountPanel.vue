<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { createUser, listAuditLog, listUsers, login, logout, updateUser } from './auth.js'

const props = defineProps({
  endpoint: { type: String, default: '' },
  session: { type: Object, default: null },
  language: { type: String, default: 'zh' },
  activeOwnerId: { type: String, default: '' },
  rememberByDefault: { type: Boolean, default: false },
})

const emit = defineEmits(['session-change', 'manage-owner'])
const username = ref('')
const password = ref('')
const remember = ref(props.rememberByDefault)
const busy = ref(false)
const message = ref('')
const messageType = ref('status')
const users = ref([])
const audit = ref([])
const createDraft = ref({ username: '', password: '', role: 'user' })
const resetTarget = ref('')
const resetPassword = ref('')

const text = computed(() => props.language === 'zh' ? {
  account: '账号', login: '登录', logout: '退出登录', username: '用户名', password: '密码', remember: '记住此设备',
  endpointFirst: '请先填写并保存 Worker 地址。', loginFailed: '登录失败，请检查账号、密码和 Worker 配置。',
  signedInAs: '当前登录', role: '角色', users: '用户管理', create: '添加用户', createUser: '创建账号',
  status: '状态', active: '正常', disabled: '已禁用', manageNotes: '管理笔记', ownNotes: '我的笔记',
  reset: '重置密码', save: '保存', cancel: '取消', refresh: '刷新', temporary: '账号已创建。请安全地告知用户初始密码。',
  loadFailed: '无法读取用户列表。', audit: '最近管理操作', noAudit: '暂无管理记录。', working: '处理中…',
} : {
  account: 'Account', login: 'Sign in', logout: 'Sign out', username: 'Username', password: 'Password', remember: 'Remember this device',
  endpointFirst: 'Save a Worker URL first.', loginFailed: 'Sign-in failed. Check the account, password, and Worker configuration.',
  signedInAs: 'Signed in as', role: 'Role', users: 'User management', create: 'Add user', createUser: 'Create account',
  status: 'Status', active: 'Active', disabled: 'Disabled', manageNotes: 'Manage notes', ownNotes: 'My notes',
  reset: 'Reset password', save: 'Save', cancel: 'Cancel', refresh: 'Refresh', temporary: 'Account created. Share the initial password with the user securely.',
  loadFailed: 'Could not load users.', audit: 'Recent admin activity', noAudit: 'No admin activity yet.', working: 'Working…',
})

const canBrowseUsers = computed(() => ['admin', 'super_admin'].includes(props.session?.user?.role))
const canManageUsers = computed(() => props.session?.user?.role === 'super_admin')

function errorText(error, fallback) {
  const code = error?.code || error?.message
  if (code === 'rate_limited') return props.language === 'zh' ? '尝试次数过多，请稍后重试。' : 'Too many attempts. Try again later.'
  if (code === 'account_disabled') return props.language === 'zh' ? '该账号已被禁用。' : 'This account is disabled.'
  if (code === 'invalid_credentials' || error?.status === 401) return props.language === 'zh' ? '用户名或密码不正确。' : 'Incorrect username or password.'
  if (code === 'username_taken') return props.language === 'zh' ? '用户名已存在。' : 'That username is already in use.'
  if (code === 'invalid_password') return props.language === 'zh' ? '密码至少需要 12 个字符。' : 'Use a password with at least 12 characters.'
  return fallback
}

async function signIn() {
  if (!props.endpoint) {
    messageType.value = 'error'
    message.value = text.value.endpointFirst
    return
  }
  busy.value = true
  message.value = ''
  try {
    const value = await login({ endpoint: props.endpoint, username: username.value, password: password.value, remember: remember.value })
    password.value = ''
    messageType.value = 'status'
    emit('session-change', value)
  } catch (error) {
    messageType.value = 'error'
    message.value = errorText(error, text.value.loginFailed)
  } finally {
    busy.value = false
  }
}

async function signOut() {
  busy.value = true
  try {
    await logout({ endpoint: props.endpoint, token: props.session?.token }).catch(() => null)
  } finally {
    emit('session-change', null)
    users.value = []
    audit.value = []
    busy.value = false
  }
}

async function refreshAdminData() {
  if (!canBrowseUsers.value || !props.endpoint || !props.session?.token) return
  try {
    users.value = await listUsers({ endpoint: props.endpoint, token: props.session.token })
    if (canManageUsers.value) {
      const result = await listAuditLog({ endpoint: props.endpoint, token: props.session.token }).catch(() => ({ entries: [] }))
      audit.value = Array.isArray(result?.entries) ? result.entries : []
    }
  } catch (error) {
    messageType.value = 'error'
    message.value = errorText(error, text.value.loadFailed)
  }
}

async function addUser() {
  busy.value = true
  message.value = ''
  try {
    await createUser({ endpoint: props.endpoint, token: props.session.token, user: createDraft.value })
    createDraft.value = { username: '', password: '', role: 'user' }
    messageType.value = 'status'
    message.value = text.value.temporary
    await refreshAdminData()
  } catch (error) {
    messageType.value = 'error'
    message.value = errorText(error, text.value.loadFailed)
  } finally {
    busy.value = false
  }
}

async function patchUser(user, changes) {
  busy.value = true
  try {
    await updateUser({ endpoint: props.endpoint, token: props.session.token, userId: user.id, changes })
    resetTarget.value = ''
    resetPassword.value = ''
    await refreshAdminData()
  } catch (error) {
    messageType.value = 'error'
    message.value = errorText(error, text.value.loadFailed)
  } finally {
    busy.value = false
  }
}

watch(() => props.session?.user?.id, () => refreshAdminData())
watch(() => props.rememberByDefault, (value) => {
  if (!props.session) remember.value = value
})
onMounted(refreshAdminData)
</script>

<template>
  <section class="account-panel" :aria-label="text.account">
    <div class="account-heading"><span>{{ text.account }}</span><small v-if="session">{{ text.signedInAs }} {{ session.user.username }}</small></div>

    <form v-if="!session" class="account-login" @submit.prevent="signIn">
      <label><span>{{ text.username }}</span><input v-model.trim="username" name="username" autocomplete="username" required minlength="3" maxlength="32" /></label>
      <label><span>{{ text.password }}</span><input v-model="password" name="password" type="password" autocomplete="current-password" required minlength="12" maxlength="128" /></label>
      <label class="account-remember"><input v-model="remember" type="checkbox" /><span>{{ text.remember }}</span></label>
      <button type="submit" class="primary-button" :disabled="busy || !endpoint">{{ busy ? text.working : text.login }}</button>
    </form>

    <template v-else>
      <div class="account-current">
        <div><strong>{{ session.user.username }}</strong><span>{{ text.role }} · {{ session.user.role }}</span></div>
        <button type="button" class="ghost-button" :disabled="busy" @click="signOut">{{ text.logout }}</button>
      </div>

      <div v-if="canBrowseUsers" class="account-admin">
        <div class="account-subheading"><strong>{{ text.users }}</strong><button type="button" class="text-button" :disabled="busy" @click="refreshAdminData">{{ text.refresh }}</button></div>
        <form v-if="canManageUsers" class="account-create" @submit.prevent="addUser">
          <input v-model.trim="createDraft.username" :aria-label="text.username" :placeholder="text.username" autocomplete="off" required minlength="3" maxlength="32" />
          <input v-model="createDraft.password" :aria-label="text.password" :placeholder="text.password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" />
          <select v-model="createDraft.role" :aria-label="text.role"><option value="user">user</option><option value="admin">admin</option></select>
          <button type="submit" class="primary-button" :disabled="busy">{{ text.createUser }}</button>
        </form>

        <div class="account-users">
          <div v-for="user in users" :key="user.id" class="account-user-row" :class="{ selected: activeOwnerId === user.id }">
            <div class="account-user-copy"><strong>{{ user.username }}</strong><span>{{ user.role }} · {{ user.disabled ? text.disabled : text.active }}</span></div>
            <button v-if="user.id !== session.user.id && (session.user.role === 'super_admin' || user.role === 'user')" type="button" class="ghost-button" @click="emit('manage-owner', user)">{{ text.manageNotes }}</button>
            <template v-if="canManageUsers && user.role !== 'super_admin'">
              <select :value="user.role" :aria-label="`${text.role}: ${user.username}`" :disabled="busy" @change="patchUser(user, { role: $event.target.value })"><option value="user">user</option><option value="admin">admin</option></select>
              <button type="button" class="ghost-button" :disabled="busy" @click="patchUser(user, { disabled: !user.disabled })">{{ user.disabled ? text.active : text.disabled }}</button>
              <button type="button" class="ghost-button" :disabled="busy" @click="resetTarget = resetTarget === user.id ? '' : user.id">{{ text.reset }}</button>
            </template>
            <form v-if="resetTarget === user.id" class="account-reset" @submit.prevent="patchUser(user, { password: resetPassword })">
              <input v-model="resetPassword" :aria-label="text.password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" />
              <button type="submit" class="primary-button" :disabled="busy">{{ text.save }}</button>
              <button type="button" class="ghost-button" @click="resetTarget = ''">{{ text.cancel }}</button>
            </form>
          </div>
        </div>

        <div v-if="canManageUsers" class="account-audit">
          <strong>{{ text.audit }}</strong>
          <p v-if="!audit.length">{{ text.noAudit }}</p>
          <p v-for="entry in audit.slice(0, 8)" :key="entry.id"><span>{{ entry.action }}</span><time>{{ entry.createdAt }}</time></p>
        </div>
      </div>
    </template>

    <p v-if="message" class="account-message" :class="messageType" :role="messageType === 'error' ? 'alert' : 'status'">{{ message }}</p>
  </section>
</template>

<style scoped>
.account-panel { display: grid; gap: 14px; padding-top: 18px; border-top: 1px solid var(--line); }
.account-heading, .account-subheading, .account-current { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.account-heading > span, .account-subheading strong { color: var(--ink); font-size: 12px; font-weight: 700; }
.account-heading small { color: var(--muted); font-size: 10px; }
.account-login, .account-create { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.account-login label { display: grid; gap: 6px; color: var(--muted); font-size: 10px; }
.account-login input, .account-create input, .account-create select, .account-reset input, .account-user-row > select { min-width: 0; min-height: 40px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 9px; background: var(--paper-deep); color: var(--ink); }
.account-login .account-remember { display: flex; align-items: center; gap: 8px; }
.account-remember input { min-height: auto; accent-color: var(--accent); }
.account-current { padding: 11px 0; }
.account-current div, .account-user-copy { min-width: 0; display: grid; gap: 3px; }
.account-current strong, .account-user-copy strong { color: var(--ink); font-size: 12px; }
.account-current span, .account-user-copy span { color: var(--muted); font-size: 9px; }
.account-admin { display: grid; gap: 12px; }
.account-create { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 86px auto; }
.account-users { max-height: 250px; overflow: auto; border-top: 1px solid var(--line); }
.account-user-row { display: flex; align-items: center; gap: 6px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.account-user-row.selected { box-shadow: inset 3px 0 0 var(--accent); padding-left: 9px; }
.account-user-copy { margin-right: auto; }
.account-reset { width: 100%; display: flex; gap: 6px; flex-basis: 100%; }
.account-user-row:has(.account-reset) { flex-wrap: wrap; }
.account-audit { display: grid; gap: 7px; padding-top: 4px; }
.account-audit > strong { color: var(--ink); font-size: 11px; }
.account-audit p { display: flex; justify-content: space-between; gap: 12px; margin: 0; color: var(--muted); font-size: 9px; }
.account-message { margin: 0; padding: 9px 11px; border-radius: 9px; background: var(--success-soft); color: var(--success); font-size: 10px; }
.account-message.error { background: var(--danger-soft, var(--accent-soft)); color: var(--danger, var(--accent)); }
@media (max-width: 620px) {
  .account-login, .account-create { grid-template-columns: 1fr; }
  .account-user-row { flex-wrap: wrap; }
  .account-user-copy { flex: 1 1 100%; }
}
@media (pointer: coarse) {
  .account-panel button,
  .account-login input,
  .account-create input,
  .account-create select,
  .account-reset input,
  .account-user-row > select { min-height: 48px; }
  .account-login input,
  .account-create input,
  .account-reset input { font-size: 16px; }
  .account-remember { min-height: 48px; }
  .account-remember input { min-height: auto; }
}
</style>
