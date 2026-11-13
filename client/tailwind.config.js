/** Tailwind CSS 配置（布局与游戏化样式；MUI 负责交互组件） */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: {
          900: '#0b1026',
          800: '#141b3c',
          700: '#1f2a55',
        },
        day: {
          500: '#f5e6c8',
          600: '#ecd9a0',
        },
        wolf: '#a83232',
        seer: '#5b7fd4',
        witch: '#7a4fb0',
        villager: '#4f8a5b',
      },
      boxShadow: {
        card: '0 2px 12px rgba(0,0,0,0.25)',
      },
    },
  },
  plugins: [],
};
