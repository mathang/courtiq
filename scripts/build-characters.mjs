import { execFileSync } from 'node:child_process';

for (const character of ['river', 'sky']) {
  execFileSync(process.execPath, ['scripts/build-player.mjs', `--character=${character}`, '--optimise'], { stdio: 'inherit' });
}
