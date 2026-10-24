import { sendTelegramMessage } from './telegram';

const ORIGINAL_ENV = process.env;
beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '99' };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
});
afterAll(() => { process.env = ORIGINAL_ENV; });

describe('sendTelegramMessage (#129)', () => {
    it('posts the text to the configured chat through the bot API', async () => {
        expect(await sendTelegramMessage('hello')).toBe(true);
        const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
        expect(url).toBe('https://api.telegram.org/bottok/sendMessage');
        expect(JSON.parse(init.body)).toEqual({ chat_id: '99', text: 'hello' });
    });

    it('does nothing until the bot is configured', async () => {
        delete process.env.TELEGRAM_CHAT_ID;
        expect(await sendTelegramMessage('hello')).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('reports failure instead of throwing when Telegram is unreachable', async () => {
        (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await sendTelegramMessage('hello')).toBe(false);
    });
});
