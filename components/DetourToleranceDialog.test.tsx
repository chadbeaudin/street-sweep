import { formatDetour } from './DetourToleranceDialog';

describe('formatDetour (#35)', () => {
    it('shows feet for imperial and metres for metric', () => {
        expect(formatDetour(100, 'imperial')).toBe('330 ft');
        expect(formatDetour(100, 'metric')).toBe('100 m');
        expect(formatDetour(0, 'imperial')).toBe('0 ft');
    });
});
