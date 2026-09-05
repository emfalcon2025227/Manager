const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      walkDir(filePath, callback);
    } else if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
      callback(filePath);
    }
  });
}

walkDir('src', (filePath) => {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Remove lines importing from phase... or disasterRecoverySimulator
  const lines = content.split('\n');
  const filteredLines = lines.filter(line => {
    if (line.includes('phase') && line.includes('import')) {
      modified = true;
      return false;
    }
    if (line.includes('disasterRecoverySimulator') && line.includes('import')) {
      modified = true;
      return false;
    }
    return true;
  });

  if (modified) {
    fs.writeFileSync(filePath, filteredLines.join('\n'));
    console.log(`Cleaned test imports in ${filePath}`);
  }
});
