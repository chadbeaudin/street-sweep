module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/integration/**/*.test.ts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
    },
};
