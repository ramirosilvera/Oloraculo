import type { Config } from 'tailwindcss';

// Tema claro/oscuro, pastel, inspirado en la bandera argentina (celeste + blanco) y en la
// estética moderna de fintech (Lemon Cash). Los neutros (canvas/surface/line/ink) son
// CSS-variables (ver src/index.css :root y .dark) para cambiar de tema sin tocar las páginas.
const withVar = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: withVar('--canvas'),     // fondo de página
        surface: withVar('--surface'),   // tarjetas / superficies
        line: withVar('--line'),         // bordes
        // Neutros de texto (rampa). En claro 900=oscuro→300=claro; en oscuro se invierte.
        ink: {
          950: withVar('--ink-950'), 900: withVar('--ink-900'), 800: withVar('--ink-800'),
          700: withVar('--ink-700'), 600: withVar('--ink-600'), 500: withVar('--ink-500'),
          400: withVar('--ink-400'), 300: withVar('--ink-300'),
        },
        // Marca celeste (fija en ambos temas; legible sobre claro y oscuro)
        celeste: {
          50: '#EFF7FD', 100: '#DCEDFA', 200: '#BFE0F5', 300: '#9BCFEF',
          400: '#74ACDF', 500: '#4F97D4', 600: '#3B82C4', 700: '#2C6699',
          DEFAULT: '#74ACDF',
        },
        sol: { DEFAULT: '#F4C752', soft: '#FBE8BE', deep: '#DDA92E' },
        accent: { DEFAULT: '#4F97D4', dim: '#2C6699' },
        pos: '#15A34A', neg: '#E14B4B', warn: '#E0952B',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { xl: '0.9rem', '2xl': '1.25rem', '3xl': '1.75rem' },
      boxShadow: {
        soft: '0 1px 2px rgba(20,33,46,0.04), 0 4px 16px rgba(20,33,46,0.06)',
        card: '0 1px 3px rgba(20,33,46,0.05), 0 8px 28px rgba(43,102,153,0.07)',
        glow: '0 8px 30px rgba(79,151,212,0.28)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'rise': 'rise 0.4s cubic-bezier(0.16,1,0.3,1)',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        rise: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
} satisfies Config;
