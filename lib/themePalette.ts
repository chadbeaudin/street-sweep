import colors from 'tailwindcss/colors';

// Build-time half of dark mode (#173), loaded by tailwind.config.ts. The app's
// color classes resolve through CSS variables that swap under `.dark`, so
// existing markup adapts without a `dark:` variant on every class.

export type ColorRole = 'bg' | 'text' | 'border';
type Shade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

const SHADES: Shade[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const NEUTRALS = ['gray', 'slate'] as const;
const ACCENTS = ['indigo', 'red', 'amber', 'blue', 'orange', 'green', 'emerald', 'teal', 'sky', 'cyan', 'purple', 'yellow', 'rose', 'violet'] as const;
export const THEMED_PALETTES = [...NEUTRALS, ...ACCENTS];
type Palette = typeof THEMED_PALETTES[number];

// Shades not listed keep their light-mode value. Light surfaces and tints turn
// dark; dark text turns light; dark fills (tooltips, solid buttons) and light
// text on them stay put.
const DARK_SHADE: Record<'neutral' | 'accent', Record<ColorRole, Partial<Record<Shade, Shade>>>> = {
    neutral: {
        bg: { 50: 800, 100: 700, 200: 700, 300: 600, 400: 500 },
        // 400 and 500 swap so muted text stays the less prominent of the two.
        text: { 400: 500, 500: 400, 600: 300, 700: 200, 800: 100, 900: 50, 950: 50 },
        border: { 50: 800, 100: 800, 200: 700, 300: 600, 400: 500 },
    },
    accent: {
        bg: { 50: 950, 100: 900, 200: 800, 300: 700 },
        text: { 600: 400, 700: 300, 800: 200, 900: 100, 950: 100 },
        border: { 50: 900, 100: 900, 200: 800, 300: 700 },
    },
};

// `bg-white` is the app's surface color; `text-white` stays white.
export const DARK_SURFACE: { palette: Palette; shade: Shade } = { palette: 'gray', shade: 900 };

export function darkShade(role: ColorRole, palette: Palette, shade: Shade): Shade {
    const kind = (NEUTRALS as readonly string[]).includes(palette) ? 'neutral' : 'accent';
    return DARK_SHADE[kind][role][shade] ?? shade;
}

function hexOf(palette: Palette, shade: Shade): string {
    return (colors[palette] as Record<Shade, string>)[shade];
}

export function resolvedHex(role: ColorRole, color: 'white' | `${Palette}-${Shade}`, dark: boolean): string {
    if (color === 'white') return dark && role !== 'text' ? hexOf(DARK_SURFACE.palette, DARK_SURFACE.shade) : '#ffffff';
    const [palette, shade] = color.split('-') as [Palette, string];
    const s = Number(shade) as Shade;
    return hexOf(palette, dark ? darkShade(role, palette, s) : s);
}

const triplet = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(' ');
const varName = (role: ColorRole, color: string) => `--c-${role}-${color}`;
const ROLES: ColorRole[] = ['bg', 'text', 'border'];

export function themedColors(role: ColorRole): Record<string, string | Record<number, string>> {
    const out: Record<string, string | Record<number, string>> = {};
    for (const palette of THEMED_PALETTES) {
        out[palette] = Object.fromEntries(SHADES.map(s => [s, `rgb(var(${varName(role, `${palette}-${s}`)}) / <alpha-value>)`]));
    }
    if (role !== 'text') out.white = `rgb(var(${varName(role, 'white')}) / <alpha-value>)`;
    return out;
}

export function themeVariables(): { ':root': Record<string, string>; '.dark': Record<string, string> } {
    const light: Record<string, string> = {};
    const dark: Record<string, string> = {};
    for (const role of ROLES) {
        const names: ('white' | `${Palette}-${Shade}`)[] = THEMED_PALETTES.flatMap(p => SHADES.map(s => `${p}-${s}` as const));
        if (role !== 'text') names.push('white');
        for (const name of names) {
            light[varName(role, name)] = triplet(resolvedHex(role, name, false));
            dark[varName(role, name)] = triplet(resolvedHex(role, name, true));
        }
    }
    return { ':root': light, '.dark': { ...dark, 'color-scheme': 'dark' } };
}
