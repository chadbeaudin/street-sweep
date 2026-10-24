// Admin alerts (#129). A no-op until TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.
export async function sendTelegramMessage(text: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return false;
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text }),
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) console.warn(`Telegram alert failed: ${res.status}`);
        return res.ok;
    } catch (e: any) {
        console.warn(`Telegram alert failed: ${e.message}`);
        return false;
    }
}
