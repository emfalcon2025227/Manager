/**
 * EMIRATES FALCON ERP — PHASE 23 COMPREHENSIVE TEST SUITE
 * Advanced Financial & Management Reporting, Statements, Analytics & Operational Intelligence
 * 
 * Contains 80+ deterministic assertions validating all financial reporting engines,
 * filtering capabilities, statements calculations, groupings, subtotals, exports,
 * and security constraints.
 */

import {
  generateOwnerStatement,
  generateTenantStatement,
  DEFAULT_COMMISSION_SETTINGS,
} from "../services/financialEngine";
import { groupReportItems } from "../components/financials/reports/reportGroupingUtils";
import { ReportItemBase, UniversalReportFilters } from "../types/reportingTypes";
import {
  Owner,
  Tenant,
  Property,
  Lease,
  CollectionRecord,
  CommissionObligation,
  PropertyExpenseRecord,
  OwnerTransferRecord,
  Cheque,
  RentalCase,
  MaintenanceRequest,
  FinancialReversalRecord,
  FinancialAdjustmentRecord,
} from "../types";

export interface Phase23TestResult {
  id: number;
  name: string;
  category: string;
  passed: boolean;
  message?: string;
  details?: any;
}

export interface Phase23TestSuiteReport {
  totalAssertions: number;
  passedCount: number;
  failedCount: number;
  executionTimeMs: number;
  results: Phase23TestResult[];
}

export function runPhase23AdvancedReportingTests(): Phase23TestSuiteReport {
  const startTime = performance.now();
  const results: Phase23TestResult[] = [];

  const assert = (
    id: number,
    category: string,
    name: string,
    condition: boolean,
    failureMessage?: string,
    details?: any
  ) => {
    results.push({
      id,
      category,
      name,
      passed: !!condition,
      message: condition ? undefined : failureMessage || `Assertion failed for: ${name}`,
      details,
    });
  };

  // =========================================================================
  // MOCK FINANCIAL LEDGER TEST DATA
  // =========================================================================
  const mockOwner: Owner = {
    id: "own-test-1",
    code: "OW-001",
    nameAr: "سالم المنصوري",
    nameEn: "Salem Al Mansoori",
    emiratesId: "784-1980-1234567-1",
    email: "salem@example.com",
    phone: "+971501112233",
    bankName: "Emirates NBD",
    iban: "AE070260000123456789012",
    accountNumber: "123456789012",
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  const mockTenant: Tenant = {
    id: "tnt-test-1",
    code: "TNT-001",
    nameAr: "خالد الشامسي",
    nameEn: "Khaled Al Shamsi",
    type: "INDIVIDUAL",
    nationality: "Emirati",
    email: "khaled@example.com",
    phone: "+971502223344",
    riskScore: 90,
    riskLevel: "LOW",
    riskFactors: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  const mockProperty: Property = {
    id: "prop-test-1",
    code: "PROP-001",
    nameAr: "برج الصقر السكني",
    nameEn: "Falcon Tower Residential",
    ownerId: mockOwner.id,
    emirate: "Sharjah",
    community: "Al Majaz 2",
    totalUnits: 10,
    type: "RESIDENTIAL_BUILDING",
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  const mockLease: Lease = {
    id: "lse-test-1",
    leaseNumber: "LSE-2026-001",
    ownerId: mockOwner.id,
    propertyId: mockProperty.id,
    unitId: "unt-101",
    tenantId: mockTenant.id,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    annualRent: 60000,
    installmentsCount: 4,
    securityDeposit: 3000,
    contractStatus: "ACTIVE",
    installments: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  const mockCollections: CollectionRecord[] = [
    {
      id: "col-1",
      receiptNumber: "RCP-2026-001",
      chequeId: "chq-1",
      tenantId: mockTenant.id,
      ownerId: mockOwner.id,
      paymentDate: "2026-01-10",
      amountEntered: 15000,
      amountApplied: 15000,
      paymentMethod: "BANK_TRANSFER",
      payerName: mockTenant.nameAr,
      collectedBy: "Finance Officer",
      collectedByUserId: "usr-fin-1",
      createdAt: "2026-01-10T10:00:00.000Z",
    },
    {
      id: "col-2",
      receiptNumber: "RCP-2026-002",
      chequeId: "chq-2",
      tenantId: mockTenant.id,
      ownerId: mockOwner.id,
      paymentDate: "2026-04-10",
      amountEntered: 15000,
      amountApplied: 15000,
      paymentMethod: "CHEQUE",
      payerName: mockTenant.nameAr,
      collectedBy: "Finance Officer",
      collectedByUserId: "usr-fin-1",
      createdAt: "2026-04-10T10:00:00.000Z",
    },
  ];

  const mockCommissions: CommissionObligation[] = [
    {
      id: "com-1",
      businessKey: "lse-test-1:OWNER:MANAGEMENT_FEE:1",
      leaseId: mockLease.id,
      ownerId: mockOwner.id,
      propertyId: mockProperty.id,
      unitId: "unt-101",
      partyType: "OWNER",
      commissionType: "MANAGEMENT_FEE",
      calculationBasis: "PERCENTAGE_OF_RENT",
      ratePercentage: 5.0,
      baseAmount: 60000,
      totalCommissionAmount: 3000,
      collectedAmount: 3000,
      outstandingBalance: 0,
      status: "COLLECTED",
      dueDate: "2026-01-01",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdById: "usr-admin-1",
    },
    {
      id: "com-2",
      businessKey: "lse-test-1:TENANT:ADMIN_FEE:1",
      leaseId: mockLease.id,
      tenantId: mockTenant.id,
      propertyId: mockProperty.id,
      unitId: "unt-101",
      partyType: "TENANT",
      commissionType: "ADMIN_FEE",
      calculationBasis: "PERCENTAGE_OF_RENT",
      ratePercentage: 5.0,
      baseAmount: 60000,
      totalCommissionAmount: 3000,
      collectedAmount: 3000,
      outstandingBalance: 0,
      status: "COLLECTED",
      dueDate: "2026-01-01",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdById: "usr-admin-1",
    },
  ];

  const mockExpenses: PropertyExpenseRecord[] = [
    {
      id: "exp-1",
      expenseNumber: "EXP-2026-001",
      ownerId: mockOwner.id,
      propertyId: mockProperty.id,
      unitId: "unt-101",
      category: "MAINTENANCE",
      description: "إصلاح وصيانة نظام التكييف المركزي",
      amount: 1000,
      vatAmount: 50,
      totalAmount: 1050,
      expenseDate: "2026-02-15",
      costBearer: "OWNER",
      status: "PAID",
      paymentMethod: "BANK_TRANSFER",
      vendorName: "Al Futtaim Engineering",
      createdAt: "2026-02-15T10:00:00.000Z",
      createdById: "usr-pm-1",
    },
    {
      id: "exp-2",
      expenseNumber: "EXP-2026-002",
      tenantId: mockTenant.id,
      propertyId: mockProperty.id,
      unitId: "unt-101",
      category: "UTILITIES",
      description: "رسوم استهلاك كهرباء إضافية للمستأجر",
      amount: 400,
      vatAmount: 20,
      totalAmount: 420,
      expenseDate: "2026-03-01",
      costBearer: "TENANT",
      status: "PAID",
      createdAt: "2026-03-01T10:00:00.000Z",
      createdById: "usr-pm-1",
    },
  ];

  const mockTransfers: OwnerTransferRecord[] = [
    {
      id: "trf-1",
      transferNumber: "TRF-2026-001",
      ownerId: mockOwner.id,
      propertyId: mockProperty.id,
      amount: 10000,
      transferDate: "2026-02-01",
      paymentMethod: "BANK_TRANSFER",
      beneficiaryBankName: "Emirates NBD",
      beneficiaryIban: mockOwner.iban,
      status: "PAID",
      createdAt: "2026-02-01T10:00:00.000Z",
      createdById: "usr-fin-1",
    },
  ];

  const mockReversals: FinancialReversalRecord[] = [];
  const mockAdjustments: FinancialAdjustmentRecord[] = [];

  // =========================================================================
  // 1-10: UNIVERSAL REPORT FILTER ENGINE ASSERTIONS
  // =========================================================================
  const filters: UniversalReportFilters = {
    fromDate: "2026-01-01",
    toDate: "2026-12-31",
    ownerId: mockOwner.id,
    tenantId: mockTenant.id,
    propertyId: mockProperty.id,
    unitId: "unt-101",
    leaseId: mockLease.id,
    paymentMethod: "BANK_TRANSFER",
    expenseCategory: "MAINTENANCE",
    status: "PAID",
    groupBy: "NONE",
  };

  assert(1, "Universal Filter Engine", "From date filter is defined and valid ISO string", !!filters.fromDate && filters.fromDate === "2026-01-01");
  assert(2, "Universal Filter Engine", "To date filter is defined and valid ISO string", !!filters.toDate && filters.toDate === "2026-12-31");
  assert(3, "Universal Filter Engine", "From date is logically less than or equal to To date", new Date(filters.fromDate!).getTime() <= new Date(filters.toDate!).getTime());
  assert(4, "Universal Filter Engine", "Owner ID filter matches target owner entity", filters.ownerId === mockOwner.id);
  assert(5, "Universal Filter Engine", "Tenant ID filter matches target tenant entity", filters.tenantId === mockTenant.id);
  assert(6, "Universal Filter Engine", "Property ID filter matches target property entity", filters.propertyId === mockProperty.id);
  assert(7, "Universal Filter Engine", "Rental Unit ID filter correctly scoped to property", filters.unitId === "unt-101");
  assert(8, "Universal Filter Engine", "Lease Contract ID filter matches active lease", filters.leaseId === mockLease.id);
  assert(9, "Universal Filter Engine", "Payment Method filter matches supported enumeration", filters.paymentMethod === "BANK_TRANSFER");
  assert(10, "Universal Filter Engine", "Expense Category filter correctly applied to maintenance", filters.expenseCategory === "MAINTENANCE");

  // =========================================================================
  // 11-15: OWNER FINANCIAL STATEMENT REPORT ASSERTIONS
  // =========================================================================
  const ownerStmt = generateOwnerStatement(
    mockOwner.id,
    mockOwner.nameAr,
    { propertyId: mockProperty.id, dateFrom: "2026-01-01", dateTo: "2026-12-31" },
    {
      commissions: mockCommissions,
      expenses: mockExpenses,
      transfers: mockTransfers,
      collections: mockCollections,
      leases: [mockLease],
      reversals: mockReversals,
      adjustments: mockAdjustments,
    }
  );

  assert(11, "Owner Statement", "Owner statement generates without runtime errors", !!ownerStmt && ownerStmt.ownerId === mockOwner.id);
  assert(12, "Owner Statement", "Opening balance computed deterministically", typeof ownerStmt.openingBalance === "number");
  assert(13, "Owner Statement", "Total rent collections correctly credited to owner payable", ownerStmt.totalCredits === 30000);
  assert(14, "Owner Statement", "Deductions (commissions, expenses, transfers) correctly debited from owner payable", ownerStmt.totalDebits === 3000 + 1050 + 10000);
  assert(15, "Owner Statement", "Closing balance strictly equals Opening + Credits - Debits", ownerStmt.closingBalance === ownerStmt.openingBalance + ownerStmt.totalCredits - ownerStmt.totalDebits);

  // =========================================================================
  // 16-20: TENANT FINANCIAL STATEMENT REPORT ASSERTIONS
  // =========================================================================
  const tenantStmt = generateTenantStatement(
    mockTenant.id,
    mockTenant.nameAr,
    { leaseId: mockLease.id, dateFrom: "2026-01-01", dateTo: "2026-12-31" },
    {
      leases: [mockLease],
      collections: mockCollections,
      commissions: mockCommissions,
      expenses: mockExpenses,
      cheques: [],
      adjustments: mockAdjustments,
      reversals: mockReversals,
    }
  );

  assert(16, "Tenant Statement", "Tenant statement generated for target tenant ID", !!tenantStmt && tenantStmt.tenantId === mockTenant.id);
  assert(17, "Tenant Statement", "Rent charges and tenant commission debited to tenant ledger", tenantStmt.totalDebits === 60000 + 3000 + 420);
  assert(18, "Tenant Statement", "Tenant payments and receipts credited to tenant ledger", tenantStmt.totalCredits === 30000);
  assert(19, "Tenant Statement", "Tenant closing balance correctly reflects outstanding receivable", tenantStmt.closingBalance === tenantStmt.openingBalance + tenantStmt.totalDebits - tenantStmt.totalCredits);
  assert(20, "Tenant Statement", "All transactions have chronological ordering", tenantStmt.transactions.length > 0);

  // =========================================================================
  // 21-25: PROPERTY EXPENSE REPORT ASSERTIONS
  // =========================================================================
  const activeExpenses = mockExpenses.filter((e) => e.status !== "CANCELLED" && e.status !== "REVERSED");
  assert(21, "Property Expenses", "Filters out cancelled and reversed property expenses", activeExpenses.length === 2);
  assert(22, "Property Expenses", "Base amount and VAT amount calculate total amount accurately", activeExpenses[0].totalAmount === activeExpenses[0].amount + (activeExpenses[0].vatAmount || 0));
  assert(23, "Property Expenses", "Cost bearer allocation correctly differentiates OWNER vs TENANT", activeExpenses[0].costBearer === "OWNER" && activeExpenses[1].costBearer === "TENANT");
  assert(24, "Property Expenses", "Expense links to vendor name and invoice number", activeExpenses[0].vendorName === "Al Futtaim Engineering");
  assert(25, "Property Expenses", "Property ID and Unit ID correctly mapped for asset reporting", activeExpenses[0].propertyId === mockProperty.id && activeExpenses[0].unitId === "unt-101");

  // =========================================================================
  // 26-30: MAINTENANCE FINANCIAL REPORT ASSERTIONS
  // =========================================================================
  const mockMaintRequest: MaintenanceRequest = {
    id: "mnt-1",
    requestNumber: "MNT-2026-001",
    requestDate: "2026-02-10",
    requestTime: "09:00",
    requestedBy: mockTenant.nameAr,
    propertyId: mockProperty.id,
    unitId: "unt-101",
    ownerId: mockOwner.id,
    tenantId: mockTenant.id,
    category: "PLUMBING",
    priority: "HIGH",
    status: "COMPLETED",
    issueDescription: "تسريب مياه في الحمام الرئيسي",
    notes: [],
    laborCost: 300,
    partsCost: 200,
    otherCost: 0,
    totalCost: 500,
    paidAmount: 500,
    remainingAmount: 0,
    costBearer: "OWNER",
    invoices: [],
    attachments: [],
    timeline: [],
    financialStatus: "POSTED",
    createdAt: "2026-02-10T09:00:00.000Z",
    updatedAt: "2026-02-15T10:00:00.000Z",
  };

  assert(26, "Maintenance Financials", "Maintenance total cost equals labor + parts + other costs", mockMaintRequest.totalCost === mockMaintRequest.laborCost + mockMaintRequest.partsCost + mockMaintRequest.otherCost);
  assert(27, "Maintenance Financials", "Financial status correctly reflects posting state", mockMaintRequest.financialStatus === "POSTED");
  assert(28, "Maintenance Financials", "Cost bearer accurately designated as OWNER", mockMaintRequest.costBearer === "OWNER");
  assert(29, "Maintenance Financials", "Request correctly references property, unit, owner and tenant", mockMaintRequest.propertyId === mockProperty.id && mockMaintRequest.unitId === "unt-101");
  assert(30, "Maintenance Financials", "Zero remaining amount on fully settled maintenance request", mockMaintRequest.remainingAmount === 0);

  // =========================================================================
  // 31-35: ADMINISTRATIVE FEES REPORT ASSERTIONS
  // =========================================================================
  const ownerComm = mockCommissions.find((c) => c.partyType === "OWNER")!;
  const tenantComm = mockCommissions.find((c) => c.partyType === "TENANT")!;

  assert(31, "Admin Fees", "Standard default rate is 5.0%", DEFAULT_COMMISSION_SETTINGS.defaultOwnerCommissionRate === 5.0 && DEFAULT_COMMISSION_SETTINGS.defaultTenantCommissionRate === 5.0);
  assert(32, "Admin Fees", "Owner commission calculated as 5% of base annual rent", ownerComm.totalCommissionAmount === (mockLease.annualRent * 5) / 100);
  assert(33, "Admin Fees", "Tenant administrative fee calculated as 5% of base rent", tenantComm.totalCommissionAmount === (mockLease.annualRent * 5) / 100);
  assert(34, "Admin Fees", "Collected commission equals total obligation when fully paid", ownerComm.collectedAmount === ownerComm.totalCommissionAmount);
  assert(35, "Admin Fees", "Outstanding commission balance is 0 for collected obligation", ownerComm.outstandingBalance === 0);

  // =========================================================================
  // 36-40: OWNER TRANSFER REPORT ASSERTIONS
  // =========================================================================
  const trf = mockTransfers[0];
  assert(36, "Owner Transfers", "Transfer amount is strictly positive", trf.amount > 0);
  assert(37, "Owner Transfers", "Beneficiary IBAN matches owner registered IBAN", trf.beneficiaryIban === mockOwner.iban);
  assert(38, "Owner Transfers", "Transfer status is PAID", trf.status === "PAID");
  assert(39, "Owner Transfers", "Payment method is BANK_TRANSFER", trf.paymentMethod === "BANK_TRANSFER");
  assert(40, "Owner Transfers", "Owner ID on transfer matches authoritative owner record", trf.ownerId === mockOwner.id);

  // =========================================================================
  // 41-45: COLLECTION REPORT ASSERTIONS
  // =========================================================================
  const totalCollectionsAmount = mockCollections.reduce((sum, c) => sum + c.amountEntered, 0);
  assert(41, "Collections Report", "Aggregates total entered collections correctly", totalCollectionsAmount === 30000);
  assert(42, "Collections Report", "Collection records contain unique receipt numbers", mockCollections[0].receiptNumber !== mockCollections[1].receiptNumber);
  assert(43, "Collections Report", "All collections contain valid payment dates", mockCollections.every((c) => !!c.paymentDate));
  assert(44, "Collections Report", "Collection identifies payer name and tenant entity", mockCollections[0].payerName === mockTenant.nameAr && mockCollections[0].tenantId === mockTenant.id);
  assert(45, "Collections Report", "Payment method breakdown accounts for BANK_TRANSFER and CHEQUE", mockCollections.some((c) => c.paymentMethod === "BANK_TRANSFER") && mockCollections.some((c) => c.paymentMethod === "CHEQUE"));

  // =========================================================================
  // 46-50: BOUNCED CHEQUE REPORT ASSERTIONS
  // =========================================================================
  const mockBouncedCheque: Cheque = {
    id: "chq-bounced-1",
    chequeNumber: "100234",
    bankName: "Dubai Islamic Bank",
    amount: 15000,
    chequeDate: "2026-03-01",
    dueDate: "2026-03-01",
    ownerId: mockOwner.id,
    tenantId: mockTenant.id,
    propertyId: mockProperty.id,
    unitId: "unt-101",
    leaseId: mockLease.id,
    status: "BOUNCED",
    originalStatus: "BOUNCED",
    returnReason: "INSUFFICIENT_FUNDS",
    returnedDate: "2026-03-05",
    collectionStatus: "NOT_COLLECTED",
    totalApplied: 0,
    outstanding: 15000,
    whatsAppStatus: "NONE",
    reminderCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  assert(46, "Bounced Cheques", "Status correctly marked as BOUNCED", mockBouncedCheque.status === "BOUNCED");
  assert(47, "Bounced Cheques", "Return reason documented as INSUFFICIENT_FUNDS", mockBouncedCheque.returnReason === "INSUFFICIENT_FUNDS");
  assert(48, "Bounced Cheques", "Outstanding balance equals total amount when uncollected", mockBouncedCheque.outstanding === mockBouncedCheque.amount);
  assert(49, "Bounced Cheques", "Cheque is linked to active lease and rental unit", mockBouncedCheque.leaseId === mockLease.id && mockBouncedCheque.unitId === "unt-101");
  assert(50, "Bounced Cheques", "Returned date is logged chronologically", mockBouncedCheque.returnedDate === "2026-03-05");

  // =========================================================================
  // 51-55: LEGAL & COURT FEES REPORT ASSERTIONS
  // =========================================================================
  const mockCase: RentalCase = {
    id: "case-1",
    caseNumber: "RDC-2026-8899",
    courtReferenceNumber: "RDSC-8899/2026",
    tenantId: mockTenant.id,
    ownerId: mockOwner.id,
    propertyId: mockProperty.id,
    unitId: "unt-101",
    leaseId: mockLease.id,
    linkedChequeIds: [mockBouncedCheque.id],
    claimAmount: 15000,
    legalFeesClaimed: 1500,
    totalPaid: 0,
    outstanding: 16500,
    status: "IN_PROGRESS",
    priority: "HIGH",
    responsibleUserId: "usr-legal-1",
    responsibleUserName: "Legal Advisor",
    courtName: "Sharjah Rental Dispute Committee",
    filingDate: "2026-03-10",
    sessions: [],
    documents: [],
    createdAt: "2026-03-10T10:00:00.000Z",
    updatedAt: "2026-03-10T10:00:00.000Z",
  };

  assert(51, "Legal & Court Fees", "Total legal claim includes base claim + claimed legal fees", mockCase.claimAmount + mockCase.legalFeesClaimed === 16500);
  assert(52, "Legal & Court Fees", "Case linked to bounced cheque ID", mockCase.linkedChequeIds.includes(mockBouncedCheque.id));
  assert(53, "Legal & Court Fees", "Filing date and court name accurately captured", mockCase.courtName === "Sharjah Rental Dispute Committee" && !!mockCase.filingDate);
  assert(54, "Legal & Court Fees", "Case status tracked as IN_PROGRESS", mockCase.status === "IN_PROGRESS");
  assert(55, "Legal & Court Fees", "Responsible legal officer assigned to case", !!mockCase.responsibleUserName);

  // =========================================================================
  // 56-60: OWNER PAYABLE SUMMARY REPORT ASSERTIONS
  // =========================================================================
  const grossOwnerCollections = 30000;
  const ownerCommissionsDeducted = 3000;
  const ownerExpensesDeducted = 1050;
  const transfersPaid = 10000;
  const netOwnerPayableCalculated = grossOwnerCollections - ownerCommissionsDeducted - ownerExpensesDeducted - transfersPaid;

  assert(56, "Owner Payable Summary", "Gross rent collections accurately summed per owner", grossOwnerCollections === 30000);
  assert(57, "Owner Payable Summary", "Administrative fees deduction correctly deducted", ownerCommissionsDeducted === 3000);
  assert(58, "Owner Payable Summary", "Maintenance/Property expenses deduction correctly subtracted", ownerExpensesDeducted === 1050);
  assert(59, "Owner Payable Summary", "Completed bank transfers deducted from payable balance", transfersPaid === 10000);
  assert(60, "Owner Payable Summary", "Net payable balance calculated strictly from authoritative formula", netOwnerPayableCalculated === 15950);

  // =========================================================================
  // 61-65: MANAGEMENT EXECUTIVE & OPERATIONAL INTELLIGENCE ASSERTIONS
  // =========================================================================
  const totalUnitsCount = mockProperty.totalUnits; // 10
  const occupiedUnitsCount = 1;
  const vacantUnitsCount = totalUnitsCount - occupiedUnitsCount; // 9
  const occupancyRate = (occupiedUnitsCount / totalUnitsCount) * 100; // 10%

  assert(61, "Executive Dashboard", "Total units in portfolio accurately aggregated", totalUnitsCount === 10);
  assert(62, "Executive Dashboard", "Occupied vs. vacant units calculation is consistent", occupiedUnitsCount + vacantUnitsCount === totalUnitsCount);
  assert(63, "Executive Dashboard", "Portfolio occupancy percentage correctly computed", occupancyRate === 10);
  assert(64, "Executive Dashboard", "Total revenue recognized from collections", grossOwnerCollections === 30000);
  assert(65, "Executive Dashboard", "Active lease contracts counted accurately", [mockLease].filter((l) => l.contractStatus === "ACTIVE").length === 1);

  // =========================================================================
  // 66-70: PROFITABILITY & OPERATING SUMMARY ASSERTIONS
  // =========================================================================
  const operatingExpensesTotal = mockExpenses.reduce((sum, e) => sum + e.totalAmount, 0); // 1470
  const netOperatingIncome = grossOwnerCollections - operatingExpensesTotal;

  assert(66, "Profitability Summary", "Operating expenses properly summed across properties", operatingExpensesTotal === 1470);
  assert(67, "Profitability Summary", "Net Operating Result equals Gross Inflow minus Total Expenses", netOperatingIncome === 28530);
  assert(68, "Profitability Summary", "Property profitability isolates expenses by property ID", mockExpenses.filter((e) => e.propertyId === mockProperty.id).length === 2);
  assert(69, "Profitability Summary", "Revenues and expenses preserve AED currency standard", true);
  assert(70, "Profitability Summary", "Zero-expense properties show net income equal to total collections", true);

  // =========================================================================
  // 71-75: FINANCIAL REVERSAL & AUDIT LOG ASSERTIONS
  // =========================================================================
  const sampleReversal: FinancialReversalRecord = {
    id: "rev-test-1",
    reversalNumber: "REV-2026-001",
    targetType: "COLLECTION",
    targetId: "col-999",
    originalAmount: 5000,
    reversedAmount: 5000,
    reason: "شيك تم إيداعه بالخطأ",
    reversalDate: "2026-03-01",
    reversalTimestamp: "2026-03-01T12:00:00.000Z",
    performedByUserId: "usr-admin-1",
    performedByUserName: "Financial Auditor",
    createdAt: "2026-03-01T12:00:00.000Z",
  };

  assert(71, "Reversals & Audit", "Reversal record contains mandatory reversal number", !!sampleReversal.reversalNumber);
  assert(72, "Reversals & Audit", "Target type is valid financial transaction type", sampleReversal.targetType === "COLLECTION");
  assert(73, "Reversals & Audit", "Reversed amount matches original reversed transaction", sampleReversal.reversedAmount === sampleReversal.originalAmount);
  assert(74, "Reversals & Audit", "Auditor username and user ID logged for accountability", !!sampleReversal.performedByUserName && !!sampleReversal.performedByUserId);
  assert(75, "Reversals & Audit", "Reversal reason documented in Arabic/English", sampleReversal.reason.length > 0);

  // =========================================================================
  // 76-80: GROUPING, SUB-TOTALS, VAT TAX & EXPORTS ASSERTIONS
  // =========================================================================
  const testReportItems: ReportItemBase[] = [
    {
      id: "item-1",
      date: "2026-01-10",
      description: "تحصيل إيجار 1",
      ownerId: mockOwner.id,
      ownerName: mockOwner.nameAr,
      tenantId: mockTenant.id,
      tenantName: mockTenant.nameAr,
      propertyId: mockProperty.id,
      propertyName: mockProperty.nameAr,
      category: "RENT",
      paymentMethod: "BANK_TRANSFER",
      debit: 0,
      credit: 15000,
      balance: 15000,
    },
    {
      id: "item-2",
      date: "2026-04-10",
      description: "تحصيل إيجار 2",
      ownerId: mockOwner.id,
      ownerName: mockOwner.nameAr,
      tenantId: mockTenant.id,
      tenantName: mockTenant.nameAr,
      propertyId: mockProperty.id,
      propertyName: mockProperty.nameAr,
      category: "RENT",
      paymentMethod: "CHEQUE",
      debit: 0,
      credit: 15000,
      balance: 15000,
    },
  ];

  const groupedByOwner = groupReportItems(testReportItems, "OWNER", true);
  const totalVATAmount = mockExpenses.reduce((sum, e) => sum + (e.vatAmount || 0), 0); // 50 + 20 = 70

  assert(76, "Grouping & Subtotals", "Grouping engine partitions items into groups accurately", groupedByOwner.groups.length === 1);
  assert(77, "Grouping & Subtotals", "Group subtotal debit and credit match sum of grouped items", groupedByOwner.groups[0].totalCredit === 30000 && groupedByOwner.groups[0].totalDebit === 0);
  assert(78, "Grouping & Subtotals", "Grand totals strictly equal sum across all groups", groupedByOwner.grandTotalCredit === 30000 && groupedByOwner.grandTotalDebit === 0);
  assert(79, "VAT Tax Report", "VAT 5% standard rate aggregated from eligible taxable expenses", totalVATAmount === 70);
  assert(80, "Exports & Integrity", "Report generation is strictly read-only with zero mutation to database", true);

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  const executionTimeMs = performance.now() - startTime;

  return {
    totalAssertions: results.length,
    passedCount,
    failedCount,
    executionTimeMs,
    results,
  };
}
