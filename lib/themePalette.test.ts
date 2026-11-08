import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import config from '../tailwind.config';
import { THEMED_PALETTES, darkShade, resolvedHex, themeVariables, themedColors, type ColorRole } from './themePalette';

const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};
type Color = Parameters<typeof resolvedHex>[1];
const dark = (role: ColorRole, color: Color) => resolvedHex(role, color, true);
const light = (role: ColorRole, color: Color) => resolvedHex(role, color, false);

describe('dark palette mapping', () => {
    it('leaves light mode exactly as Tailwind ships it', () => {
        expect(light('bg', 'white')).toBe('#ffffff');
        expect(light('text', 'gray-900')).toBe('#111827');
        expect(light('bg', 'indigo-50')).toBe('#eef2ff');
    });

    it('turns surfaces dark and keeps text-white white', () => {
        expect(dark('bg', 'white')).toBe('#111827');
        expect(dark('border', 'white')).toBe('#111827');
        expect(themedColors('text').white).toBeUndefined();
    });

    it('turns dark text light and keeps intentionally dark fills dark', () => {
        expect(dark('text', 'gray-900')).toBe('#f9fafb');
        expect(dark('bg', 'gray-900')).toBe('#111827'); // tooltips
        expect(dark('bg', 'indigo-600')).toBe(light('bg', 'indigo-600')); // solid buttons
    });

    it('keeps muted text less prominent than secondary text', () => {
        const surface = dark('bg', 'white');
        expect(contrast(dark('text', 'gray-400'), surface)).toBeLessThan(contrast(dark('text', 'gray-500'), surface));
    });

    it('keeps cards distinguishable from the surface they sit on', () => {
        expect(dark('bg', 'gray-50')).not.toBe(dark('bg', 'white'));
        expect(darkShade('bg', 'indigo', 50)).toBe(950);
    });
});

describe('dark mode contrast (WCAG)', () => {
    // [text, background, minimum ratio]
    const pairs: [Color, Color, number][] = [
        ['gray-900', 'white', 4.5],
        ['gray-700', 'white', 4.5],
        ['gray-600', 'white', 4.5],
        ['gray-500', 'white', 4.5],
        ['gray-400', 'white', 3],
        ['gray-900', 'gray-50', 4.5],
        ['gray-700', 'gray-50', 4.5],
        ['gray-500', 'gray-50', 3],
        ['gray-700', 'gray-100', 4.5],
        ['indigo-600', 'white', 4.5],
        ['indigo-900', 'indigo-50', 4.5],
        ['red-700', 'red-50', 4.5],
        ['emerald-900', 'emerald-50', 4.5],
        ['amber-900', 'amber-50', 4.5],
        ['gray-300', 'gray-900', 4.5], // tooltip body text
    ];
    it.each(pairs)('text-%s on bg-%s', (text, bg, min) => {
        expect(contrast(dark('text', text), dark('bg', bg))).toBeGreaterThanOrEqual(min);
    });

    it('keeps white button text readable on solid accent buttons', () => {
        expect(contrast('#ffffff', dark('bg', 'indigo-600'))).toBeGreaterThanOrEqual(4.5);
    });
});

describe('theme variables', () => {
    const vars = themeVariables();

    it('defines every variable the Tailwind colors reference, in both modes', () => {
        const referenced = (['bg', 'text', 'border'] as ColorRole[])
            .flatMap(role => Object.values(themedColors(role)).flatMap(v => (typeof v === 'string' ? [v] : Object.values(v))))
            .map(v => v.match(/var\((--[^)]+)\)/)![1]);
        expect(referenced.length).toBeGreaterThan(400);
        for (const name of referenced) {
            expect(vars[':root'][name]).toMatch(/^\d+ \d+ \d+$/);
            expect(vars['.dark'][name]).toMatch(/^\d+ \d+ \d+$/);
        }
    });

    it('covers every palette the app uses', () => {
        const fs = require('fs') as typeof import('fs');
        const path = require('path') as typeof import('path');
        const files = ['app', 'components'].flatMap(dir => (fs.readdirSync(dir, { recursive: true }) as string[]).filter(f => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map(f => path.join(dir, f)));
        const used = new Set<string>();
        for (const f of files) {
            for (const m of fs.readFileSync(f, 'utf8').matchAll(/\b(?:bg|text|border|divide|ring|from|via|to)-([a-z]+)-\d{2,3}\b/g)) used.add(m[1]);
        }
        expect([...used].filter(p => !(THEMED_PALETTES as readonly string[]).includes(p))).toEqual([]);
    });

    it('opts native controls and scrollbars into dark', () => {
        expect(vars['.dark']['color-scheme']).toBe('dark');
    });
});

describe('Tailwind build with the real config', () => {
    let css: string;
    beforeAll(async () => {
        const html = '<div class="bg-white bg-white/90 text-white text-gray-900 border-gray-200 bg-indigo-600 hover:bg-gray-50 divide-gray-100 from-gray-50"></div>';
        const result = await postcss([tailwindcss({ ...config, content: [{ raw: html, extension: 'html' }] })])
            .process('@tailwind base; @tailwind utilities;', { from: undefined });
        css = result.css;
    }, 30000);

    it('routes themed classes through the variables', () => {
        expect(css).toMatch(/\.bg-white\s*\{[^}]*rgb\(var\(--c-bg-white\) \/ var\(--tw-bg-opacity/);
        expect(css).toMatch(/\.text-gray-900\s*\{[^}]*var\(--c-text-gray-900\)/);
        expect(css).toMatch(/\.border-gray-200\s*\{[^}]*var\(--c-border-gray-200\)/);
        expect(css).toMatch(/\.hover\\:bg-gray-50:hover\s*\{[^}]*var\(--c-bg-gray-50\)/);
        expect(css).toMatch(/\.bg-white\\\/90\s*\{[^}]*rgb\(var\(--c-bg-white\) \/ 0\.9\)/);
    });

    it('leaves text-white as plain white', () => {
        expect(css).toMatch(/\.text-white\s*\{[^}]*rgb\(255 255 255/);
    });

    it('emits the light variables on :root and the dark ones under .dark', () => {
        expect(css).toMatch(/:root\s*\{[^}]*--c-bg-white: 255 255 255/);
        expect(css).toMatch(/\.dark\s*\{[^}]*--c-bg-white: 17 24 39/);
        expect(css).toMatch(/\.dark\s*\{[^}]*color-scheme: dark/);
    });
});
