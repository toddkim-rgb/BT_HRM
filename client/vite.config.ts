import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT) || 5173,
    // API_TARGET: 별도 테스트 환경(복사한 DB로 띄운 API)을 볼 때만 지정
    proxy: { '/api': process.env.API_TARGET ?? 'http://localhost:4000' },
  },
})
