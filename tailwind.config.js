/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        /* Studiio Pastell-Farbpalette – fröhlich, angenehm für lange Lernsessions */
        studiio: {
          cream: '#faf8f5',      /* warmer Hintergrund */
          mint: '#d4f1e8',       /* frisches Grün */
          lavender: '#e8e0f0',   /* sanftes Lila */
          peach: '#fce8dc',      /* weiches Orange */
          sky: '#dceaf7',        /* helles Blau */
          ink: '#2d2a32',        /* Haupttext */
          muted: '#6b6572',      /* gedämpfter Text */
          accent: '#7c6b9e',     /* Akzent (z. B. Buttons) */
          accentHover: '#63557a',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
