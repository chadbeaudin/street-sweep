import { joinContiguousSegments } from './joinContiguousSegments';

describe('joinContiguousSegments (#46)', () => {
    it('joins segments that meet end to start', () => {
        expect(joinContiguousSegments([[[1, 1], [2, 2]], [[2, 2], [3, 3]]])).toEqual([[[1, 1], [2, 2], [2, 2], [3, 3]]]);
    });

    it('splits where a segment starts elsewhere, so no line crosses the gap', () => {
        const lines = joinContiguousSegments([[[1, 1], [2, 2]], [[5, 5], [6, 6]], [[6, 6], [7, 7]]]);
        expect(lines).toHaveLength(2);
        expect(lines[0]).toEqual([[1, 1], [2, 2]]);
    });

    it('ignores empty segments', () => {
        expect(joinContiguousSegments([[], [[1, 1], [2, 2]]])).toHaveLength(1);
    });
});
