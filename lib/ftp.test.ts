import { parseFtpFromComment, parseFtpFromNamedActivityComment } from './ftp';

describe('parseFtpFromComment', () => {
    it('parses "I measured my FTP today and it was 245"', () => {
        expect(parseFtpFromComment('I measured my FTP today and it was 245')).toBe(245);
    });

    it('parses "FTP test. 230"', () => {
        expect(parseFtpFromComment('FTP test. 230')).toBe(230);
    });

    it('is case-insensitive on the "ftp" keyword', () => {
        expect(parseFtpFromComment('new ftp: 260w')).toBe(260);
        expect(parseFtpFromComment('New FTP 275')).toBe(275);
    });

    it('returns null when there is no "ftp" mention', () => {
        expect(parseFtpFromComment('Great ride, 245 miles today!')).toBeNull();
    });

    it('returns null when "ftp" appears but no plausible number does', () => {
        expect(parseFtpFromComment('finally did an FTP test')).toBeNull();
    });

    it('ignores implausibly low or high numbers and finds the plausible one', () => {
        expect(parseFtpFromComment('FTP test on lap 3, hit 245w average')).toBe(245);
        expect(parseFtpFromComment('my FTP is way over 9000 today, felt like 40')).toBeNull();
    });

    it('picks the first plausible number when multiple appear', () => {
        expect(parseFtpFromComment('FTP 250, up from 230 last month')).toBe(250);
    });

    it('handles casual banter unrelated to FTP without false positives', () => {
        expect(parseFtpFromComment("Heavy is the crown?")).toBeNull();
        expect(parseFtpFromComment('Everyone I ride with wants to go down big hill.')).toBeNull();
    });

    it('picks the number closest to "FTP", not the first one, when an earlier unrelated number exists', () => {
        expect(parseFtpFromComment(
            'I think the Kickr calibration is off. A separate recording on the Garmin using the Assioma pedals shows 234W for the 20 min test which is 222W FTP.'
        )).toBe(222);
    });
});

describe('parseFtpFromNamedActivityComment', () => {
    it('parses a plausible number even without the word "ftp" in the comment', () => {
        expect(parseFtpFromNamedActivityComment('245w, felt strong')).toBe(245);
        expect(parseFtpFromNamedActivityComment('230')).toBe(230);
    });

    it('returns null when no plausible number is present', () => {
        expect(parseFtpFromNamedActivityComment('Great effort today!')).toBeNull();
    });

    it('ignores implausible numbers', () => {
        expect(parseFtpFromNamedActivityComment('lap 3, felt like 40')).toBeNull();
    });

    it('prefers the number closest to "FTP" even without requiring it, for the real description example', () => {
        expect(parseFtpFromNamedActivityComment(
            'I think the Kickr calibration is off. A separate recording on the Garmin using the Assioma pedals shows 234W for the 20 min test which is 222W FTP. I\'ll calibrate and test again in a few weeks.'
        )).toBe(222);
    });
});
