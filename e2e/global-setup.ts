import { E2E_ENV } from './env';
import { seed } from './seed';

export default async function globalSetup() {
    Object.assign(process.env, E2E_ENV);
    await seed();
}
