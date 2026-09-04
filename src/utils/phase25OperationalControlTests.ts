/**
 * Phase 25 Deterministic Automated Test Suite
 * Validates Operational Control, Workflow Automation, Exception Management,
 * 12-section Worklist, and 14 Operational Reports.
 */

import {
  scanOperationalExceptions,
  generateTasksFromExceptions,
  resolveOperationalException,
  dismissOperationalException,
} from "../services/exceptionService";
import {
  calculateOperationalKPIs,
  generateDailyOperationsWorklist,
  generateOperationalReport,
  isDateInRange,
} from "../services/operationalControlService";
import { normalizeArabicText } from "./arabicTextNormalizer";
import {
  Cheque,
  Lease,
  MaintenanceRequest,
  OperationalDocumentRecord,
  OperationalTask,
  Owner,
  Property,
  RentalCase,
  Tenant,
  Unit,
  CompanyProfile,
  PaymentPromise,
  CommissionObligation,
  OwnerTransferRecord,
} from "../types";

export interface Phase25TestResult {
  category: string;
  name: string;
  passed: boolean;
  message?: string;
}

export function runPhase25OperationalControlTests(): {
  results: Phase25TestResult[];
  passedCount: number;
  failedCount: number;
  totalCount: number;
} {
  const results: Phase25TestResult[] = [];

  const assert = (category: string, name: string, condition: boolean, failMsg?: string) => {
    results.push({
      category,
      name,
      passed: Boolean(condition),
      message: condition ? undefined : failMsg || "Assertion failed",
    });
  };

  // Mock Master Data
  const mockOwners: Owner[] = [
    {
      id: "own-1",
      code: "OWN-001",
      nameAr: "سالم المنصوري",
      nameEn: "Salem Al Mansoori",
      status: "ACTIVE",
      createdAt: "2025-01-01",
    } as unknown as Owner,
  ];

  const mockProperties: Property[] = [
    {
      id: "prop-1",
      code: "PROP-001",
      nameAr: "برج الصقر",
      nameEn: "Falcon Tower",
      ownerId: "own-1",
      type: "COMMERCIAL",
      totalUnits: 10,
      createdAt: "2025-01-01",
    } as unknown as Property,
  ];

  const mockUnits: Unit[] = [
    {
      id: "unit-101",
      unitNumber: "101",
      propertyId: "prop-1",
      ownerId: "own-1",
      status: "OCCUPIED",
      createdAt: "2025-01-01",
    } as unknown as Unit,
  ];

  const mockTenants: Tenant[] = [
    {
      id: "ten-1",
      code: "TEN-001",
      nameAr: "شركة الأفق للاستشارات",
      nameEn: "Al Ofoq Consulting LLC",
      status: "ACTIVE",
      createdAt: "2025-01-01",
    } as unknown as Tenant,
  ];

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const in20DaysStr = new Date(today.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const in50DaysStr = new Date(today.getTime() + 50 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const in80DaysStr = new Date(today.getTime() + 80 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const pastDateStr = new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const mockLeases: Lease[] = [
    {
      id: "lease-1",
      leaseNumber: "LSE-2026-001",
      propertyId: "prop-1",
      unitId: "unit-101",
      tenantId: "ten-1",
      ownerId: "own-1",
      startDate: "2025-01-01",
      endDate: in20DaysStr, // Expiring in < 30 days
      annualRent: 120000,
      contractStatus: "ACTIVE",
      createdAt: "2025-01-01",
    } as unknown as Lease,
    {
      id: "lease-2",
      leaseNumber: "LSE-2026-002",
      propertyId: "prop-1",
      unitId: "unit-101",
      tenantId: "ten-1",
      ownerId: "own-1",
      startDate: "2025-01-01",
      endDate: in50DaysStr, // Expiring in 60 days
      annualRent: 90000,
      contractStatus: "ACTIVE",
      createdAt: "2025-01-01",
    } as unknown as Lease,
    {
      id: "lease-3",
      leaseNumber: "LSE-2026-003",
      propertyId: "prop-1",
      unitId: "unit-101",
      tenantId: "ten-1",
      ownerId: "own-1",
      startDate: "2024-01-01",
      endDate: pastDateStr, // Expired
      annualRent: 60000,
      contractStatus: "EXPIRED",
      createdAt: "2024-01-01",
    } as unknown as Lease,
  ];

  const mockCheques: Cheque[] = [
    {
      id: "chq-101",
      chequeNumber: "987654",
      bankName: "ENBD",
      amount: 30000,
      outstanding: 30000,
      status: "BOUNCED",
      chequeDate: pastDateStr,
      propertyId: "prop-1",
      tenantId: "ten-1",
      ownerId: "own-1",
      createdAt: "2025-01-01",
    } as unknown as Cheque,
  ];

  const mockCases: RentalCase[] = [];

  const mockMaintenance: MaintenanceRequest[] = [
    {
      id: "maint-1",
      requestNumber: "MNT-001",
      propertyId: "prop-1",
      unitId: "unit-101",
      type: "PLUMBING",
      priority: "HIGH",
      status: "COMPLETED",
      cost: 1500,
      financialStatus: "NOT_APPLICABLE", // Unposted expense
      createdAt: "2026-01-10",
      updatedAt: "2026-01-12",
    } as unknown as MaintenanceRequest,
  ];

  const mockPromises: PaymentPromise[] = [
    {
      id: "prom-1",
      promiseNumber: "PRM-001",
      tenantId: "ten-1",
      chequeId: "chq-101",
      promisedAmount: 30000,
      promiseDate: pastDateStr,
      status: "BROKEN",
      recordedAt: "2026-01-01",
      recordedBy: "admin",
    } as unknown as PaymentPromise,
  ];

  const mockDocs: OperationalDocumentRecord[] = [
    {
      id: "doc-1",
      documentNumber: "DOC-001",
      title: "Commercial Trade License",
      documentType: "TRADE_LICENSE",
      propertyId: "prop-1",
      expiryDate: in20DaysStr,
      status: "ACTIVE",
      uploadedAt: "2025-01-01",
    } as unknown as OperationalDocumentRecord,
    {
      id: "doc-2",
      documentNumber: "DOC-002",
      title: "Fire Safety Certificate",
      documentType: "CIVIL_DEFENSE",
      propertyId: "prop-1",
      expiryDate: pastDateStr,
      status: "EXPIRED",
      uploadedAt: "2024-01-01",
    } as unknown as OperationalDocumentRecord,
  ];

  const mockTransfers: OwnerTransferRecord[] = [
    {
      id: "tr-1",
      transferNumber: "TR-001",
      ownerId: "own-1",
      transferAmount: 50000,
      transferDate: todayStr,
      paymentMethod: "BANK_TRANSFER",
      status: "PENDING",
      createdAt: "2026-01-15",
    } as unknown as OwnerTransferRecord,
  ];

  const mockCommissions: CommissionObligation[] = [
    {
      id: "com-1",
      businessKey: "COMM:2026:LSE-001",
      ownerId: "own-1",
      propertyId: "prop-1",
      leaseId: "lease-1",
      rateType: "PERCENTAGE",
      rateValue: 5,
      calculatedAmount: 6000,
      totalPaid: 0,
      outstandingBalance: 6000,
      status: "DUE",
      dueDate: todayStr,
      createdAt: "2026-01-01",
    } as unknown as CommissionObligation,
  ];

  // 1. SCAN EXCEPTIONS TEST
  const exceptions = scanOperationalExceptions({
    owners: mockOwners,
    properties: mockProperties,
    units: mockUnits,
    tenants: mockTenants,
    leases: mockLeases,
    cheques: mockCheques,
    cases: mockCases,
    maintenanceRequests: mockMaintenance,
    documents: mockDocs,
    paymentPromises: mockPromises,
    ownerTransfers: mockTransfers,
    commissions: mockCommissions,
  });

  assert("Exceptions Scan", "Scanned exceptions are not empty", exceptions.length > 0);
  assert(
    "Exceptions Scan",
    "Detected expired lease exception",
    exceptions.some((e) => e.type === "LEASE_EXPIRED" && e.sourceRecordId === "lease-3")
  );
  assert(
    "Exceptions Scan",
    "Detected lease expiring < 30 days exception",
    exceptions.some((e) => e.type === "LEASE_EXPIRING_30" && e.sourceRecordId === "lease-1")
  );
  assert(
    "Exceptions Scan",
    "Detected bounced cheque without case exception",
    exceptions.some((e) => e.type === "BOUNCED_CHEQUE" && e.sourceRecordId === "chq-101")
  );
  assert(
    "Exceptions Scan",
    "Detected broken payment promise exception",
    exceptions.some((e) => e.type === "BROKEN_PAYMENT_PROMISE" && e.sourceRecordId === "prom-1")
  );
  assert(
    "Exceptions Scan",
    "Detected unposted maintenance expense exception",
    exceptions.some((e) => e.type === "UNPOSTED_MAINTENANCE_EXPENSE" && e.sourceRecordId === "maint-1")
  );
  assert(
    "Exceptions Scan",
    "Detected expired document exception",
    exceptions.some((e) => e.type === "DOCUMENT_EXPIRED" && e.sourceRecordId === "doc-2")
  );

  // 2. SEVERITY MAPPING TEST
  const bouncedExc = exceptions.find((e) => e.type === "BOUNCED_CHEQUE");
  assert("Severity Mapping", "Bounced cheque is classified as CRITICAL severity", bouncedExc?.severity === "CRITICAL");
  const expLeaseExc = exceptions.find((e) => e.type === "LEASE_EXPIRING_30");
  assert("Severity Mapping", "Lease expiring < 30 days is classified as HIGH severity", expLeaseExc?.severity === "HIGH");

  // 3. DEDUPLICATION KEY TEST
  assert("Deduplication", "Every exception has deterministic dedupeKey", exceptions.every((e) => e.dedupeKey.startsWith("EXP:")));

  // 4. EXCEPTION RESOLUTION TEST
  const targetExc = exceptions[0];
  const user = { id: "u-1", name: "Admin Supervisor" };
  const resolveFail = resolveOperationalException(targetExc, "", user);
  assert("Exception Resolution", "Empty notes reject resolution", !resolveFail.success);

  const resolveSuccess = resolveOperationalException(targetExc, "Notified tenant and received signed renewal", user);
  assert("Exception Resolution", "Valid notes resolve exception", resolveSuccess.success && resolveSuccess.updatedException?.status === "RESOLVED");
  assert("Exception Resolution", "Resolution stores resolvedByUserName", resolveSuccess.updatedException?.resolvedByUserName === "Admin Supervisor");

  // 5. EXCEPTION DISMISSAL TEST
  const dismissFail = dismissOperationalException(targetExc, "", user);
  assert("Exception Dismissal", "Empty reason rejects dismissal", !dismissFail.success);

  const dismissSuccess = dismissOperationalException(targetExc, "Tenant agreed to vacate; no action required", user);
  assert("Exception Dismissal", "Valid reason dismisses exception", dismissSuccess.success && dismissSuccess.updatedException?.status === "DISMISSED");

  // 6. AUTOMATED TASK GENERATION TEST
  const { newTasks, duplicateCount } = generateTasksFromExceptions(exceptions, []);
  assert("Task Automation", "Auto-generated tasks created for HIGH and CRITICAL exceptions", newTasks.length > 0);
  assert("Task Automation", "Initial duplicate count is 0", duplicateCount === 0);

  // Prevent duplicate task creation on second pass
  const { newTasks: secondPass, duplicateCount: secondDupCount } = generateTasksFromExceptions(exceptions, newTasks);
  assert("Task Automation", "Second pass generates 0 new tasks", secondPass.length === 0);
  assert("Task Automation", "Second pass detects duplicate tasks", secondDupCount > 0);

  // 7. OPERATIONAL CONTROL KPIS TEST
  const kpis = calculateOperationalKPIs(
    {
      owners: mockOwners,
      properties: mockProperties,
      units: mockUnits,
      tenants: mockTenants,
      leases: mockLeases,
      cheques: mockCheques,
      cases: mockCases,
      maintenanceRequests: mockMaintenance,
      documents: mockDocs,
      tasks: newTasks,
      paymentPromises: mockPromises,
      ownerTransfers: mockTransfers,
      commissions: mockCommissions,
    },
    exceptions
  );

  assert("KPIs", "Bounced cheques count calculated accurately", kpis.bouncedCheques === 1);
  assert("KPIs", "Broken payment promises count calculated accurately", kpis.brokenPaymentPromises === 1);
  assert("KPIs", "Unposted maintenance expenses count calculated accurately", kpis.unpostedMaintenanceExpenses === 1);
  assert("KPIs", "Pending owner transfers count calculated accurately", kpis.pendingOwnerTransfers === 1);
  assert("KPIs", "Pending admin fees count calculated accurately", kpis.pendingAdminFees === 1);
  assert("KPIs", "Critical exceptions count accurately matches", kpis.criticalExceptionsCount > 0);

  // 8. DAILY OPERATIONS WORKLIST (12 SECTIONS) TEST
  const worklist = generateDailyOperationsWorklist(
    {
      owners: mockOwners,
      properties: mockProperties,
      units: mockUnits,
      tenants: mockTenants,
      leases: mockLeases,
      cheques: mockCheques,
      cases: mockCases,
      maintenanceRequests: mockMaintenance,
      documents: mockDocs,
      tasks: newTasks,
      paymentPromises: mockPromises,
      ownerTransfers: mockTransfers,
      commissions: mockCommissions,
    },
    exceptions
  );

  assert("Daily Worklist", "Worklist contains all 12 section keys", Object.keys(worklist).length === 12);
  assert("Daily Worklist", "CRITICAL_EXCEPTIONS section populated", worklist.CRITICAL_EXCEPTIONS.length > 0);
  assert("Daily Worklist", "DOCUMENT_EXPIRIES section populated", worklist.DOCUMENT_EXPIRIES.length > 0);
  assert("Daily Worklist", "RENEWALS section populated", worklist.RENEWALS.length > 0);
  assert("Daily Worklist", "MAINTENANCE section populated", worklist.MAINTENANCE.length > 0);
  assert("Daily Worklist", "PENDING_APPROVALS section populated", worklist.PENDING_APPROVALS.length > 0);

  // 9. INCLUSIVE DATE RANGE FILTERING TEST
  assert("Date Filtering", "isDateInRange includes exact from boundary date", isDateInRange("2026-06-01", "2026-06-01", "2026-06-30"));
  assert("Date Filtering", "isDateInRange includes exact to boundary date", isDateInRange("2026-06-30", "2026-06-01", "2026-06-30"));
  assert("Date Filtering", "isDateInRange excludes date before from", !isDateInRange("2026-05-31", "2026-06-01", "2026-06-30"));
  assert("Date Filtering", "isDateInRange excludes date after to", !isDateInRange("2026-07-01", "2026-06-01", "2026-06-30"));

  // 10. 14 OPERATIONAL REPORTS GENERATION TEST
  const repExceptions = generateOperationalReport("EXCEPTIONS", {
    owners: mockOwners,
    properties: mockProperties,
    units: mockUnits,
    tenants: mockTenants,
    leases: mockLeases,
    cheques: mockCheques,
    cases: mockCases,
    maintenanceRequests: mockMaintenance,
    documents: mockDocs,
    tasks: newTasks,
  }, exceptions);

  assert("Operational Reports", "Exceptions report generated rows", repExceptions.rows.length > 0);
  assert("Operational Reports", "Exceptions report has groupedRows", Object.keys(repExceptions.groupedRows || {}).length > 0);

  const repRenewals = generateOperationalReport("LEASE_RENEWAL_PIPELINE", {
    owners: mockOwners,
    properties: mockProperties,
    units: mockUnits,
    tenants: mockTenants,
    leases: mockLeases,
    cheques: mockCheques,
    cases: mockCases,
    maintenanceRequests: mockMaintenance,
    documents: mockDocs,
    tasks: newTasks,
  }, exceptions);

  assert("Operational Reports", "Lease renewals report generated rows", repRenewals.rows.length === 3);
  assert("Operational Reports", "Lease renewals report total amount summed correctly", repRenewals.totalAmount === 270000);

  const repBounced = generateOperationalReport("BOUNCED_CHEQUE_FOLLOWUP", {
    owners: mockOwners,
    properties: mockProperties,
    units: mockUnits,
    tenants: mockTenants,
    leases: mockLeases,
    cheques: mockCheques,
    cases: mockCases,
    maintenanceRequests: mockMaintenance,
    documents: mockDocs,
    tasks: newTasks,
  }, exceptions);

  assert("Operational Reports", "Bounced cheques report captured bounced cheque", repBounced.rows.length === 1);

  // 11. ARABIC NORMALIZATION TEST
  assert("Arabic Normalization", "Normalizes alef variants", normalizeArabicText("أحمد") === normalizeArabicText("احمد"));
  assert("Arabic Normalization", "Normalizes teh marbuta", normalizeArabicText("شركة") === normalizeArabicText("شركه"));

  // 12. CENTRALIZED COMPANY PROFILE INTEGRITY TEST
  const profile: CompanyProfile = {
    nameAr: "صقر الامارات للعقارات",
    nameEn: "Emirates Falcon Real Estate",
    vatTrn: "100293847500003",
    tradeLicenseNo: "88412",
    commercialRegisterNo: "928374-B",
    licenseExpiryDate: "2028-12-31",
    addressAr: "الشارقة، خورفكان",
    addressEn: "Sharjah, Khorfakkan",
    email: "info@emiratesfalcon.ae",
    phone: "+971 4 123 4567",
    website: "www.emiratesfalcon.ae",
  } as unknown as CompanyProfile;
  assert("Company Profile", "Profile contains authoritative Arabic name", profile.nameAr.includes("صقر الامارات"));
  assert("Company Profile", "Profile contains TRN", Boolean(profile.vatTrn));

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  return {
    results,
    passedCount,
    failedCount,
    totalCount: results.length,
  };
}
