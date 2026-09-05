import { Cheque, CollectionRecord, PaymentAllocation } from "../types";
import { 
  calculateChequeAllocations, 
  calculateCollectionAllocations,
  validatePaymentAllocations,
  computeOwnerPayableDetails
} from "../services/financialEngine";

export function runPhase1FinancialAllocationTests() {
  const results: any[] = [];
  const addResult = (name: string, passed: boolean) => results.push({ name, passed });

  console.log("Running Phase 1 Financial Allocation Tests...");

  // Test 1: Cheque = 5,000, Rent = 5,000
  try {
    const cheque: Cheque = { id: "CHQ-1", amount: 5000 } as Cheque;
    const allocations: PaymentAllocation[] = [
      { id: "A1", chequeId: "CHQ-1", targetType: "RENT", targetId: "lease-1", allocatedAmount: 5000, status: "ACTIVE" } as PaymentAllocation
    ];
    const allocs = calculateChequeAllocations(cheque, allocations);
    addResult("Test 1: Rent Only (Cheque)", allocs.rent === 5000 && allocs.admin === 0 && allocs.municipality === 0);
  } catch (e) { addResult("Test 1", false); }

  // Test 2: Cheque = 5,500, Rent = 5,000, Admin = 500
  try {
    const cheque: Cheque = { id: "CHQ-2", amount: 5500 } as Cheque;
    const allocations: PaymentAllocation[] = [
      { id: "A1", chequeId: "CHQ-2", targetType: "RENT", targetId: "lease-1", allocatedAmount: 5000, status: "ACTIVE" } as PaymentAllocation,
      { id: "A2", chequeId: "CHQ-2", targetType: "ADMINISTRATIVE_FEE", targetId: "office", allocatedAmount: 500, status: "ACTIVE" } as PaymentAllocation
    ];
    const allocs = calculateChequeAllocations(cheque, allocations);
    addResult("Test 2: Rent + Admin (Cheque)", allocs.rent === 5000 && allocs.admin === 500 && allocs.municipality === 0);
  } catch (e) { addResult("Test 2", false); }

  // Test 3: Cheque = 6,000, Rent = 5,000, Admin = 500, Municipality = 500
  try {
    const cheque: Cheque = { id: "CHQ-3", amount: 6000 } as Cheque;
    const allocations: PaymentAllocation[] = [
      { id: "A1", chequeId: "CHQ-3", targetType: "RENT", targetId: "lease-1", allocatedAmount: 5000, status: "ACTIVE" } as PaymentAllocation,
      { id: "A2", chequeId: "CHQ-3", targetType: "ADMINISTRATIVE_FEE", targetId: "office", allocatedAmount: 500, status: "ACTIVE" } as PaymentAllocation,
      { id: "A3", chequeId: "CHQ-3", targetType: "MUNICIPALITY_FEE", targetId: "muni", allocatedAmount: 500, status: "ACTIVE" } as PaymentAllocation
    ];
    const allocs = calculateChequeAllocations(cheque, allocations);
    addResult("Test 3: Rent + Admin + Municipality (Cheque)", allocs.rent === 5000 && allocs.admin === 500 && allocs.municipality === 500);
  } catch (e) { addResult("Test 3", false); }

  // Test 4: Allocation mismatch (sum < transaction amount, exact match required)
  try {
    const isValid = validatePaymentAllocations(6000, [{ targetType: "RENT", targetId: "x", allocatedAmount: 5500 }], true).isValid;
    addResult("Test 4: Allocation mismatch (Reject)", isValid === false);
  } catch (e) { addResult("Test 4", false); }

  // Test 5: Over allocation (sum > transaction amount)
  try {
    const isValid = validatePaymentAllocations(6000, [{ targetType: "RENT", targetId: "x", allocatedAmount: 6500 }]).isValid;
    addResult("Test 5: Over allocation (Reject)", isValid === false);
  } catch (e) { addResult("Test 5", false); }

  // Test 6: computeOwnerPayableDetails avoids leakage
  try {
    const collections = [
      { id: "col-1", ownerId: "owner-1", amountEntered: 6000 } as CollectionRecord
    ];
    const paymentAllocations: PaymentAllocation[] = [
      { id: "A1", collectionId: "col-1", targetType: "RENT", targetId: "lease-1", allocatedAmount: 5000, status: "ACTIVE" } as PaymentAllocation,
      { id: "A2", collectionId: "col-1", targetType: "ADMINISTRATIVE_FEE", targetId: "office", allocatedAmount: 500, status: "ACTIVE" } as PaymentAllocation,
      { id: "A3", collectionId: "col-1", targetType: "MUNICIPALITY_FEE", targetId: "muni", allocatedAmount: 500, status: "ACTIVE" } as PaymentAllocation
    ];
    const payable = computeOwnerPayableDetails("owner-1", {
      collections,
      commissions: [],
      expenses: [],
      transfers: [],
      adjustments: [],
      reversals: [],
      paymentAllocations
    });
    addResult("Test 6: Owner Payable Avoids Leakage", payable.totalRentCollected === 5000);
  } catch (e) { addResult("Test 6", false); }

  return results;
}
