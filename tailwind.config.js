/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/renderer/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--arcos-bg-0)',
        surface: 'var(--arcos-bg-2)',
        'surface-elevated': 'var(--arcos-bg-3)',
        border: 'var(--arcos-line)',
        text: 'var(--arcos-text)',
        'text-muted': 'var(--arcos-text-muted)',
        accent: 'var(--arcos-accent)',
        'accent-hover': 'var(--arcos-accent-strong)',
        'arc-accent': 'var(--arcos-accent-strong)',
        'arc-hover': 'var(--arcos-accent-strong)',
        'haiku-accent': 'var(--arcos-warning)',
        success: 'var(--arcos-success)',
        warning: 'var(--arcos-warning)',
        danger: 'var(--arcos-danger)',
      },
      fontFamily: {
        sans: ['var(--arcos-font-sans)'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
