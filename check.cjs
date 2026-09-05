const fs = require('fs');
const lines = fs.readFileSync('src/services/googleDriveService.ts', 'utf-8').split('\n');

let depth = 0;
lines.forEach((line, i) => {
  const open = (line.match(/\{/g) || []).length;
  const close = (line.match(/\}/g) || []).length;
  
  if (close > open && depth + (open - close) < 0) {
     console.log(`Line ${i + 1} goes negative: ${line}`);
  }
  depth += (open - close);
  if (depth < 0) depth = 0;
});
console.log('Final depth:', depth);
