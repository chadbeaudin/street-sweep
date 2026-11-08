/**
 * @jest-environment jsdom
 */

import { THEME_INIT_SCRIPT, THEME_KEY, parseThemePreference, resolveTheme } from './theme';

describe('parseThemePreference', () => {
    it('keeps an explicit light or dark choice', () => {
        expect(parseThemePreference('light')).toBe('light');
        expect(parseThemePreference('dark')).toBe('dark');
    });

    it('falls back to following the system', () => {
        expect(parseThemePreference(null)).toBe('system');
        expect(parseThemePreference('system')).toBe('system');
        expect(parseThemePreference('purple')).toBe('system');
    });
});

describe('resolveTheme', () => {
    it('honors an explicit choice regardless of the system', () => {
        expect(resolveTheme('light', true)).toBe('light');
        expect(resolveTheme('dark', false)).toBe('dark');
    });

    it('follows the system when set to system', () => {
        expect(resolveTheme('system', true)).toBe('dark');
        expect(resolveTheme('system', false)).toBe('light');
    });
});

describe('THEME_INIT_SCRIPT', () => {
    const run = (saved: string | null, systemDark: boolean) => {
        document.documentElement.className = '';
        localStorage.clear();
        if (saved !== null) localStorage.setItem(THEME_KEY, saved);
        window.matchMedia = jest.fn(() => ({ matches: systemDark })) as unknown as typeof window.matchMedia;
        new Function(THEME_INIT_SCRIPT)();
        return document.documentElement.classList.contains('dark');
    };

    it.each([
        ['dark', false],
        ['light', true],
        [null, true],
        [null, false],
        ['system', true],
        ['garbage', false],
    ])('matches resolveTheme for saved=%p, system dark=%p', (saved, systemDark) => {
        const expected = resolveTheme(parseThemePreference(saved), systemDark) === 'dark';
        expect(run(saved, systemDark)).toBe(expected);
    });

    it('never throws when storage is unavailable', () => {
        const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        expect(() => new Function(THEME_INIT_SCRIPT)()).not.toThrow();
        getItem.mockRestore();
    });
});
