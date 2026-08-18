import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const katexWoff2Only = {
  name: 'notide-katex-woff2-only',
  enforce: 'pre',
  transform(source, id) {
    if (!/[\\/]katex[\\/]dist[\\/]katex\.min\.css(?:\?|$)/.test(id)) return null
    return source.replace(/,url\(([^)]*\.woff)\) format\("woff"\),url\(([^)]*\.ttf)\) format\("truetype"\)/g, '')
  },
}

export default defineConfig({
  plugins: [katexWoff2Only, vue()],
})
