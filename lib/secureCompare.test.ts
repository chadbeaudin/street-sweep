import { safeEqual } from './secureCompare';

describe('safeEqual (#197)', () => {
    it('matches identical strings', () => {
        expect(safeEqual('s3cret', 's3cret')).toBe(true);
    });

    it('rejects different strings of equal and unequal length', () => {
        expect(safeEqual('s3cret', 's3creT')).toBe(false);
        expect(safeEqual('s3cret', 's3cre')).toBe(false);
        expect(safeEqual('', 's3cret')).toBe(false);
    });
});
