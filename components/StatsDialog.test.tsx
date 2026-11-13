/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { StatsDialog } from './StatsDialog';
import { shouldShowStatsButton } from '@/lib/stats';
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
const CREDS = { sessionLinked: true };

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

const dialog = (isOpen: boolean, onClose = jest.fn(), riddenRoads: [number, number][][] | null = RIDDEN) => (
    <UnitsProvider>
        <StatsDialog isOpen={isOpen} onClose={onClose} riddenRoads={riddenRoads} activityElevations={[]} activityTypes={[]} stravaCredentials={CREDS} activityMode="cycling" />
    </UnitsProvider>
);

function renderStats(units: 'imperial' | 'metric', overrides: Record<string, unknown> = {}, onClose = jest.fn()) {
    localStorage.setItem('unit_system', units);
    global.fetch = jest.fn((url: string) => Promise.resolve({
        json: async () => (url === '/api/stats' ? { ...stats, ...overrides } : url === '/api/stats/year' ? yearDetail : { readings: ftpReadings }),
    })) as unknown as typeof fetch;
    return render(dialog(true, onClose));
}

let ftpReadings: { value: number; date: string; activityId: number }[] = [];

beforeEach(() => {
    localStorage.clear();
    ftpReadings = [];
});

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

describe('StatsDialog virtual miles per year', () => {
    const rideTypeBreakdown = { mountain: { rides: 4, miles: 75, elevationFeet: 0 }, roadGravel: { rides: 1, miles: 25, elevationFeet: 0 } };
    const ridesPerYear = [{ year: 2016, rides: 5, miles: 100 }];
    const perYear = [{ year: 2016, mountainMiles: 75, roadGravelMiles: 25 }];
    const virtualPerYear = [{ year: 2016, rides: 3, miles: 100 }, { year: 2020, rides: 10, miles: 300 }];

    it('stacks virtual miles at the bottom of each year', async () => {
        renderStats('imperial', { rideTypeBreakdown: { ...rideTypeBreakdown, perYear }, ridesPerYear, virtualPerYear });
        expect(await screen.findByTestId('virtual-bar-2016')).toHaveStyle({ height: '50%' });
        expect(screen.getByTestId('mtb-bar-2016')).toHaveStyle({ height: '37.5%' });
        const stack = screen.getByTestId('virtual-bar-2016').parentElement!.children;
        expect(stack[0]).toBe(screen.getByTestId('virtual-bar-2016')); // flex-col-reverse: first child is the bottom
        expect(screen.getByText('Virtual')).toBeInTheDocument();
    });

    it('includes virtual rides in the tooltip', async () => {
        renderStats('imperial', { rideTypeBreakdown: { ...rideTypeBreakdown, perYear }, ridesPerYear, virtualPerYear });
        fireEvent.mouseEnter((await screen.findByText("'16")).parentElement!);
        const tip = screen.getByRole('tooltip');
        expect(tip).toHaveTextContent('200 mi · 8 rides');
        expect(tip).toHaveTextContent('Mountain Bike 75 mi');
        expect(tip).toHaveTextContent('Road / Gravel 25 mi');
        expect(tip).toHaveTextContent('Virtual 100 mi');
    });

    it('shows a virtual-only year that cannot be drilled into', async () => {
        renderStats('imperial', { rideTypeBreakdown: { ...rideTypeBreakdown, perYear }, ridesPerYear, virtualPerYear });
        expect(await screen.findByTestId('virtual-bar-2020')).toHaveStyle({ height: '100%' });
        expect(screen.getByRole('button', { name: 'View 2016 details' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'View 2020 details' })).not.toBeInTheDocument();
    });

    it('leaves the chart as it was for stats cached before virtual years existed', async () => {
        renderStats('imperial', { rideTypeBreakdown: { ...rideTypeBreakdown, perYear }, ridesPerYear: [...ridesPerYear, { year: 2017, rides: 1, miles: 10 }] });
        expect(await screen.findByTestId('mtb-bar-2016')).toHaveStyle({ height: '75%' });
        expect(screen.queryByText('Virtual')).not.toBeInTheDocument();
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

describe('StatsDialog refresh from Strava', () => {
    const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const statsCalls = () => (global.fetch as jest.Mock).mock.calls.filter(([url]) => url === '/api/stats').map(([, init]) => JSON.parse(init.body));

    it('asks the server to refresh and spins until it is done', async () => {
        renderStats('imperial', { refreshedAt: hourAgo(), refreshing: false });
        const button = await screen.findByRole('button', { name: 'Refresh from Strava' });
        expect(button).toBeEnabled();
        expect(button).toHaveClass('text-gray-600');
        expect(screen.queryByText('refreshing')).not.toBeInTheDocument();

        fireEvent.click(button);
        expect(screen.getByText('refreshing')).toBeInTheDocument();
        expect(button).toBeDisabled();
        await waitFor(() => expect(statsCalls()).toHaveLength(2));
        expect(statsCalls()[0].refresh).toBeUndefined();
        expect(statsCalls()[1]).toMatchObject({ refresh: true, activityMode: 'cycling' });
    });

    it('marks only the request made on opening as an open, so /admin counts opens and not polls or refreshes (#117)', async () => {
        renderStats('imperial', { refreshedAt: hourAgo(), refreshing: false });
        fireEvent.click(await screen.findByRole('button', { name: 'Refresh from Strava' }));
        await waitFor(() => expect(statsCalls()).toHaveLength(2));
        expect(statsCalls()[0].opened).toBe(true);
        expect(statsCalls()[1].opened).toBeUndefined();
    });

    it('keeps the overview on screen while refreshing', async () => {
        renderStats('imperial', { refreshedAt: hourAgo(), refreshing: false });
        fireEvent.click(await screen.findByRole('button', { name: 'Refresh from Strava' }));
        expect(screen.getByText('Unique Miles')).toBeInTheDocument();
        expect(screen.queryByText(/Crunching your/)).not.toBeInTheDocument();
    });

    it('is disabled within 15 minutes of the last update', async () => {
        renderStats('imperial', { refreshedAt: new Date().toISOString(), refreshing: false });
        const button = await screen.findByRole('button', { name: 'Refresh from Strava' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', 'Updated in the last 15 minutes');
        expect(button).toHaveClass('text-gray-300');
    });

    it('is disabled while a refresh is already running', async () => {
        renderStats('imperial', { refreshedAt: hourAgo(), refreshing: true });
        expect(await screen.findByRole('button', { name: 'Refresh from Strava' })).toBeDisabled();
        expect(screen.getByText('refreshing')).toBeInTheDocument();
    });
});

describe('StatsDialog FTP', () => {
    it('shows when the latest FTP was measured and how long ago', async () => {
        const measured = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000);
        ftpReadings = [{ value: 210, date: '2025-01-01T12:00:00Z', activityId: 1 }, { value: 222, date: measured.toISOString(), activityId: 2 }];
        renderStats('imperial');
        expect(await screen.findByText((_, el) => el?.textContent === '222w')).toBeInTheDocument();
        expect(screen.getByText(measured.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))).toHaveClass('text-gray-700');
        expect(screen.getByText('12 days ago')).toBeInTheDocument();
    });
});

describe('Stats button visibility', () => {
    it('shows as soon as the rider is on Strava, before their rides load', () => {
        expect(shouldShowStatsButton(true, false, null)).toBe(true);
        expect(shouldShowStatsButton(false, true, null)).toBe(true);
    });

    it('stays hidden for someone not on Strava, or with no rides', () => {
        expect(shouldShowStatsButton(false, false, null)).toBe(false);
        expect(shouldShowStatsButton(false, false, RIDDEN)).toBe(false);
        expect(shouldShowStatsButton(true, true, [])).toBe(false);
    });

    it('stays shown once rides have loaded', () => {
        expect(shouldShowStatsButton(true, true, RIDDEN)).toBe(true);
    });
});

describe('StatsDialog before rides load', () => {
    const renderWith = (riddenRoads: [number, number][][] | null) => {
        global.fetch = jest.fn((url: string) => Promise.resolve({
            json: async () => (url === '/api/stats' ? stats : { readings: [] }),
        })) as unknown as typeof fetch;
        return render(dialog(true, jest.fn(), riddenRoads));
    };
    const statsFetches = () => (global.fetch as jest.Mock).mock.calls.filter(([url]) => url === '/api/stats').length;

    it('loads stats from the server while the rides are still loading', async () => {
        renderWith(null);
        expect(await screen.findByText('Unique Miles')).toBeInTheDocument();
        expect(screen.getByText('100.0')).toBeInTheDocument();
    });

    it('does not refetch when the rides finish loading', async () => {
        const { rerender } = renderWith(null);
        await screen.findByText('Unique Miles');
        rerender(dialog(true, jest.fn(), RIDDEN));
        await screen.findByText('Unique Miles');
        expect(statsFetches()).toBe(1);
    });

    it('shows zeros without asking the server when there are no rides', async () => {
        renderWith([]);
        expect(await screen.findByText('Unique Miles')).toBeInTheDocument();
        expect(statsFetches()).toBe(0);
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

describe('StatsDialog error reporting (#117)', () => {
    it('reports a stats error the user sees', async () => {
        renderStats('imperial', { error: 'Strava is temporarily unavailable.' });
        await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url]) => url === '/api/client-error')).toBe(true));
        const report = (global.fetch as jest.Mock).mock.calls.find(([url]) => url === '/api/client-error');
        expect(JSON.parse(report[1].body)).toEqual({ kind: 'stats' });
    });
});
