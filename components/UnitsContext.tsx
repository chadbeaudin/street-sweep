'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { defaultUnitSystem, type UnitSystem } from '@/lib/units';

const UNITS_KEY = 'unit_system';

const UnitsContext = createContext<{ units: UnitSystem; setUnits: (units: UnitSystem) => void }>({
    units: 'imperial',
    setUnits: () => {},
});

export function UnitsProvider({ children }: { children: React.ReactNode }) {
    const [units, setUnitsState] = useState<UnitSystem>('imperial');

    useEffect(() => {
        let saved: string | null = null;
        try { saved = localStorage.getItem(UNITS_KEY); } catch { /* ignore */ }
        setUnitsState(saved === 'metric' || saved === 'imperial' ? saved : defaultUnitSystem(navigator.language));
    }, []);

    const setUnits = useCallback((next: UnitSystem) => {
        setUnitsState(next);
        try { localStorage.setItem(UNITS_KEY, next); } catch { /* ignore */ }
    }, []);

    return <UnitsContext.Provider value={{ units, setUnits }}>{children}</UnitsContext.Provider>;
}

export const useUnits = () => useContext(UnitsContext);
