export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_KEY = 'theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

export function parseThemePreference(raw: string | null): ThemePreference {
    return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): 'light' | 'dark' {
    if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
    return preference;
}

// Runs in <head> before first paint so a dark-mode page never flashes light.
// Kept in step with parseThemePreference/resolveTheme by lib/theme.test.ts.
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_KEY}');var d=p==='dark'||(p!=='light'&&window.matchMedia('${DARK_QUERY}').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`;
