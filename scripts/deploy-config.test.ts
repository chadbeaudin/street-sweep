import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/docker-publish.yml'), 'utf8');
const flyToml = fs.readFileSync(path.join(root, 'fly.toml'), 'utf8');

function jobBlock(name: string): string {
    const match = workflow.match(new RegExp(`^  ${name}:\\n((?:    .*\\n|\\s*\\n)*)`, 'm'));
    if (!match) throw new Error(`job ${name} not found`);
    return match[1];
}

describe('deploy config', () => {
    it('only publishes the GHCR :latest image the worker auto-pulls after tests pass', () => {
        const job = jobBlock('publish-ghcr');
        expect(job).toMatch(/needs: \[.*\btest\b.*\]/);
        expect(job).toContain('ghcr.io/chadbeaudin/streetsweep:latest');
    });

    it('no longer runs the worker on Fly', () => {
        expect(flyToml).not.toMatch(/^\s*worker\s*=/m);
        expect(flyToml).not.toMatch(/processes = \['worker'\]/);
    });
});
