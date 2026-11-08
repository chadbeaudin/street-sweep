/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from './ThemeContext';
import { ThemeToggle } from './ThemeToggle';

let systemDark = false;
let listeners: (() => void)[] = [];

function setSystemDark(next: boolean) {
    systemDark = next;
    act(() => listeners.forEach(l => l()));
}

beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    systemDark = false;
    listeners = [];
    window.matchMedia = jest.fn(() => ({
        get matches() { return systemDark; },
        addEventListener: (_: string, l: () => void) => listeners.push(l),
        removeEventListener: (_: string, l: () => void) => { listeners = listeners.filter(x => x !== l); },
    })) as unknown as typeof window.matchMedia;
});

const isDark = () => document.documentElement.classList.contains('dark');
const renderToggle = () => render(<ThemeProvider><ThemeToggle /></ThemeProvider>);

describe('ThemeProvider + ThemeToggle', () => {
    it('defaults to System and follows the device', () => {
        systemDark = true;
        renderToggle();
        expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
        expect(isDark()).toBe(true);
    });

    it('switches live when the device theme changes while on System', () => {
        renderToggle();
        expect(isDark()).toBe(false);
        setSystemDark(true);
        expect(isDark()).toBe(true);
        setSystemDark(false);
        expect(isDark()).toBe(false);
    });

    it('applies and remembers an explicit choice', () => {
        renderToggle();
        fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
        expect(isDark()).toBe(true);
        expect(localStorage.getItem('theme')).toBe('dark');
        expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
        expect(isDark()).toBe(false);
        expect(localStorage.getItem('theme')).toBe('light');
    });

    it('ignores device changes once a theme is chosen', () => {
        renderToggle();
        fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
        setSystemDark(true);
        expect(isDark()).toBe(false);
    });

    it('restores a saved choice on load', () => {
        localStorage.setItem('theme', 'dark');
        renderToggle();
        expect(isDark()).toBe(true);
        expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    });

    it('leaves the pre-paint theme alone until the saved choice is read', () => {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
        systemDark = false;
        const { unmount } = renderToggle();
        expect(isDark()).toBe(true);
        unmount();
    });
});
