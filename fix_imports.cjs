const fs = require('fs');

const path = 'src/components/financials/FinancialControlCenterView.tsx';
let content = fs.readFileSync(path, 'utf8');

// The file has badly mangled imports around line 68
// We'll replace the block from `runPhase49...` down to `SearchableSelect` with clean code

const fixRegex = /runPhase49FinancialClosingTests,[\s\S]*?import \{ SearchableSelect \} from "\.\.\/common\/SearchableSelect";/;

const newContent = `import {
  evaluateContinuousFinancialControl,
  createContinuousControlSnapshot,
  verifyContinuousControlSnapshotHash,
} from "../../services/continuousFinancialControlEngine";
import {
  ContinuousFinancialControlSummary,
  ContinuousControlForensicSnapshot,
  FinancialControlException,
} from "../../types";
import { SearchableSelect } from "../common/SearchableSelect";`;

content = content.replace(fixRegex, newContent);
fs.writeFileSync(path, content);
console.log('Fixed FinancialControlCenterView.tsx');

const path2 = 'src/components/financials/ProductionGovernanceCenterView.tsx';
let content2 = fs.readFileSync(path2, 'utf8');

// In ProductionGovernanceCenterView.tsx:
// src/components/financials/ProductionGovernanceCenterView.tsx(82,1): error TS1003: Identifier expected.
// Let's replace any `import {   runPhase.*` block with nothing or fix it.
content2 = content2.replace(/import \{[\s\n]*runPhase14GovernanceTests,[\s\S]*?\n\n/g, '\n');

fs.writeFileSync(path2, content2);
console.log('Fixed ProductionGovernanceCenterView.tsx');

