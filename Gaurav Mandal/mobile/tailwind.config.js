/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "./lib/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#F6F8FC",
          100: "#EEF2F8",
          200: "#E6EAF0",
          500: "#64748B",
          700: "#64748B",
          800: "#1e3a5f",
          900: "#102033",
        },
        clay: {
          400: "#4C73F7",
          500: "#2855F6",
          600: "#1E45D4",
        },
        leaf: {
          400: "#34d399",
          500: "#059669",
          600: "#047857",
        },
      },
    },
  },
  plugins: [],
};
