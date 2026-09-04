import { ForensicValidationMatrix } from "./phase57H8ForensicValidation";
import { Phase57H11ForensicValidationMatrix } from "./phase57H11ForensicValidation";
import { HardeningVerificationRunner } from "./hardeningVerificationSuite";

async function main() {
  console.log("\n================================================================================");
  console.log("EXECUTING COMPREHENSIVE FORENSIC & HARDENING VALIDATION SUITES");
  console.log("================================================================================");

  const runnerH8 = new ForensicValidationMatrix();
  const summaryH8 = await runnerH8.runAllTests();

  const runnerH11 = new Phase57H11ForensicValidationMatrix();
  const summaryH11 = await runnerH11.runAllTests();

  const runnerHardening = new HardeningVerificationRunner();
  const summaryHardening = await runnerHardening.runAll();

  console.log("\n================================================================================");
  console.log("HARDENING VERIFICATION DETAILED RESULTS (TEST-01 to TEST-21):");
  console.log("================================================================================");

  summaryHardening.results.forEach((r) => {
    const statusTag = r.passed ? "[PASS]" : "[FAIL]";
    console.log(`${statusTag} SECTION-${String(r.sectionId).padStart(2, "0")}: ${r.sectionName} -> ${r.testCase}`);
    console.log(`       Details: ${r.details}`);
    if (r.metrics) {
      console.log(`       Metrics: ${JSON.stringify(r.metrics)}`);
    }
  });

  const totalTests = summaryH8.total + summaryH11.total + summaryHardening.total;
  const totalFailed = summaryH8.failed + summaryH11.failed + summaryHardening.failed;

  console.log("\n================================================================================");
  if (totalFailed === 0) {
    console.log(`ALL ${totalTests} TESTS (${summaryH8.total} H.8 + ${summaryH11.total} H.11 + ${summaryHardening.total} Hardening) COMPLETED WITH 100% PASS RATE.`);
    process.exit(0);
  } else {
    console.error(`VALIDATION FAILED: ${totalFailed} tests failed out of ${totalTests}.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Forensic runner encountered fatal error:", err);
  process.exit(1);
});

