/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { StatsDialog } from './StatsDialog';
import { UnitsProvider } from './UnitsContext';

jest.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return { LineChart: Pass, Line: Pass, XAxis: Pass, YAxis: Pass, CartesianGrid: Pass, Tooltip: Pass, ResponsiveContainer: Pass };
});

const stats = {
    totalActivities: 3,
    totalUniqueMiles: 100,
    totalElevationFeet: 10000,
    totalDistanceMiles: 200,
    explorationPct: 50,
    longestRideMiles: 50,
    biggestClimbFeet: 3000,
    activeDays: 3,
    cities: [{ name: 'Bend', state: 'OR', activityCount: 3, riddenMiles: 10, totalMiles: 100, percent: 10 }],
};

function renderStats(units: 'imperial' | 'metric') {
    localStorage.setItem('unit_system', units);
    global.fetch = jest.fn((url: string) => Promise.resolve({
        json: async () => (url === '/api/stats' ? stats : { readings: [] }),
    })) as unknown as typeof fetch;
    render(
        <UnitsProvider>
            <StatsDialog isOpen onClose={jest.fn()} riddenRoads={[[[44, -121], [44.1, -121]]]} activityElevations={[]} activityTypes={[]} stravaCredentials={{}} activityMode="cycling" />
        </UnitsProvider>
    );
}

beforeEach(() => localStorage.clear());

describe('StatsDialog units', () => {
    it('shows miles and feet in imperial', async () => {
        renderStats('imperial');
        expect(await screen.findByText('Unique Miles')).toBeInTheDocument();
        expect(screen.getByText('100.0')).toBeInTheDocument();
        expect(screen.getByText('10,000')).toBeInTheDocument();
        expect(screen.getByText('ft total')).toBeInTheDocument();
        expect(screen.getByText('of miles were new')).toBeInTheDocument();
    });

    it('shows kilometers and meters in metric', async () => {
        renderStats('metric');
        expect(await screen.findByText('Unique Kilometers')).toBeInTheDocument();
        expect(screen.getByText('160.9')).toBeInTheDocument();
        expect(screen.getByText('3,048')).toBeInTheDocument();
        expect(screen.getByText('m total')).toBeInTheDocument();
        expect(screen.getByText('322')).toBeInTheDocument();
        expect(screen.getByText('914')).toBeInTheDocument();
        expect(screen.getByText('of km were new')).toBeInTheDocument();
    });
});
