/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

const RIDDEN: [number, number][][] = [[[44, -121], [44.1, -121]]];
const CREDS = {};

const yearRide = (id: number, name: string, miles: number, mountainBike = false, date = '2016-06-15T17:00:00Z') => ({ id, name, date, miles, elevationFeet: 1000, mountainBike });

const yearDetail: Record<string, unknown> = {
    year: 2016,
    months: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        rides: i === 5 ? 3 : i === 6 ? 1 : 0,
        mountainMiles: i === 5 ? 25 : 0,
        roadGravelMiles: i === 5 ? 50 : i === 6 ? 25 : 0,
    })),
    rides: [yearRide(1, 'Morning Spin', 10, false, '2016-07-02T17:00:00Z'), yearRide(2, 'Epic Day', 50, true), yearRide(3, 'Commute', 15), yearRide(4, 'Gravel Loop', 25)],
};

const dialog = (isOpen: boolean, onClose = jest.fn()) => (
    <UnitsProvider>
        <StatsDialog isOpen={isOpen} onClose={onClose} riddenRoads={RIDDEN} activityElevations={[]} activityTypes={[]} stravaCredentials={CREDS} activityMode="cycling" />
    </UnitsProvider>
);

function renderStats(units: 'imperial' | 'metric', overrides: Record<string, unknown> = {}, onClose = jest.fn()) {
    localStorage.setItem('unit_system', units);
    global.fetch = jest.fn((url: string) => Promise.resolve({
        json: async () => (url === '/api/stats' ? { ...stats, ...overrides } : url === '/api/stats/year' ? yearDetail : { readings: [] }),
    })) as unknown as typeof fetch;
    return render(dialog(true, onClose));
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

describe('StatsDialog year drilldown', () => {
    const ridesPerYear = [{ year: 2016, rides: 4, miles: 100 }, { year: 2026, rides: 6, miles: 100 }];
    const openYear = async () => {
        fireEvent.click(await screen.findByRole('button', { name: 'View 2016 details' }));
        await screen.findByText('Biggest Rides');
    };

    it('loads the clicked year for the current mode', async () => {
        renderStats('imperial', { ridesPerYear });
        await openYear();
        const call = (global.fetch as jest.Mock).mock.calls.find(([url]) => url === '/api/stats/year');
        expect(JSON.parse(call[1].body)).toMatchObject({ year: 2016, activityMode: 'cycling' });
    });

    it('shows the totals, biggest rides and every ride linked to Strava', async () => {
        renderStats('imperial', { ridesPerYear });
        await openYear();
        expect(screen.getByRole('heading', { name: '2016' })).toBeInTheDocument();
        expect(screen.getByText('Outdoor rides')).toBeInTheDocument();
        expect(screen.getByText('4,000')).toBeInTheDocument();
        expect(screen.getByText('Miles per Month')).toBeInTheDocument();
        expect(screen.queryByText('Top Cities by Coverage')).not.toBeInTheDocument();

        const biggest = within(screen.getByText('Biggest Rides').parentElement!).getAllByRole('link');
        expect(biggest.map(a => a.textContent)).toEqual([expect.stringContaining('Epic Day'), expect.stringContaining('Gravel Loop'), expect.stringContaining('Commute')]);

        const all = within(screen.getByText('All Rides').parentElement!).getAllByRole('link');
        expect(all).toHaveLength(4);
        expect(all[0]).toHaveTextContent('Morning Spin');
        expect(all[0]).toHaveAttribute('href', 'https://www.strava.com/activities/1');
    });

    it('stacks the mountain bike share into each month', async () => {
        renderStats('imperial', { ridesPerYear });
        await openYear();
        expect(screen.getByTestId('mtb-bar-6')).toHaveStyle({ height: '33.33333333333333%' });
    });

    it('narrows to the clicked month and goes back to the year', async () => {
        renderStats('imperial', { ridesPerYear });
        await openYear();
        fireEvent.click(screen.getByRole('button', { name: 'View Jul 2016 details' }));

        expect(screen.getByRole('heading', { name: 'July 2016' })).toBeInTheDocument();
        expect(screen.getAllByRole('link').map(a => a.textContent)).toEqual([expect.stringContaining('Morning Spin')]);
        expect(screen.queryByText('Miles per Month')).not.toBeInTheDocument();
        expect(screen.queryByText('Biggest Rides')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back to 2016' }));
        expect(screen.getByRole('heading', { name: '2016' })).toBeInTheDocument();
        expect(screen.getByText('Miles per Month')).toBeInTheDocument();
        expect(within(screen.getByText('All Rides').parentElement!).getAllByRole('link')).toHaveLength(4);
    });

    it('does not refetch the year when moving between it and a month', async () => {
        renderStats('imperial', { ridesPerYear });
        await openYear();
        fireEvent.click(screen.getByRole('button', { name: 'View Jun 2016 details' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to 2016' }));
        expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url === '/api/stats/year')).toHaveLength(1);
    });

    it('does not make an empty month selectable', async () => {
        renderStats('imperial', { ridesPerYear });
        await openYear();
        expect(screen.queryByRole('button', { name: 'View Jan 2016 details' })).not.toBeInTheDocument();
    });

    it('starts over at the overview when reopened', async () => {
        const { rerender } = renderStats('imperial', { ridesPerYear });
        await openYear();
        fireEvent.click(screen.getByRole('button', { name: 'View Jun 2016 details' }));
        rerender(dialog(false));
        rerender(dialog(true));
        expect(await screen.findByRole('heading', { name: 'Your Coverage' })).toBeInTheDocument();
    });

    it('opens from the keyboard', async () => {
        renderStats('imperial', { ridesPerYear });
        fireEvent.keyDown(await screen.findByRole('button', { name: 'View 2016 details' }), { key: 'Enter' });
        expect(await screen.findByRole('heading', { name: '2016' })).toBeInTheDocument();
    });

    it('returns to the overview from the back button', async () => {
        renderStats('imperial', { ridesPerYear });
        await openYear();
        fireEvent.click(screen.getByRole('button', { name: 'Back to Your Coverage' }));
        expect(screen.getByRole('heading', { name: 'Your Coverage' })).toBeInTheDocument();
        expect(screen.getByText('Top Cities by Coverage')).toBeInTheDocument();
    });

    it('shows a load failure inside the year page', async () => {
        renderStats('imperial', { ridesPerYear });
        (global.fetch as jest.Mock).mockImplementation((url: string) => Promise.resolve({
            json: async () => (url === '/api/stats/year' ? { error: 'Strava is down' } : { ...stats, ridesPerYear }),
        }));
        fireEvent.click(await screen.findByRole('button', { name: 'View 2016 details' }));
        expect(await screen.findByText('Strava is down')).toBeInTheDocument();
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
