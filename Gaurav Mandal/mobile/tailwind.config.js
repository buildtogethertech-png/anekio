/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "./lib/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f4f7fb",
          100: "#e8eef6",
          200: "#c9d4e4",
          700: "#3d4f66",
          800: "#1e3a5f",
          900: "#0f2744",
        },
        clay: {
          400: "#3b82f6",
          500: "#1d4ed8",
          600: "#1e40af",
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
