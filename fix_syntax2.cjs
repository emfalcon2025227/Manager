const fs = require('fs');

const path2 = 'src/components/financials/ProductionGovernanceCenterView.tsx';
let content2 = fs.readFileSync(path2, 'utf8');
content2 = content2.replace(/import \{\n  runAllPhase14GovernanceTests,\n  Phase14Report,\n  Phase14TestResultItem,\n/g, '');
fs.writeFileSync(path2, content2);
console.log('Fixed ProductionGovernanceCenterView.tsx');
