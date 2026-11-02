import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/docker-publish.yml'), 'utf8');
const flyToml = fs.readFileSync(path.join(root, 'fly.toml'), 'utf8');
const unraidTemplate = fs.readFileSync(path.join(root, 'templates/streetsweep-worker.xml'), 'utf8');

function jobBlock(name: string): string {
    const match = workflow.match(new RegExp(`^  ${name}:\\n((?:    .*\\n|\\s*\\n)*)`, 'm'));
    if (!match) throw new Error(`job ${name} not found`);
    return match[1];
}

describe('deploy config', () => {
    it('only publishes the DockerHub :latest image the worker auto-pulls after tests pass', () => {
        const job = jobBlock('publish-dockerhub');
        expect(job).toMatch(/needs: \[.*\btest\b.*\]/);
        expect(job).toContain('docker.io/bigtimber/streetsweep:latest');
    });

    it('no longer runs the worker on Fly', () => {
        expect(flyToml).not.toMatch(/^\s*worker\s*=/m);
        expect(flyToml).not.toMatch(/processes = \['worker'\]/);
    });

    it('deploys the Unraid worker from the published image and runs the tick loop', () => {
        expect(unraidTemplate).toContain('<Repository>bigtimber/streetsweep:latest</Repository>');
        expect(unraidTemplate).toContain("<PostArgs>sh -c 'node server.js &amp; sleep 5 &amp;&amp; node scripts/worker-tick-loop.js'</PostArgs>");
        expect(fs.existsSync(path.join(root, 'public/icons/icon-512.png'))).toBe(true);
    });

    it('binds the server to all interfaces so the worker tick loop can reach it on localhost', () => {
        const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
        expect(dockerfile).toMatch(/^ENV HOSTNAME 0\.0\.0\.0$/m);
    });
});
