/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B1F3A',
        navy: { 950: '#071428', 900: '#0B1F3A', 800: '#122B4D', 700: '#1B3A63', 600: '#2B4C7A', 500: '#47658F', 400: '#6B86A8', 300: '#9BB0C9', 200: '#C9D5E3', 100: '#E4EBF3', 50: '#F3F6FA' },
        teal: { 800: '#085158', 700: '#0A6670', 600: '#0E7C86', 500: '#1597A2', 300: '#7FCCD2', 100: '#D5EEF0', 50: '#EAF7F8' },
        muted: '#52627A',
        line: '#DDE4EC',
        canvas: '#F7F9FB',
        good: { DEFAULT: '#0B7A3B', bg: '#E6F4EA' },
        warn: { DEFAULT: '#8A5A00', bg: '#FFF4D6' },
        bad: { DEFAULT: '#B42318', bg: '#FDE8E6' },
        info: { DEFAULT: '#1F5FBF', bg: '#E8F0FB' },
        series: { verified: '#2a78d6', self: '#eb6834', bench: '#1baf7a' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,31,58,0.05), 0 1px 3px rgba(11,31,58,0.04)',
        pop: '0 10px 30px rgba(11,31,58,0.15)',
      },
    },
  },
  plugins: [],
};
