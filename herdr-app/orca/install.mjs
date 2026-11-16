import { cp, mkdir, readFile, readdir, lstat, rm, mkdtemp } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { restore } from '../install.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const orcaMods = ['better-changes', 'better-config', 'better-sidebar', 'desktop-notifications', 'file-icons', 'files-open-with', 'hibernate', 'issues', 'live-ports', 'my-menu', 'my-new-menu', 'my-pane', 'my-status', 'my-tabs', 'my-worktree', 'new-project', 'new-worktree', 'open-vscode', 'project-settings', 'resources', 'sidebar-nav', 't3-actions', 'usage-limits'];
const exists = async path => { try { return await lstat(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

function runHerdr(args) {
  const result = spawnSync('herdr-app', args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw new Error(`Cannot run herdr-app: ${result.error.message}. Install Herdr and add it to PATH first.`);
  if (result.status !== 0) throw new Error(`herdr-app ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  if (result.stdout.trim()) console.log(result.stdout.trim());
  try { const response = JSON.parse(result.stdout); if (response?.error) throw new Error(response.error); }
  catch (e) { if (!(e instanceof SyntaxError)) throw e; }
}

async function rejectLinks(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
  if (stat.isDirectory()) for (const child of await readdir(path)) await rejectLinks(join(path, child));
}

/** Installs the Orca layout as one scoped bundle: layouts/orca.json, its 24
 * mods (all place:"none"), bundle tooling under bundles/orca, and only the
 * layout:orca key section (merged, never replacing a binding you have). */
export async function installOrca({ target = join(homedir(), '.config', 'herdr-app'), source = here, activate = false, run = runHerdr } = {}) {
  const entries = ['layouts/orca.json', ...orcaMods.map(name => `mods/${name}`), 'bundles/orca'];
  const sourceFor = entry => entry === 'bundles/orca' ? join(source, 'bundle') : join(source, entry);
  target = resolve(target); source = resolve(source);
  const inside = (parent, child) => { const path = relative(parent, child); return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path)); };
  if (inside(source, target) || inside(target, source)) throw new Error('Source and target must be separate folders.');

  // Preflight: nothing changes until every file is known good.
  for (const entry of entries) await rejectLinks(sourceFor(entry));
  JSON.parse(await readFile(join(source, 'layouts', 'orca.json'), 'utf8'));
  const orcaKeys = JSON.parse(await readFile(join(source, 'keys.json'), 'utf8'));
  const section = orcaKeys['layout:orca'];
  if (!section || Object.keys(orcaKeys).length !== 1 || Object.values(section).some(v => typeof v !== 'string'))
    throw new Error('orca/keys.json must contain only the layout:orca section of string bindings.');
  for (const name of orcaMods) {
    await readFile(join(source, 'mods', name, 'main.js'));
    const metadata = JSON.parse(await readFile(join(source, 'mods', name, 'mod.json'), 'utf8'));
    if (metadata.place !== 'none') throw new Error(`${name}: expected place "none" (the layout provides its slot).`);
  }
  run(['--version']);

  await mkdir(join(target, 'backups'), { recursive: true });
  const backup = await mkdtemp(join(target, 'backups', 'orca-'));
  const originals = new Set();
  for (const entry of [...entries, 'keys.json']) if (await exists(join(target, entry))) {
    await mkdir(dirname(join(backup, entry)), { recursive: true });
    await cp(join(target, entry), join(backup, entry), { recursive: true });
    originals.add(entry);
  }
  const changed = [];
  const conflicts = [];
  try {
    for (const entry of entries) {
      changed.push(entry);
      await rm(join(target, entry), { recursive: true, force: true });
      await mkdir(dirname(join(target, entry)), { recursive: true });
      await cp(sourceFor(entry), join(target, entry), { recursive: true });
    }
    // Merge only the layout-scoped chords; an existing different binding wins.
    changed.push('keys.json');
    const keysPath = join(target, 'keys.json');
    const current = (await exists(keysPath)) ? JSON.parse(await readFile(keysPath, 'utf8')) : {};
    current['layout:orca'] = { ...(current['layout:orca'] ?? {}) };
    for (const [chord, action] of Object.entries(section)) {
      if (current['layout:orca'][chord] && current['layout:orca'][chord] !== action) conflicts.push(chord);
      else current['layout:orca'][chord] = action;
    }
    await writeFile(keysPath, `${JSON.stringify(current, null, 2)}\n`);
    for (const name of orcaMods) run(['check', join(target, 'mods', name)]);
  } catch (error) {
    const failures = await restore(changed, originals, target, backup);
    const outcome = failures.length ? `Some files could not be restored:\n${failures.join('\n')}` : 'previous files restored.';
    throw new Error(`Orca install failed; ${outcome}\nBackup: ${backup}\n${error.message}`, { cause: error });
  }
  if (activate) run(['do', 'layout.switch', '--name', 'orca']);
  return { target, backup, conflicts };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2); let target, activate = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--activate') activate = true;
      else if (args[i] === '--home' && args[i + 1] && !args[i + 1].startsWith('--')) target = args[++i];
      else if (args[i] === '--help') {
        console.log('Usage: node herdr-app/orca/install.mjs [--activate] [--home <Herdr config directory>]'); process.exit(0);
      } else throw new Error(`Unknown or incomplete option: ${args[i]}`);
    }
    const result = await installOrca({ target, activate });
    console.log(`Installed Orca bundle to ${result.target}\nBackup: ${result.backup}`);
    if (result.conflicts.length) console.log(`Kept your existing layout:orca bindings for: ${result.conflicts.join(', ')}`);
    if (!activate) console.log('Open it: herdr-app do layout.switch --name orca');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
