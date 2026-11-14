import { cp, mkdir, readFile, readdir, lstat, rm, mkdtemp, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, dirname, relative, isAbsolute, sep, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
export const mods = ['github-prs', 'github-tabs', 'git-changes', 'project-spaces', 'workspace-files'];
export const keyMods = ['legacy-prefix'];
const exists = async path => { try { return await lstat(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

function runHerdr(args) {
  const result = spawnSync('herdr-app', args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw new Error(`Cannot run herdr-app: ${result.error.message}. Install Herdr and add it to PATH first.`);
  if (result.status !== 0) throw new Error(`herdr-app ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  if (result.stdout.trim()) console.log(result.stdout.trim());
  // 'do' commands can report an error as JSON as well as via their exit code.
  try { const response = JSON.parse(result.stdout); if (response?.error) throw new Error(response.error); }
  catch (e) { if (!(e instanceof SyntaxError)) throw e; }
}

async function rejectLinks(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
  if (stat.isDirectory()) for (const child of await readdir(path)) await rejectLinks(join(path, child));
}

async function canonical(path) {
  try { return await realpath(path); }
  catch (e) { if (e.code !== 'ENOENT') throw e; return join(await canonical(dirname(path)), basename(path)); }
}

export async function restore(changed, originals, target, backup, operations = { rm, cp }) {
  const failures = [];
  for (const entry of [...changed].reverse()) {
    try {
      await operations.rm(join(target, entry), { recursive: true, force: true });
      if (originals.has(entry)) await operations.cp(join(backup, entry), join(target, entry), { recursive: true });
    } catch (e) { failures.push(`${entry}: ${e.message}`); }
  }
  return failures;
}

/** Installs named custom assets. Keybindings are opt-in and backed up/restored
 * with their helper mod. Never copies other personal state or credentials. */
export async function install({ target = join(homedir(), '.config', 'herdr-app'), source = here, activate = false, withKeys = false, run = runHerdr } = {}) {
  const selectedMods = withKeys ? [...mods, ...keyMods] : mods;
  const entries = [...selectedMods.map(name => `mods/${name}`), 'layouts/github-workspace.json', 'session-bridge', ...(withKeys ? ['keys.json'] : [])];
  target = resolve(target); source = resolve(source);
  const inside = (parent, child) => { const path = relative(parent, child); return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path)); };
  const realSource = await canonical(source), realTarget = await canonical(target);
  if (inside(realSource, realTarget) || inside(realTarget, realSource)) throw new Error('Source and target must be separate folders.');
  // Complete preflight before changing any installed files.
  for (const entry of entries) await rejectLinks(join(source, entry));
  if (withKeys) {
    const keys = JSON.parse(await readFile(join(source, 'keys.json'), 'utf8'));
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!object(keys) || Object.values(keys).some(section => !object(section) || Object.values(section).some(action => typeof action !== 'string')))
      throw new Error('keys.json must contain sections of key-to-command string mappings.');
  }
  const layout = JSON.parse(await readFile(join(source, 'layouts/github-workspace.json'), 'utf8'));
  if (layout.cloned_from?.name !== 'main') throw new Error('Expected a personal github-workspace layout clone.');
  for (const name of selectedMods) {
    await readFile(join(source, 'mods', name, 'main.js'));
    const metadata = JSON.parse(await readFile(join(source, 'mods', name, 'mod.json'), 'utf8'));
    if (metadata.place !== 'none') throw new Error(`${name}: expected explicit layout placement.`);
  }
  for (const folder of ['', 'mods', 'layouts', 'backups']) {
    const path = join(target, folder), stat = await exists(path);
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) throw new Error(`Expected an ordinary directory: ${path}`);
  }
  for (const entry of entries) if (await exists(join(target, entry))) await rejectLinks(join(target, entry));
  run(['--version']);
  await mkdir(join(target, 'backups'), { recursive: true });
  const backup = await mkdtemp(join(target, 'backups', 'github-workspace-'));
  const originals = new Set();
  for (const entry of entries) if (await exists(join(target, entry))) {
    await mkdir(dirname(join(backup, entry)), { recursive: true });
    await cp(join(target, entry), join(backup, entry), { recursive: true });
    originals.add(entry);
  }
  const changed = [];
  try {
    for (const entry of entries) {
      changed.push(entry);
      await rm(join(target, entry), { recursive: true, force: true });
      await mkdir(dirname(join(target, entry)), { recursive: true });
      await cp(join(source, entry), join(target, entry), { recursive: true });
    }
    for (const name of selectedMods) run(['check', join(target, 'mods', name)]);
  } catch (error) {
    const failures = await restore(changed, originals, target, backup);
    const outcome = failures.length ? `Some files could not be restored:\n${failures.join('\n')}` : 'previous files restored.';
    throw new Error(`Install failed; ${outcome}\nBackup: ${backup}\n${error.message}`, { cause: error });
  }
  if (activate) run(['do', 'layout.switch', '--name', 'github-workspace']);
  return { target, backup };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2); let target, activate = false, withKeys = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--activate') activate = true;
      else if (args[i] === '--with-keys') withKeys = true;
      else if (args[i] === '--home' && args[i + 1] && !args[i + 1].startsWith('--')) target = args[++i];
      else if (args[i] === '--help') {
        console.log("Usage: node herdr-app/install.mjs [--activate] [--with-keys] [--home <Herdr config directory>]\n--with-keys replaces this computer's keybindings with the bundled preset (old keys are backed up)."); process.exit(0);
      } else throw new Error(`Unknown or incomplete option: ${args[i]}`);
    }
    const result = await install({ target, activate, withKeys });
    console.log(`Installed GitHub Workspace to ${result.target}\nBackup: ${result.backup}`);
    if (withKeys) console.log('Shared keybindings installed, including the Ctrl+B prefix menu. Previous bindings are in the backup.');
    if (!activate) console.log('Open it: herdr-app do layout.switch --name github-workspace');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
