/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand: primary orange (CTA legacy)
        'ispc-orange': '#f16c39',
        'ispc-dark':   '#332d2a',
        'primary':     '#f16c39',
        'secondary':   '#332d2a',
        'accent':      '#CE1126',

        // Design System v2 — Navy + Gold
        'navy':        '#0f172a',
        'navy-800':    '#1e293b',
        'navy-700':    '#334155',
        'gold':        '#f59e0b',
        'gold-hover':  '#d97706',
      },
      fontFamily: {
        sans:    ['Inter', 'sans-serif'],
        display: ['Poppins', 'sans-serif'],
      },
      borderRadius: {
        'xl':  '12px',
        '2xl': '16px',
        '3xl': '24px',
      },
      boxShadow: {
        'card': '0 4px 16px rgba(15, 23, 42, 0.08), 0 2px 6px rgba(15, 23, 42, 0.04)',
        'card-hover': '0 12px 40px rgba(15, 23, 42, 0.12), 0 4px 12px rgba(15, 23, 42, 0.06)',
      },
      animation: {
        'float': 'float 4s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-8px)' },
        }
      }
    },
  },
  plugins: [],
}
