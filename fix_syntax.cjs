const fs = require('fs');

const path = 'src/components/financials/FinancialControlCenterView.tsx';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(/import \{\s*import \{/g, 'import {');
fs.writeFileSync(path, content);
console.log('Fixed FinancialControlCenterView.tsx');

const path2 = 'src/components/financials/ProductionGovernanceCenterView.tsx';
let content2 = fs.readFileSync(path2, 'utf8');
content2 = content2.replace(/import \{\s*import \{/g, 'import {');
fs.writeFileSync(path2, content2);
console.log('Fixed ProductionGovernanceCenterView.tsx');
