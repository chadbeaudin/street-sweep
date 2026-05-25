module.exports = {
    testEnvironment: "node",
    testMatch: ["**/*.test.ts", "**/*.test.tsx"],
    clearMocks: true,
    resetMocks: true,
    transform: {
        "^.+\\.tsx?$": [
            "ts-jest",
            {
                tsconfig: {
                    jsx: "react-jsx"
                }
            }
        ],
        "^.+\\.js$": ["ts-jest", { tsconfig: { allowJs: true, esModuleInterop: true } }]
    },
    transformIgnorePatterns: ["/node_modules/(?!@garmin/fitsdk)"],
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/$1"
    }
};
