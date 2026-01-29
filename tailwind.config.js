/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        'ispc-orange': '#f16c39',
        'ispc-dark': '#332d2a',
        'primary': '#f16c39',
        'secondary': '#332d2a',
        'accent': '#CE1126',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
