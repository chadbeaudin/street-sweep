/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { ElevationProfile } from './ElevationProfile';
import { UnitsProvider } from './UnitsContext';

jest.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    const XAxis = ({ tickFormatter }: { tickFormatter: (v: number) => string }) => <span data-testid="x-tick">{tickFormatter(1)}</span>;
    return { AreaChart: Pass, Area: Pass, XAxis, YAxis: Pass, CartesianGrid: Pass, Tooltip: Pass, ResponsiveContainer: Pass, ReferenceLine: Pass, ReferenceDot: Pass };
});

const data = [
    { distance: 0, elevation: 3000, lat: 44, lon: -121 },
    { distance: 10, elevation: 3500, lat: 44.1, lon: -121 },
];

function renderWithUnits(units: 'imperial' | 'metric') {
    localStorage.setItem('unit_system', units);
    render(
        <UnitsProvider>
            <ElevationProfile data={data} onHover={jest.fn()} totalDistance="10.00" totalElevationGain={1000} />
        </UnitsProvider>
    );
}

beforeEach(() => localStorage.clear());

describe('ElevationProfile units', () => {
    it('shows miles and feet in imperial', () => {
        renderWithUnits('imperial');
        expect(screen.getByText('10.00')).toBeInTheDocument();
        expect(screen.getByText('miles')).toBeInTheDocument();
        expect(screen.getByText('1000')).toBeInTheDocument();
        expect(screen.getByText('ft gain')).toBeInTheDocument();
        expect(screen.getByText('Elevation Profile (feet)')).toBeInTheDocument();
        expect(screen.getByTestId('x-tick')).toHaveTextContent('1 mi');
    });

    it('shows km and meters in metric', () => {
        renderWithUnits('metric');
        expect(screen.getByText('16.09')).toBeInTheDocument();
        expect(screen.getByText('km')).toBeInTheDocument();
        expect(screen.getByText('305')).toBeInTheDocument();
        expect(screen.getByText('m gain')).toBeInTheDocument();
        expect(screen.getByText('Elevation Profile (meters)')).toBeInTheDocument();
        expect(screen.getByTestId('x-tick')).toHaveTextContent('1 km');
    });
});
