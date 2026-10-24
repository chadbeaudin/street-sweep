export {};

const mockSend = jest.fn();
jest.mock('./telegram', () => ({ sendTelegramMessage: (...a: unknown[]) => mockSend(...a) }));

type Alerts = typeof import('./userAlerts');
let alertNewUser: Alerts['alertNewUser'];
let alertUserActive: Alerts['alertUserActive'];

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 24, 18);
const tester = { id: 'u1', name: 'Tess Ter', athleteId: '42', isAdmin: false, createdAt: new Date(NOW - 30 * 24 * HOUR), lastSeenAt: new Date(NOW - 3 * HOUR) };

beforeEach(() => {
    jest.isolateModules(() => { ({ alertNewUser, alertUserActive } = require('./userAlerts')); });
});

describe('alertNewUser (#133)', () => {
    it('names the new user with a link to their Strava profile', () => {
        alertNewUser({ id: 'u9', name: 'New Rider', athleteId: '9' });
        expect(mockSend).toHaveBeenCalledWith('StreetSweep: new user signed up: New Rider (https://www.strava.com/athletes/9)');
    });
});

describe('alertUserActive (#134)', () => {
    it('alerts when a tester comes back after an hour or more away', () => {
        alertUserActive(tester, NOW);
        expect(mockSend).toHaveBeenCalledWith('StreetSweep: Tess Ter (https://www.strava.com/athletes/42) is using the app');
    });

    it('alerts once per visit, not on every page load in it', () => {
        alertUserActive(tester, NOW);
        alertUserActive(tester, NOW + 5 * 60 * 1000);
        alertUserActive({ ...tester, lastSeenAt: new Date(NOW + 20 * 60 * 1000) }, NOW + 30 * 60 * 1000);
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('alerts for a tester never seen before (pre-tracking accounts)', () => {
        alertUserActive({ ...tester, lastSeenAt: null }, NOW);
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('stays quiet for admins, mid-visit users, and users who just signed up', () => {
        alertUserActive({ ...tester, isAdmin: true }, NOW);
        alertUserActive({ ...tester, lastSeenAt: new Date(NOW - 10 * 60 * 1000) }, NOW);
        alertUserActive({ ...tester, createdAt: new Date(NOW - 60 * 1000), lastSeenAt: null }, NOW);
        expect(mockSend).not.toHaveBeenCalled();
    });
});
