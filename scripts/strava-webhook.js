// Manages the Strava app's single push subscription (#118).
//   node scripts/strava-webhook.js view
//   node scripts/strava-webhook.js create https://streetsweep.fly.dev/api/strava/webhook
//   node scripts/strava-webhook.js delete <subscription id>
// Needs STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET and (for create)
// STRAVA_WEBHOOK_VERIFY_TOKEN, matching the Fly secret the callback checks.
// The callback must already be deployed: Strava validates it during create.
try { require('dotenv').config({ path: '.env.local' }); } catch { /* env may come from the shell */ }

const API = 'https://www.strava.com/api/v3/push_subscriptions';

async function main() {
    const [command, arg] = process.argv.slice(2);
    const { STRAVA_CLIENT_ID: clientId, STRAVA_CLIENT_SECRET: clientSecret, STRAVA_WEBHOOK_VERIFY_TOKEN: verifyToken } = process.env;
    if (!clientId || !clientSecret) throw new Error('STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET are required');

    let res;
    if (command === 'view') {
        res = await fetch(`${API}?${new URLSearchParams({ client_id: clientId, client_secret: clientSecret })}`);
    } else if (command === 'create' && arg) {
        if (!verifyToken) throw new Error('STRAVA_WEBHOOK_VERIFY_TOKEN is required');
        res = await fetch(API, {
            method: 'POST',
            body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, callback_url: arg, verify_token: verifyToken }),
        });
    } else if (command === 'delete' && arg) {
        res = await fetch(`${API}/${arg}?${new URLSearchParams({ client_id: clientId, client_secret: clientSecret })}`, { method: 'DELETE' });
    } else {
        throw new Error('usage: strava-webhook.js view | create <callback url> | delete <subscription id>');
    }
    const text = await res.text();
    console.log(res.status, text);
    if (!res.ok) process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
