import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('This installer requires macOS.');

const root = fileURLToPath(new URL('../', import.meta.url));
const domain = `gui/${process.getuid()}`;
const agents = join(homedir(), 'Library/LaunchAgents');
const logs = join(homedir(), 'Library/Logs/room');
mkdirSync(agents, { recursive: true });
mkdirSync(logs, { recursive: true });
const xml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[char],
  );

function launchctl(args, required = true) {
  const result = spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
  if (required && result.status !== 0) {
    throw new Error(result.stderr || result.error?.message || `launchctl ${args[0]} failed`);
  }
}

for (const [name, command, args] of [
  ['site', 'sirv', ['dist', '--host', '0.0.0.0', '--port', '3210', '--etag', '--maxage', '0']],
  ['peer', 'peerjs', ['--port', '9000', '--path', '/room']],
]) {
  const label = `dev.dubrovin.room.${name}`;
  const file = join(agents, `${label}.plist`);
  const program = [
    process.execPath,
    realpathSync(join(root, 'node_modules/.bin', command)),
    ...args,
  ];
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>${program.map((arg) => `<string>${xml(arg)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${xml(dirname(process.execPath))}:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NODE_ENV</key><string>production</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(join(logs, `${name}.log`))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logs, `${name}.log`))}</string>
</dict></plist>
`,
  );
  launchctl(['bootout', `${domain}/${label}`], false);
  launchctl(['enable', `${domain}/${label}`]);
  launchctl(['bootstrap', domain, file]);
  console.log(`Started ${label}`);
}
console.log(`Logs: ${logs}`);
