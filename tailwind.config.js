/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './frontend/index.html',
    './frontend/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        studiio: {
          cream: '#faf8f5',
          mint: '#d4f1e8',
          lavender: '#e8e0f0',
          peach: '#fce8dc',
          sky: '#dceaf7',
          ink: '#2d2a32',
          muted: '#6b6572',
          accent: '#7c6b9e',
          accentHover: '#63557a',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
