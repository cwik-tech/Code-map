// Local tarballs populate a cache without registry access.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { project } from './worker-fixtures.mjs';

/** Makes two cached package versions and commits different revision lockfiles. */
export function installProject(t) {
  const fixture = project(t), cache = join(fixture.work, 'cache');
  mkdirSync(cache);
  const npm = (args, cwd) => execFileSync('npm', args, { cwd, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, npm_config_offline: 'true', npm_config_cache: cache, npm_config_ignore_scripts: 'true' } });
  const revision = (version) => {
    const folder = join(fixture.work, `package-${version}`);
    mkdirSync(folder);
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'revision-dep', version, main: 'index.js',
      scripts: { install: 'node -e "require(\'fs\').writeFileSync(\'script-ran\', \'bad\')"' } }));
    writeFileSync(join(folder, 'index.js'), `module.exports = '${version}';\n`);
    const packed = JSON.parse(npm(['pack', '--json', '--ignore-scripts'], folder))[0];
    const tarball = join(folder, packed.filename), integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    npm(['cache', 'add', tarball, '--offline', '--ignore-scripts'], folder);
    fixture.put('package.json', JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { 'revision-dep': version },
      scripts: { postinstall: 'node -e "require(\'fs\').writeFileSync(\'script-ran\', \'bad\')"' } }));
    fixture.put('package-lock.json', JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
      packages: { '': { name: 'fixture', version: '1.0.0', dependencies: { 'revision-dep': version }, hasInstallScript: true },
        'node_modules/revision-dep': { version, resolved: `https://example.invalid/revision-dep-${version}.tgz`, integrity, hasInstallScript: true } } }));
    fixture.git('add', '.'); fixture.git('commit', '-qm', `dependencies ${version}`);
  };
  revision('1.0.0'); fixture.git('tag', '-f', 'base'); revision('2.0.0');
  return { ...fixture, cache };
}
