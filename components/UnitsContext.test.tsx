/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import { UnitsProvider, useUnits } from './UnitsContext';

function Probe() {
    const { units, setUnits } = useUnits();
    return <button onClick={() => setUnits(units === 'metric' ? 'imperial' : 'metric')}>{units}</button>;
}

const setLanguage = (lang: string) => Object.defineProperty(navigator, 'language', { value: lang, configurable: true });

beforeEach(() => {
    localStorage.clear();
    setLanguage('en-US');
});

describe('UnitsProvider', () => {
    it("defaults from the browser's locale", () => {
        setLanguage('en-GB');
        render(<UnitsProvider><Probe /></UnitsProvider>);
        expect(screen.getByRole('button')).toHaveTextContent('metric');
    });

    it('prefers a saved choice over the locale', () => {
        localStorage.setItem('unit_system', 'imperial');
        setLanguage('de-DE');
        render(<UnitsProvider><Probe /></UnitsProvider>);
        expect(screen.getByRole('button')).toHaveTextContent('imperial');
    });

    it('saves a new choice', () => {
        render(<UnitsProvider><Probe /></UnitsProvider>);
        act(() => screen.getByRole('button').click());
        expect(screen.getByRole('button')).toHaveTextContent('metric');
        expect(localStorage.getItem('unit_system')).toBe('metric');
    });
});
