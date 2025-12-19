/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        'moz-green': '#007a5e',
        'moz-yellow': '#FCD116',
        'moz-red': '#CE1126',
        'primary': '#007a5e',
        'secondary': '#FCD116',
        'accent': '#CE1126',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
