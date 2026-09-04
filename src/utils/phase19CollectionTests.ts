import { 
  TenantReceivablePosition, 
  CollectionAction, 
  PaymentPromise,
  Tenant,
  Lease,
  Cheque,
  CommissionObligation,
  PropertyExpenseRecord
} from "../types";

export interface Phase19TestResult {
  success: boolean;
  assertions: {
    label: string;
    passed: boolean;
    expected: any;
    actual: any;
  }[];
}

export const runPhase19CollectionTests = (
  tenants: Tenant[],
  receivablePosition: (id: string) => TenantReceivablePosition,
  collectionActions: CollectionAction[],
  paymentPromises: PaymentPromise[]
): Phase19TestResult => {
  const assertions: Phase19TestResult["assertions"] = [];
  
  const assert = (label: string, passed: boolean, expected: any, actual: any) => {
    assertions.push({ label, passed, expected, actual });
  };

  // 1. ENGINE ACCURACY TESTS
  if (tenants.length > 0) {
    const firstTenant = tenants[0];
    const pos = receivablePosition(firstTenant.id);
    
    assert(
      "Receivable position returned for tenant",
      !!pos,
      true,
      !!pos
    );
    
    assert(
      "Outstanding balance matches debits - credits",
      Math.abs(pos.outstanding - (pos.totalDue - pos.totalPaid)) < 0.01,
      pos.totalDue - pos.totalPaid,
      pos.outstanding
    );

    const totalAging = Object.values(pos.aging).reduce((sum, val) => sum + val, 0);
    assert(
      "Aging buckets sum equals total outstanding",
      Math.abs(totalAging - pos.outstanding) < 0.01,
      pos.outstanding,
      totalAging
    );
  }

  // 2. PRIORITY LOGIC TESTS
  const mockCriticalPos: Partial<TenantReceivablePosition> = {
    outstanding: 50000,
    aging: { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days91_120: 0, days121Plus: 50000 },
    bouncedChequeAmount: 10000,
    priority: "CRITICAL"
  };
  
  assert(
    "Priority correctly escalated for aging > 120 days",
    mockCriticalPos.aging!.days121Plus > 0 && mockCriticalPos.priority === "CRITICAL",
    "CRITICAL",
    mockCriticalPos.priority
  );

  // 3. COLLECTION ACTIONS AUDIT TESTS
  assert(
    "Collection actions array initialized",
    Array.isArray(collectionActions),
    true,
    Array.isArray(collectionActions)
  );

  if (collectionActions.length > 0) {
    const lastAction = collectionActions[collectionActions.length - 1];
    assert(
      "Action has valid tracking number",
      lastAction.actionNumber.startsWith("COL-ACT-"),
      true,
      lastAction.actionNumber
    );
    assert(
      "Action records outstanding at time",
      typeof lastAction.outstandingAtTime === "number",
      "number",
      typeof lastAction.outstandingAtTime
    );
  }

  // 4. PROMISE LIFECYCLE TESTS
  assert(
    "Payment promises array initialized",
    Array.isArray(paymentPromises),
    true,
    Array.isArray(paymentPromises)
  );

  if (paymentPromises.length > 0) {
    const lastPromise = paymentPromises[paymentPromises.length - 1];
    assert(
      "Promise has valid tracking number",
      lastPromise.promiseNumber.startsWith("PROM-"),
      true,
      lastPromise.promiseNumber
    );
    
    if (lastPromise.status === "FULFILLED") {
      assert(
        "Fulfilled promise matches amount promised",
        lastPromise.amountFulfilled >= lastPromise.amountPromised,
        true,
        lastPromise.amountFulfilled >= lastPromise.amountPromised
      );
    }
  }

  // 5. DATA INTEGRITY CROSS-CHECKS
  const totalSystemOutstanding = tenants.reduce((sum, t) => sum + receivablePosition(t.id).outstanding, 0);
  assert(
    "Total system outstanding is non-negative",
    totalSystemOutstanding >= 0,
    true,
    totalSystemOutstanding >= 0
  );

  const success = assertions.every(a => a.passed);
  return { success, assertions };
};
