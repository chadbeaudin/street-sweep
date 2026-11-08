import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import { themedColors, themeVariables } from "./lib/themePalette";

const config: Config = {
    darkMode: "class",
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    // Without this, the .dark variable block is dropped whenever no scanned file happens to contain "dark".
    safelist: ["dark"],
    theme: {
        extend: {
            backgroundImage: {
                "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
                "gradient-conic":
                    "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
            },
            backgroundColor: themedColors("bg"),
            gradientColorStops: themedColors("bg"),
            textColor: themedColors("text"),
            placeholderColor: themedColors("text"),
            borderColor: themedColors("border"),
            divideColor: themedColors("border"),
            ringColor: themedColors("border"),
        },
    },
    plugins: [plugin(({ addBase }) => addBase(themeVariables()))],
};
export default config;
