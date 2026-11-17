import { E2E_ENV } from './env';

export default async function globalSetup() {
    Object.assign(process.env, E2E_ENV);
    const { seed } = await import('./seed');
    await seed();
}
