import type { Config } from 'tailwindcss';

// Dark, data-dense finance theme. `ink` = surfaces, `pos/neg` = P&L, `accent` = brand.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0a0e17',
          900: '#0e1420',
          800: '#161d2d',
          700: '#1e2739',
          600: '#2a3446',
        },
        accent: {
          DEFAULT: '#2dd4bf', // teal-400
          dim: '#0f766e',
        },
        pos: '#22c55e',   // ganancia
        neg: '#ef4444',   // pérdida
        warn: '#f59e0b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.25s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
