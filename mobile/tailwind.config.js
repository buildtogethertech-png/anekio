/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "./lib/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#F6F9FD",
          100: "#EFF6FF",
          200: "#E5EAF2",
          500: "#94A3B8",
          700: "#64748B",
          800: "#1e3a5f",
          900: "#102A56",
        },
        clay: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          400: "#60a5fa",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
        },
        leaf: {
          400: "#34d399",
          500: "#10B981",
          600: "#059669",
        },
      },
    },
  },
  plugins: [],
};
