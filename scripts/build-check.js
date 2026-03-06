const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory()
      ? walk(fullPath)
      : fullPath.endsWith('.js')
        ? [fullPath]
        : [];
  });
}

const files = ['server.js', ...walk('src')];

for (const file of files) {
  const result = cp.spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`Build check passed: ${files.length} file(s) validated.`);
