/** @type {import('tailwindcss').Config} */
export default {
  content: ["./oauth-finish.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        tiktok: {
          DEFAULT: "#FE2C55",
          dark: "#E0264A",
        },
      },
    },
  },
  plugins: [],
};
