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
        ]
    }
};
