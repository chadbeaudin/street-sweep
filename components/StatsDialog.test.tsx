/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatsDialog } from './StatsDialog';
import { UnitsProvider } from './UnitsContext';

jest.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return { LineChart: Pass, Line: Pass, XAxis: Pass, YAxis: Pass, CartesianGrid: Pass, Tooltip: Pass, ResponsiveContainer: Pass };
});

const stats: Record<string, unknown> = {
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

function renderStats(units: 'imperial' | 'metric', overrides: Record<string, unknown> = {}, onClose = jest.fn()) {
    localStorage.setItem('unit_system', units);
    global.fetch = jest.fn((url: string) => Promise.resolve({
        json: async () => (url === '/api/stats' ? { ...stats, ...overrides } : { readings: [] }),
    })) as unknown as typeof fetch;
    render(
        <UnitsProvider>
            <StatsDialog isOpen onClose={onClose} riddenRoads={[[[44, -121], [44.1, -121]]]} activityElevations={[]} activityTypes={[]} stravaCredentials={{}} activityMode="cycling" />
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
        expect(screen.getByText('of IRL miles were new')).toBeInTheDocument();
    });

    it('shows kilometers and meters in metric', async () => {
        renderStats('metric');
        expect(await screen.findByText('Unique Kilometers')).toBeInTheDocument();
        expect(screen.getByText('160.9')).toBeInTheDocument();
        expect(screen.getByText('3,048')).toBeInTheDocument();
        expect(screen.getByText('m total')).toBeInTheDocument();
        expect(screen.getByText('322')).toBeInTheDocument();
        expect(screen.getByText('914')).toBeInTheDocument();
        expect(screen.getByText('of IRL km were new')).toBeInTheDocument();
    });
});

describe('StatsDialog ride types', () => {
    const rideTypeBreakdown = {
        mountain: { rides: 4, miles: 50, elevationFeet: 6000 },
        roadGravel: { rides: 7, miles: 150, elevationFeet: 4000 },
    };
    const ridesPerYear = [{ year: 2016, rides: 5, miles: 100 }, { year: 2026, rides: 6, miles: 100 }];
    const perYear = [{ year: 2016, mountainMiles: 75, roadGravelMiles: 25 }, { year: 2026, mountainMiles: 0, roadGravelMiles: 100 }];

    it('shows mountain bike vs road/gravel totals', async () => {
        renderStats('imperial', { rideTypeBreakdown });
        expect(await screen.findByText('Ride Types')).toBeInTheDocument();
        expect(screen.getByText('Mountain Bike')).toBeInTheDocument();
        expect(screen.getByText('Road / Gravel')).toBeInTheDocument();
        expect(screen.getByText('4 rides')).toBeInTheDocument();
        expect(screen.getByText('150 mi')).toBeInTheDocument();
        expect(screen.getByText('6,000 ft')).toBeInTheDocument();
        expect(screen.getByText('25%')).toBeInTheDocument();
        expect(screen.getByText('75%')).toBeInTheDocument();
    });

    it('is hidden when the breakdown is missing', async () => {
        renderStats('imperial');
        expect(await screen.findByText('Unique Miles')).toBeInTheDocument();
        expect(screen.queryByText('Ride Types')).not.toBeInTheDocument();
    });

    it('stacks the mountain bike share into each year bar (#136)', async () => {
        renderStats('imperial', { rideTypeBreakdown: { ...rideTypeBreakdown, perYear }, ridesPerYear });
        expect(await screen.findByTestId('mtb-bar-2016')).toHaveStyle({ height: '75%' });
        expect(screen.getByTestId('mtb-bar-2026')).toHaveStyle({ height: '0%' });
    });

    it('shows the year breakdown in a tooltip on hover', async () => {
        renderStats('imperial', { rideTypeBreakdown: { ...rideTypeBreakdown, perYear }, ridesPerYear });
        const column = (await screen.findByText("'16")).parentElement!;
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        fireEvent.mouseEnter(column);
        const tip = screen.getByRole('tooltip');
        expect(tip).toHaveTextContent('2016');
        expect(tip).toHaveTextContent('100 mi · 5 rides');
        expect(tip).toHaveTextContent('Mountain Bike 75 mi');
        expect(tip).toHaveTextContent('Road / Gravel 25 mi');
        fireEvent.mouseLeave(column);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
});

describe('StatsDialog IRL vs virtual split', () => {
    const totals = (activities: number, distanceMiles: number) => ({ activities, distanceMiles, elevationFeet: 1000, longestRideMiles: 10, biggestClimbFeet: 500, activeDays: activities });

    it('shows IRL and virtual under each combined total', async () => {
        renderStats('imperial', { split: { irl: totals(2, 150), virtual: totals(1, 50) } });
        expect(await screen.findByText('IRL 150')).toBeInTheDocument();
        expect(screen.getByText('Virtual 50')).toBeInTheDocument();
        expect(screen.getAllByText('IRL 2')).toHaveLength(2); // activities and active days
        expect(screen.getAllByText('Virtual 1,000')).toHaveLength(1); // climbed
    });

    it('is hidden for stats cached before the split existed', async () => {
        renderStats('imperial');
        expect(await screen.findByText('Unique Miles')).toBeInTheDocument();
        expect(screen.queryByText(/^IRL /)).not.toBeInTheDocument();
    });
});

describe('StatsDialog click away', () => {
    it('closes when the backdrop is clicked', async () => {
        const onClose = jest.fn();
        renderStats('imperial', {}, onClose);
        await screen.findByText('Unique Miles');
        fireEvent.mouseDown(document.querySelector('.fixed.inset-0')!);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('stays open when the panel is clicked', async () => {
        const onClose = jest.fn();
        renderStats('imperial', {}, onClose);
        fireEvent.mouseDown(await screen.findByText('Unique Miles'));
        expect(onClose).not.toHaveBeenCalled();
    });
});
