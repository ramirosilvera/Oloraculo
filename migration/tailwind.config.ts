import type { Config } from 'tailwindcss';

// Tema claro, pastel, inspirado en la bandera argentina (celeste + blanco) y en la estética
// moderna de fintech (Lemon Cash): superficies blancas sobre un canvas casi blanco, celeste
// de marca, sol dorado como acento, mucho aire y bordes suaves.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F4F8FC',     // fondo de página (celeste muy tenue)
        surface: '#FFFFFF',    // tarjetas / superficies
        line: '#E4ECF4',       // bordes
        // Celeste de la bandera como marca (rampa pastel → contraste)
        celeste: {
          50: '#EFF7FD', 100: '#DCEDFA', 200: '#BFE0F5', 300: '#9BCFEF',
          400: '#74ACDF', 500: '#4F97D4', 600: '#3B82C4', 700: '#2C6699',
          DEFAULT: '#74ACDF',
        },
        // Sol de Mayo: dorado pastel como acento cálido
        sol: { DEFAULT: '#F4C752', soft: '#FBE8BE', deep: '#DDA92E' },
        // Compatibilidad: `accent` = celeste de marca (para clases *-accent existentes)
        accent: { DEFAULT: '#4F97D4', dim: '#2C6699' },
        // Neutros. `ink` re-mapeado a escala CLARA: 900 = texto oscuro, 600 = texto atenuado,
        // 300 = bordes/superficies claras (así clases dark sin migrar no rompen el fondo).
        ink: {
          950: '#0F1D2E', 900: '#14212E', 800: '#243244', 700: '#3B4A5C',
          600: '#5C6A7D', 500: '#94A2B3', 400: '#C4CEDB', 300: '#DDE5EE',
        },
        pos: '#15A34A',        // ganancia (verde legible en claro)
        neg: '#E14B4B',        // pérdida
        warn: '#E0952B',       // atención
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
