import { DataContextType } from "../context/DataContext";
import { CommissionObligation, CommissionType } from "../types";

export interface TestResult {
  id: string;
  nameAr: string;
  nameEn: string;
  status: "PASS" | "FAIL" | "PENDING";
  error?: string;
  details?: string;
}

export const runPhase53DailyRevenueCollectionTests = async (
  context: DataContextType
): Promise<TestResult[]> => {
  const results: TestResult[] = [];
  const {
    commissions,
    leases,
    financialPeriods,
    addCommissionObligation,
    updateCommissionObligation,
    collectAdministrativeFee,
  } = context;

  const logTest = (nameAr: string, nameEn: string, logic: () => boolean | string | Promise<boolean | string>) => {
    const id = Math.random().toString(36).substring(7);
    results.push({ id, nameAr, nameEn, status: "PENDING" });
    return { id, logic };
  };

  const activeLease = leases.find(l => l.contractStatus === "ACTIVE");
  if (!activeLease) {
    return [{
      id: "error",
      nameAr: "خطأ في التجهيز",
      nameEn: "Setup Error",
      status: "FAIL",
      details: "No active lease found for testing."
    }];
  }

  // 1. Admin Fee Inclusive VAT
  const t1 = logTest(
    "رسوم إدارية - ضريبة شاملة (5%)",
    "Admin Fee - Inclusive VAT (5%)",
    async () => {
      const res = addCommissionObligation({
        leaseId: activeLease.id,
        propertyId: activeLease.propertyId,
        unitId: activeLease.unitId,
        ownerId: activeLease.ownerId,
        tenantId: activeLease.tenantId,
        partyType: "TENANT",
        commissionType: "ADMIN_FEE",
        calculationBasis: "FIXED_AMOUNT",
        baseAmount: 1050,
        fixedAmount: 1050,
        totalCommissionAmount: 1050,
        dueDate: new Date().toISOString().split("T")[0],
        businessKeySequence: "TEST_T1_" + Date.now(),
        isVatInclusive: true
      });

      if (!res.success || !res.commission) return "Failed to create admin fee";
      const com = res.commission;
      // Formula: VAT = 1050 * (5/105) = 50. Net = 1000.
      const isCorrect = com.vatAmount === 50 && com.netRevenueAmount === 1000;
      return isCorrect || `Expected VAT: 50, Net: 1000. Got VAT: ${com.vatAmount}, Net: ${com.netRevenueAmount}`;
    }
  );

  // 2. Bounced Cheque Penalty - VAT Exempt
  const t2 = logTest(
    "غرامة شيك مرتجع - إعفاء ضريبي",
    "Bounced Cheque Penalty - VAT Exempt",
    async () => {
      const res = addCommissionObligation({
        leaseId: activeLease.id,
        propertyId: activeLease.propertyId,
        unitId: activeLease.unitId,
        ownerId: activeLease.ownerId,
        tenantId: activeLease.tenantId,
        partyType: "TENANT",
        commissionType: "BOUNCED_CHEQUE_PENALTY",
        calculationBasis: "FIXED_AMOUNT",
        baseAmount: 500,
        fixedAmount: 500,
        totalCommissionAmount: 500,
        dueDate: new Date().toISOString().split("T")[0],
        businessKeySequence: "TEST_T2_" + Date.now()
      });

      if (!res.success || !res.commission) return "Failed to create penalty";
      const com = res.commission;
      const isCorrect = com.vatAmount === 0 && com.netRevenueAmount === 500;
      return isCorrect || `Expected VAT: 0, Net: 500. Got VAT: ${com.vatAmount}, Net: ${com.netRevenueAmount}`;
    }
  );

  // 3. Cleaning Fee - VAT Exempt
  const t3 = logTest(
    "رسوم نظافة - إعفاء ضريبي",
    "Cleaning Fee - VAT Exempt",
    async () => {
      const res = addCommissionObligation({
        leaseId: activeLease.id,
        propertyId: activeLease.propertyId,
        unitId: activeLease.unitId,
        ownerId: activeLease.ownerId,
        tenantId: activeLease.tenantId,
        partyType: "TENANT",
        commissionType: "CLEANING_FEE",
        calculationBasis: "FIXED_AMOUNT",
        baseAmount: 300,
        fixedAmount: 300,
        totalCommissionAmount: 300,
        dueDate: new Date().toISOString().split("T")[0],
        businessKeySequence: "TEST_T3_" + Date.now()
      });

      if (!res.success || !res.commission) return "Failed to create cleaning fee";
      return (res.commission.vatAmount === 0) || "VAT should be 0";
    }
  );

  // 4. Immutability Check
  const t4 = logTest(
    "قاعدة عدم القابلية للتغيير - المبالغ",
    "Immutability Rule - Amounts",
    async () => {
      const res = addCommissionObligation({
        leaseId: activeLease.id,
        propertyId: activeLease.propertyId,
        unitId: activeLease.unitId,
        ownerId: activeLease.ownerId,
        tenantId: activeLease.tenantId,
        partyType: "TENANT",
        commissionType: "OTHER_REVENUE",
        calculationBasis: "FIXED_AMOUNT",
        baseAmount: 1000,
        fixedAmount: 1000,
        totalCommissionAmount: 1000,
        dueDate: new Date().toISOString().split("T")[0],
        businessKeySequence: "TEST_T4_" + Date.now()
      });

      if (!res.success || !res.commission) return "Failed to create revenue";
      const updateRes = updateCommissionObligation(res.commission.id, { totalCommissionAmount: 2000 }, "Unauthorized Edit Attempt");
      return !updateRes.success || "Amount update should have failed due to immutability rule";
    }
  );

  // 5. Sequential Tracking (Duplicate Prevention)
  const t5 = logTest(
    "التتبع التسلسلي - منع التكرار",
    "Sequential Tracking - Duplicate Prevention",
    async () => {
      const seq = "SEQ_TEST_53";
      const res1 = addCommissionObligation({
        leaseId: activeLease.id,
        propertyId: activeLease.propertyId,
        unitId: activeLease.unitId,
        ownerId: activeLease.ownerId,
        tenantId: activeLease.tenantId,
        partyType: "TENANT",
        commissionType: "ADMIN_FEE",
        calculationBasis: "FIXED_AMOUNT",
        baseAmount: 1000,
        totalCommissionAmount: 1000,
        dueDate: new Date().toISOString().split("T")[0],
        businessKeySequence: seq
      });

      if (!res1.success) return "First insertion failed";

      const res2 = addCommissionObligation({
        leaseId: activeLease.id,
        propertyId: activeLease.propertyId,
        unitId: activeLease.unitId,
        ownerId: activeLease.ownerId,
        tenantId: activeLease.tenantId,
        partyType: "TENANT",
        commissionType: "ADMIN_FEE",
        calculationBasis: "FIXED_AMOUNT",
        baseAmount: 1000,
        totalCommissionAmount: 1000,
        dueDate: new Date().toISOString().split("T")[0],
        businessKeySequence: seq
      });

      return !res2.success || "Duplicate insertion with same sequence should have failed";
    }
  );

  // 6. Financial Period Enforcement
  const t6 = logTest(
    "حوكمة الفترات المالية - تاريخ مستقبلي مغلق",
    "Financial Period Enforcement - Closed Future Date",
    async () => {
      const futureDate = "2029-01-01";
      const res = addCommissionObligation({
        leaseId: activeLease.id,
        propertyId: activeLease.propertyId,
        unitId: activeLease.unitId,
        ownerId: activeLease.ownerId,
        tenantId: activeLease.tenantId,
        partyType: "TENANT",
        commissionType: "ADMIN_FEE",
        calculationBasis: "FIXED_AMOUNT",
        baseAmount: 1000,
        totalCommissionAmount: 1000,
        dueDate: futureDate,
        businessKeySequence: "TEST_T6_" + Date.now()
      });

      return !res.success || "Insertion in closed/future period should have failed";
    }
  );

  // 7. Full Collection Cycle
  const t7 = logTest(
    "دورة التحصيل الكاملة - ربط الإيراد",
    "Full Collection Cycle - Revenue Linkage",
    async () => {
      const res = addCommissionObligation({
        leaseId: activeLease.id,
        propertyId: activeLease.propertyId,
        unitId: activeLease.unitId,
        ownerId: activeLease.ownerId,
        tenantId: activeLease.tenantId,
        partyType: "TENANT",
        commissionType: "SECURITY_FEE",
        calculationBasis: "FIXED_AMOUNT",
        baseAmount: 2000,
        totalCommissionAmount: 2000,
        dueDate: new Date().toISOString().split("T")[0],
        businessKeySequence: "TEST_T7_" + Date.now()
      });

      if (!res.success || !res.commission) return "Failed to create security fee";
      
      const collectRes = await collectAdministrativeFee(
        res.commission.id,
        2000,
        "CASH",
        "RCP-TEST-53",
        "Full collection test",
        "TXN-" + Date.now()
      );

      return collectRes.success || "Collection process failed";
    }
  );

  // Execute All
  for (const t of [t1, t2, t3, t4, t5, t6, t7]) {
    const resultIndex = results.findIndex(r => r.id === t.id);
    try {
      const outcome = await t.logic();
      if (outcome === true) {
        results[resultIndex].status = "PASS";
      } else {
        results[resultIndex].status = "FAIL";
        results[resultIndex].error = typeof outcome === "string" ? outcome : "Unknown failure";
      }
    } catch (e: any) {
      results[resultIndex].status = "FAIL";
      results[resultIndex].error = e.message;
    }
  }

  return results;
};
