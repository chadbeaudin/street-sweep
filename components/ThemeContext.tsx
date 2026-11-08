'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DARK_QUERY, THEME_KEY, parseThemePreference, resolveTheme, type ThemePreference } from '@/lib/theme';

const ThemeContext = createContext<{ preference: ThemePreference | null; setPreference: (preference: ThemePreference) => void }>({
    preference: null,
    setPreference: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    // null until read from storage, so the pre-paint script's choice isn't overwritten by a default.
    const [preference, setPreferenceState] = useState<ThemePreference | null>(null);

    useEffect(() => {
        let saved: string | null = null;
        try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
        setPreferenceState(parseThemePreference(saved));
    }, []);

    useEffect(() => {
        if (!preference) return;
        const media = window.matchMedia(DARK_QUERY);
        const apply = () => document.documentElement.classList.toggle('dark', resolveTheme(preference, media.matches) === 'dark');
        apply();
        if (preference !== 'system') return;
        media.addEventListener('change', apply);
        return () => media.removeEventListener('change', apply);
    }, [preference]);

    const setPreference = useCallback((next: ThemePreference) => {
        setPreferenceState(next);
        try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    }, []);

    return <ThemeContext.Provider value={{ preference, setPreference }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
