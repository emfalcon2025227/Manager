const fs = require('fs');

let code = fs.readFileSync('src/services/googleDriveService.ts', 'utf-8');

// Fix 1: Try to remove dangling `}` before `} catch`
code = code.replace(/    \}\n  \} catch/g, '  } catch');

// Fix 2: There might be dangling `}` before the end of try blocks if we removed `if` but left its body?
// Let's just fix it automatically using a simple formatter or by replacing the exact broken strings.
// Let's look at the output of the file.

fs.writeFileSync('src/services/googleDriveService.ts', code);
console.log('Fixed dangling catch braces');
