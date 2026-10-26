/** @type {import('tailwindcss').Config} */
// The product wears the same identity as the Primus Privacy microsite:
// deep maroon, copper accent, warm neutrals, Sora headings, IBM Plex Sans text.
// The existing `slate` and `blue` utility names are re-pointed at that palette,
// so every screen picks up the brand without each one being rewritten.
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'IBM Plex Sans'", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Sora", "'IBM Plex Sans'", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "Menlo", "monospace"],
      },
      colors: {
        slate: {
          50: "#fdf8f6", 100: "#fbeeea", 200: "#f3dcd6", 300: "#e4c3bb", 400: "#b09590",
          500: "#86696a", 600: "#6a504d", 700: "#4f3532", 800: "#3a1f1c", 900: "#5c1a16",
        },
        blue: { 50: "#f8ecdf", 100: "#f1dcc3", 600: "#a3652e", 700: "#8a5325" },
        brand: { DEFAULT: "#5c1a16", dark: "#3f100d", ink: "#2a0706" },
        copper: { DEFAULT: "#a3652e", light: "#b87a3d", soft: "#f8ecdf", deep: "#8a5325" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(79,17,25,.05), 0 8px 24px -14px rgba(79,17,25,.28)",
        lift: "0 18px 40px -18px rgba(79,17,25,.35)",
      },
      borderRadius: { xl: "0.9rem" },
    },
  },
  plugins: [],
};
