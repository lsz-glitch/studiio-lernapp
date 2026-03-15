/** @type {import('tailwindcss').Config} */
import typography from '@tailwindcss/typography'

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        studiio: {
          cream: '#F7F4EF',
          ink: '#2C2838',
          muted: '#6B6578',
          accent: '#6B7FD7',
          accentHover: '#5A6BC4',
          lavender: '#D4C8F0',
          mint: '#C5E8DD',
          sky: '#C8E0F4',
        },
      },
    },
  },
  plugins: [typography],
}
