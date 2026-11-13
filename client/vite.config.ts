import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** 开发态把 /api 与 /socket.io 代理到本地服务端（默认 3000） */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 局域网可玩（迭代2 F2）：绑定全部网卡，局域网设备可访问 http://<主机IP>:5173
    host: '0.0.0.0',
    proxy: {
      // proxy target 指向本机 server 进程间转发，不受"禁止写死 localhost"红线约束
      '/api': {
        target: `http://localhost:${process.env.SERVER_PORT ?? 3000}`,
        changeOrigin: true,
      },
      '/socket.io': {
        target: `http://localhost:${process.env.SERVER_PORT ?? 3000}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
