/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    setupFiles: ['./test/jest.setup.ts'],
    roots: ['./test'],
    moduleNameMapper: { '\\.module\\.scss$': '<rootDir>/test/style-mock.cjs' },
};