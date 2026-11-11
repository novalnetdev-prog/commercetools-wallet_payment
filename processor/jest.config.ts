/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFiles: ["./test/jest.setup.ts"],
  roots: ["./test"],

  transform: {
    "^.+\\.tsx?$": "ts-jest",
    "^.+/node_modules/cookie/dist/.*\\.js$": [
      "ts-jest",
      {
        tsconfig: {
          allowJs: true,
          module: "CommonJS",
        },
        diagnostics: false,
      },
    ],
  },

  transformIgnorePatterns: [
    "/node_modules/(?!cookie/)",
  ],
};
