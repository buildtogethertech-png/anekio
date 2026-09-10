/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  rootDir: __dirname,
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: [
    "<rootDir>/**/__tests__/**/*.[jt]s?(x)",
    "<rootDir>/**/*.(spec|test).[jt]s?(x)",
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/.expo/",
    "/dist/",
    "/android/",
    "/ios/",
    "/coverage/",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-.*|@expo/.*|@react-navigation/.*|nativewind|react-native-css-interop|react-native-gesture-handler|react-native-reanimated|react-native-worklets)/)",
  ],
  moduleNameMapper: {
    "\\.css$": "identity-obj-proxy",
  },
  clearMocks: true,
  resetMocks: false,
  restoreMocks: true,
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
    "!**/*.d.ts",
    "!**/*.{test,spec}.{ts,tsx}",
    "!**/__tests__/**",
  ],
  coverageDirectory: "<rootDir>/coverage",
  coverageReporters: ["text", "html", "lcov", "json-summary", "cobertura"],
  coverageThreshold: {
    global: {
      statements: 95,
      branches: 95,
      functions: 95,
      lines: 95,
    },
  },
  reporters: [
    "default",
    [
      "jest-junit",
      {
        outputDirectory: "../test-results/jest",
        outputName: "junit.xml",
        suiteName: "Anekio Expo component tests",
      },
    ],
  ],
  maxWorkers: process.env.CI ? 2 : "50%",
};
