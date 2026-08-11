// A comment/description counts as an FTP reading if it mentions "ftp"
// (case-insensitive) anywhere and contains a number in a plausible watts range.
// When multiple numbers are present, the one closest to an "ftp" mention wins —
// real example: "234W for the 20 min test which is 222W FTP" should pick 222,
// not the earlier 234. Other real examples: "I measured my FTP today and it
// was 245", "FTP test. 230" — loose natural language, not a strict "FTP: 123"
// format.
const MIN_PLAUSIBLE_WATTS = 50;
const MAX_PLAUSIBLE_WATTS = 600;

function closestPlausibleNumberTo(text: string, anchors: number[]): number | null {
    let best: { value: number; distance: number } | null = null;
    for (const match of text.matchAll(/\d{2,3}/g)) {
        const value = parseInt(match[0], 10);
        if (value < MIN_PLAUSIBLE_WATTS || value > MAX_PLAUSIBLE_WATTS) continue;
        const numberPos = match.index!;
        const distance = Math.min(...anchors.map(a => Math.abs(a - numberPos)));
        if (!best || distance < best.distance) best = { value, distance };
    }
    return best?.value ?? null;
}

function firstPlausibleNumber(text: string): number | null {
    for (const match of text.matchAll(/\d{2,3}/g)) {
        const value = parseInt(match[0], 10);
        if (value >= MIN_PLAUSIBLE_WATTS && value <= MAX_PLAUSIBLE_WATTS) return value;
    }
    return null;
}

export function parseFtpFromComment(text: string): number | null {
    const anchors = [...text.matchAll(/ftp/gi)].map(m => m.index!);
    if (anchors.length === 0) return null;
    return closestPlausibleNumberTo(text, anchors);
}

// When the activity's own name already signals FTP (e.g. "FTP Test"), a comment
// or description doesn't need to repeat "ftp" — any plausible number is the
// reading, preferring one near an "ftp" mention if present.
export function parseFtpFromNamedActivityComment(text: string): number | null {
    const anchors = [...text.matchAll(/ftp/gi)].map(m => m.index!);
    if (anchors.length > 0) return closestPlausibleNumberTo(text, anchors);
    return firstPlausibleNumber(text);
}

export interface FtpReading {
    value: number;
    date: string; // ISO, the activity's start date
    activityId: number;
}
