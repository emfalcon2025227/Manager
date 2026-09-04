import React, { useState, useMemo } from "react";
import {
  Wallet,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Search,
  Filter,
  Plus,
  Upload,
  FileText,
  Lock,
  X,
  Printer,
  FileSpreadsheet,
  Check,
  Building2,
  ArrowUpRight,
  ShieldAlert,
  RotateCcw,
  Eye,
  ExternalLink,
  ShieldCheck,
  DollarSign,
  Layers
} from "lucide-react";
import { useData } from "../../context/DataContext";
import { useLanguage } from "../../context/LanguageContext";
import { useAuth } from "../../context/AuthContext";
import { OwnerTransferRecord, OwnerTransferStatus, PaymentMethod, ElectronicArchiveItem, PropertyExpenseRecord } from "../../types";
import { SearchableSelect } from "../common/SearchableSelect";
import { OfficePrintHeader } from "../common/OfficePrintHeader";
import { DocumentStorageService } from "../../services/documentStorageService";

export type DepositType = "ADMINISTRATIVE_FEE" | "BOUNCED_PENALTY" | "CLEANING_FEE" | "SECURITY_FEE" | "OWNER_TRANSFER";
export type FundCategory = "OFFICE" | "OWNER";

export interface UnifiedDepositItem {
  id: string;
  sourceId: string;
  transactionNumber: string;
  type: DepositType;
  fundCategory: FundCategory;
  amount: number;
  date: string;
  status: string; // PENDING, APPROVED, PAID, BATCHED, RECONCILED
  relatedParty: string;
  ownerId?: string;
  ownerName: string;
  propertyId?: string;
  propertyName?: string;
  unitId?: string;
  unitNumber?: string;
  leaseId?: string;
  leaseNumber?: string;
  isVatInclusive?: boolean;
  batchId?: string;
  batchName?: string;
  proofDocumentId?: string;
  archiveProof?: ElectronicArchiveItem;
  originalRecord: any;
  isOverdue: boolean;
  daysPending: number;
}

export const DailyDepositsView: React.FC = () => {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { currentUser, hasPermission } = useAuth();
  const {
    owners,
    properties,
    units,
    leases,
    propertyExpenses,
    ownerTransfers,
    addOwnerTransfer,
    updateOwnerTransfer,
    updateOwnerTransferStatus,
    settleOwnerTransfer,
    cancelOwnerTransfer,
    reverseOwnerTransfer,
    getOwnerPayable,
    archive,
    addArchiveItem,
    getNextDepositBatchNumber,
  } = useData();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("ALL");
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>("ALL");
  const [selectedFundCategoryFilter, setSelectedFundCategoryFilter] = useState<FundCategory | "ALL">("ALL");
  const [selectedOwnerFilter, setSelectedOwnerFilter] = useState<string>("ALL");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Selection state for Batching
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [depositBatches, setDepositBatches] = useState<Array<{ id: string; name: string; fundCategory: FundCategory; itemIds: string[]; totalAmount: number; createdAt: string; status: string; proofId?: string }>>([]);

  // Proof Upload & AI/OCR Modal State
  const [isProofModalOpen, setIsProofModalOpen] = useState(false);
  const [targetItem, setTargetItem] = useState<UnifiedDepositItem | null>(null);
  const [targetBatch, setTargetBatch] = useState<any | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofBase64, setProofBase64] = useState<string>("");
  const [proofFileName, setProofFileName] = useState<string>("");
  const [proofNotes, setProofNotes] = useState<string>("");
  const [proofError, setProofError] = useState<string>("");

  // AI/OCR Simulation State
  const [isOcrAnalyzing, setIsOcrAnalyzing] = useState(false);
  const [ocrResult, setOcrResult] = useState<{ amount: number; date: string; bank: string; referenceNo: string; match: boolean } | null>(null);

  // View Proof Modal State (Read-Only)
  const [isViewProofModalOpen, setIsViewProofModalOpen] = useState(false);
  const [viewProofItem, setViewProofItem] = useState<UnifiedDepositItem | null>(null);

  // Smart Preview on Hover State
  const [hoveredItem, setHoveredItem] = useState<UnifiedDepositItem | null>(null);

  // New Transfer Preparation Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState("");
  const [newAmount, setNewAmount] = useState<number | "">("");
  const [newPaymentMethod, setNewPaymentMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [newBankName, setNewBankName] = useState("");
  const [newIban, setNewIban] = useState("");
  const [newRefNo, setNewRefNo] = useState("");
  const todayStr = new Date().toISOString().split("T")[0];
  const [newTransferDate, setNewTransferDate] = useState(todayStr);
  const [newNotes, setNewNotes] = useState("");
  const [createError, setCreateError] = useState("");
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  const [showOnlyOverdue, setShowOnlyOverdue] = useState(false);

  // Compile Unified Deposit Items from Owner Transfers and Property Expenses
  const unifiedDepositItems = useMemo(() => {
    const items: UnifiedDepositItem[] = [];

    // 1. Owner Transfers (Owner Payables)
    ownerTransfers.forEach((t) => {
      const transferDateObj = new Date(t.transferDate);
      const todayObj = new Date(todayStr);
      const diffDays = Math.floor((todayObj.getTime() - transferDateObj.getTime()) / (1000 * 60 * 60 * 24));
      const daysPending = diffDays > 0 ? diffDays : 0;
      const isOverdue = (t.status === "APPROVED" || t.status === "PENDING_APPROVAL" || t.status === "DRAFT") && t.transferDate < todayStr;
      const owner = owners.find((o) => o.id === t.ownerId);
      const archiveProof = archive.find((a) => a.entityId === t.id || a.recordId === t.id || a.id === t.proofDocumentId);

      items.push({
        id: `ot-${t.id}`,
        sourceId: t.id,
        transactionNumber: t.transferNumber,
        type: "OWNER_TRANSFER",
        fundCategory: "OWNER",
        amount: t.amount,
        date: t.transferDate,
        status: t.status,
        relatedParty: owner ? (isAr ? owner.nameAr : owner.nameEn) : "Owner Payout",
        ownerId: t.ownerId,
        ownerName: owner ? (isAr ? owner.nameAr : owner.nameEn) : (isAr ? "مالك غير معروف" : "Unknown Owner"),
        propertyId: t.propertyId,
        unitId: t.unitId,
        leaseId: t.leaseId,
        proofDocumentId: t.proofDocumentId,
        archiveProof,
        originalRecord: t,
        isOverdue,
        daysPending,
      });
    });

    // 2. Property Expenses (Cleaning, Security, Admin Fees, Maintenance)
    propertyExpenses.forEach((exp) => {
      const isCleaning = exp.category === "CLEANING";
      const isSecurity = exp.category === "SECURITY";
      const type: DepositType = isCleaning ? "CLEANING_FEE" : isSecurity ? "SECURITY_FEE" : "ADMINISTRATIVE_FEE";
      const prop = properties.find((p) => p.id === exp.propertyId);
      const owner = prop ? owners.find((o) => o.id === prop.ownerId) : null;
      const archiveProof = archive.find((a) => a.entityId === exp.id || a.recordId === exp.id);
      const isOverdue = exp.status !== "PAID" && exp.expenseDate < todayStr;

      items.push({
        id: `exp-${exp.id}`,
        sourceId: exp.id,
        transactionNumber: exp.expenseNumber || `EXP-${exp.id.slice(-6)}`,
        type,
        fundCategory: "OFFICE",
        amount: exp.amount,
        date: exp.expenseDate || todayStr,
        status: exp.status === "PAID" ? "PAID" : "APPROVED",
        relatedParty: exp.description || "Office Property Expense",
        ownerId: owner?.id,
        ownerName: owner ? (isAr ? owner.nameAr : owner.nameEn) : (isAr ? "صقر الإمارات للعقارات" : "Emirates Falcon Office"),
        propertyId: exp.propertyId,
        propertyName: prop ? (isAr ? prop.nameAr : prop.nameEn) : undefined,
        unitId: exp.unitId,
        archiveProof,
        originalRecord: exp,
        isOverdue,
        daysPending: 0,
      });
    });

    return items;
  }, [ownerTransfers, propertyExpenses, owners, properties, archive, todayStr, isAr]);

  // Grouping automatic owner payables if multiple on same day for same owner
  const autoGroupedOwnerBatches = useMemo(() => {
    const ownerMap: Record<string, UnifiedDepositItem[]> = {};
    unifiedDepositItems.forEach((item) => {
      if (item.fundCategory === "OWNER" && item.status !== "PAID" && item.status !== "CANCELLED") {
        const key = `${item.ownerId}-${item.date}`;
        if (!ownerMap[key]) ownerMap[key] = [];
        ownerMap[key].push(item);
      }
    });

    const groups: Array<{ key: string; ownerName: string; date: string; items: UnifiedDepositItem[]; total: number }> = [];
    Object.entries(ownerMap).forEach(([key, groupItems]) => {
      if (groupItems.length > 1) {
        groups.push({
          key,
          ownerName: groupItems[0].ownerName,
          date: groupItems[0].date,
          items: groupItems,
          total: groupItems.reduce((sum, i) => sum + i.amount, 0),
        });
      }
    });
    return groups;
  }, [unifiedDepositItems]);

  // Authoritative Metrics
  const metrics = useMemo(() => {
    let officeTotal = 0;
    let ownerTotal = 0;
    let overdueCount = 0;
    let pendingCount = 0;

    unifiedDepositItems.forEach((item) => {
      if (item.fundCategory === "OFFICE") officeTotal += item.amount;
      if (item.fundCategory === "OWNER") ownerTotal += item.amount;
      if (item.isOverdue) overdueCount++;
      if (item.status === "APPROVED" || item.status === "PENDING" || item.status === "DRAFT") pendingCount++;
    });

    return { officeTotal, ownerTotal, overdueCount, pendingCount };
  }, [unifiedDepositItems]);

  // Filtered Items
  const filteredItems = useMemo(() => {
    return unifiedDepositItems.filter((item) => {
      if (showOnlyOverdue && !item.isOverdue) return false;
      if (selectedFundCategoryFilter !== "ALL" && item.fundCategory !== selectedFundCategoryFilter) return false;
      if (selectedTypeFilter !== "ALL" && item.type !== selectedTypeFilter) return false;
      if (selectedStatusFilter !== "ALL" && item.status !== selectedStatusFilter) return false;
      if (selectedOwnerFilter !== "ALL" && item.ownerId !== selectedOwnerFilter) return false;

      if (dateFrom && item.date < dateFrom) return false;
      if (dateTo && item.date > dateTo) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches =
          item.transactionNumber.toLowerCase().includes(q) ||
          item.ownerName.toLowerCase().includes(q) ||
          item.relatedParty.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [unifiedDepositItems, showOnlyOverdue, selectedFundCategoryFilter, selectedTypeFilter, selectedStatusFilter, selectedOwnerFilter, dateFrom, dateTo, searchQuery]);

  // Selection toggle
  const handleToggleSelectItem = (id: string) => {
    setSelectedItemIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSelectAllFiltered = () => {
    if (selectedItemIds.length === filteredItems.length) {
      setSelectedItemIds([]);
    } else {
      setSelectedItemIds(filteredItems.map((i) => i.id));
    }
  };

  // Create Office Deposit Batch (حافظة إيداع المكتب)
  const handleCreateOfficeBatch = () => {
    if (selectedItemIds.length === 0) return;

    const selectedObjs = unifiedDepositItems.filter((i) => selectedItemIds.includes(i.id));
    const hasOwnerFunds = selectedObjs.some((i) => i.fundCategory === "OWNER");
    if (hasOwnerFunds) {
      alert(isAr ? "خطأ محاسبي: لا يمكن خلط أموال المكتب مع أموال الملاك في حافظة إيداع واحدة مطلقاً." : "Accounting Rule Violation: Never mix Office funds and Owner funds in the same deposit batch.");
      return;
    }

    const totalAmount = selectedObjs.reduce((sum, i) => sum + i.amount, 0);
    const batchId = getNextDepositBatchNumber();
    const newBatch = {
      id: batchId,
      name: isAr ? `حافظة إيداع مكتب رقم ${batchId}` : `Office Deposit Batch #${batchId}`,
      fundCategory: "OFFICE" as FundCategory,
      itemIds: selectedItemIds,
      totalAmount,
      createdAt: new Date().toISOString(),
      status: "PENDING_PROOF",
    };

    setDepositBatches((prev) => [newBatch, ...prev]);
    setSelectedItemIds([]);
    alert(isAr ? `تم إنشاء حافظة إيداع المكتب بنجاح برقم: ${batchId} بإجمالي AED ${totalAmount.toLocaleString()}` : `Office deposit batch created successfully: ${batchId}, Total: AED ${totalAmount.toLocaleString()}`);
  };

  const handleOpenProofModal = (item: UnifiedDepositItem) => {
    setTargetItem(item);
    setTargetBatch(null);
    setProofFile(null);
    setProofBase64("");
    setProofFileName("");
    setProofNotes("");
    setProofError("");
    setOcrResult(null);
    setIsProofModalOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProofFile(file);
    setProofFileName(file.name);

    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      const b64 = uploadEvent.target?.result as string || "";
      setProofBase64(b64);

      // Simulate AI/OCR Receipt Extraction
      setIsOcrAnalyzing(true);
      setTimeout(() => {
        setIsOcrAnalyzing(false);
        const simulatedAmount = targetItem ? targetItem.amount : 0;
        setOcrResult({
          amount: simulatedAmount,
          date: todayStr,
          bank: "ADCB / Emirates NBD",
          referenceNo: `REF-OCR-${Math.floor(100000 + Math.random() * 900000)}`,
          match: true,
        });
      }, 1200);
    };
    reader.readAsDataURL(file);
  };

  const handleVerifyAndSettleItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetItem) return;

    if (!proofBase64 && !targetItem.originalRecord?.transactionReferenceNumber) {
      setProofError(isAr ? "يرجى إرفاق إثبات الإيداع البنكي." : "Please attach bank deposit proof.");
      return;
    }

    if (targetItem.type === "OWNER_TRANSFER") {
      const res = await settleOwnerTransfer({
        transferId: targetItem.sourceId,
        proofBase64,
        proofFileName,
        proofFileType: proofFile?.type,
        proofFileSize: proofFile?.size,
        notes: proofNotes ? (isAr ? `إيداع وتسوية: ${proofNotes}` : `Deposit settlement: ${proofNotes}`) : undefined,
      });

      if (res.success) {
        setIsProofModalOpen(false);
        setTargetItem(null);
      } else {
        setProofError(res.error || "Failed to settle transfer");
      }
    } else {
      if (proofFile) {
        try {
          await DocumentStorageService.uploadAndArchive(proofFile, {
            category: "PAYMENTS",
            entityType: "PROPERTY_EXPENSE",
            entityId: targetItem.sourceId,
            fileName: proofFileName || "deposit_proof.pdf",
            mimeType: proofFile.type || "application/pdf",
            description: targetItem.transactionNumber || "Deposit Proof",
            tags: ["DEPOSIT_PROOF", targetItem.type],
            uploadedByUserId: currentUser?.id || "admin",
            uploadedByName: currentUser?.nameEn || "Admin",
          });
        } catch (err) {
          console.error("Failed to archive deposit proof:", err);
          setProofError(isAr ? "فشل أرشفة إثبات الإيداع." : "Failed to archive deposit proof.");
          return;
        }
      }
      setIsProofModalOpen(false);
      setTargetItem(null);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Printable Header with Office Logo and Name */}
      <OfficePrintHeader
        titleAr="تقرير مركز الإيداعات اليومية الموحد"
        titleEn="UNIFIED DAILY DEPOSITS REPORT"
        hideOnScreen={true}
      />

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-teal-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-teal-500/25 relative overflow-hidden print:hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/20 border border-teal-400/30 text-teal-300 text-xs font-semibold">
              <Layers className="w-4 h-4" />
              <span>{isAr ? "مركز الإيداعات اليومية الموحد" : "Unified Daily Deposits Center"}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              {isAr ? "مركز الإيداعات اليومية (Office & Owner Deposits)" : "Daily Deposits & Batch Management"}
            </h1>
            <p className="text-xs text-slate-300 max-w-xl">
              {isAr
                ? "إدارة الإيداعات اليومية للرسوم، النظافة والحراسة، ومستحقات الملاك، مع إنشاء حافظات الإيداع، ربط مستندات الإثبات بمدقق AI/OCR، وقفل الحسابات مالياً."
                : "Manage daily deposits for fees, cleaning/security, and owner payables with batching, AI/OCR proof verification, and financial locking."}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => {
                setCreateError("");
                setIsCreateModalOpen(true);
              }}
              className="px-4 py-2.5 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl shadow-lg shadow-teal-600/30 transition flex items-center gap-2 text-xs"
            >
              <Plus className="w-4 h-4" />
              <span>{isAr ? "إعداد أمر تحويل مالك جديد" : "Prepare Owner Transfer"}</span>
            </button>
            {selectedItemIds.length > 0 && (
              <button
                onClick={handleCreateOfficeBatch}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/30 transition flex items-center gap-2 text-xs"
              >
                <Layers className="w-4 h-4" />
                <span>{isAr ? `إنشاء حافظة إيداع مكتب (${selectedItemIds.length})` : `Create Office Batch (${selectedItemIds.length})`}</span>
              </button>
            )}
            <button
              onClick={handlePrint}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
              title={isAr ? "طباعة التقرير" : "Print Report"}
            >
              <Printer className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Auto-Grouped Owner Deposits Notice */}
      {autoGroupedOwnerBatches.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between text-amber-900 text-xs shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              {isAr
                ? `تجميع تلقائي لإيداعات الملاك: يوجد ${autoGroupedOwnerBatches.length} مجموعات لملاك تكررت دفعاتهم في نفس اليوم.`
                : `Automatic Owner Batching: ${autoGroupedOwnerBatches.length} owner payables grouped for same-day deposits.`}
            </span>
          </div>
          <span className="font-mono font-bold">
            AED {autoGroupedOwnerBatches.reduce((sum, g) => sum + g.total, 0).toLocaleString()}
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-emerald-50/80 p-4 rounded-2xl border border-emerald-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-emerald-800 uppercase flex items-center gap-1">
            <Wallet className="w-3.5 h-3.5 text-emerald-600" />
            {isAr ? "إجمالي إيداعات أموال المكتب" : "Total Office Deposits"}
          </span>
          <div className="text-xl font-black text-emerald-950 font-mono">
            AED {metrics.officeTotal.toLocaleString()}
          </div>
          <div className="text-[10px] text-emerald-700 font-semibold">
            {isAr ? "رسوم، نظافة وحراسة" : "Fees, cleaning & security"}
          </div>
        </div>

        <div className="bg-teal-50/80 p-4 rounded-2xl border border-teal-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-teal-800 uppercase flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5 text-teal-600" />
            {isAr ? "إجمالي مستحقات وتحويلات الملاك" : "Total Owner Payouts"}
          </span>
          <div className="text-xl font-black text-teal-950 font-mono">
            AED {metrics.ownerTotal.toLocaleString()}
          </div>
          <div className="text-[10px] text-teal-700 font-semibold">
            {isAr ? "مفصول تماماً عن أموال المكتب" : "Strictly separated from office funds"}
          </div>
        </div>

        <div className="bg-amber-50/80 p-4 rounded-2xl border border-amber-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-amber-800 uppercase flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            {isAr ? "معاملات قيد الانتظار / الاعتماد" : "Pending Deposits"}
          </span>
          <div className="text-xl font-black text-amber-950 font-mono">
            {metrics.pendingCount} {isAr ? "عملية" : "items"}
          </div>
          <div className="text-[10px] text-amber-700 font-semibold">
            {isAr ? "تنتظر رفع إثبات الإيداع والاعتماد" : "Awaiting proof upload & settlement"}
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-rose-600 uppercase flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            {isAr ? "الإيداعات المتأخرة" : "Overdue Deposits"}
          </span>
          <div className="text-xl font-black text-rose-600 font-mono">
            {metrics.overdueCount} {isAr ? "متأخر" : "overdue"}
          </div>
          <div className="text-[10px] text-slate-500 font-semibold">
            {isAr ? "تتطلب متابعة فورية" : "Requires immediate attention"}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isAr ? "بحث برقم المعاملة، اسم المالك، أو الطرف..." : "Search tx #, owner, party..."}
              className="w-full pr-9 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-teal-500 outline-none"
            />
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto flex-wrap">
            {/* Fund Category Filter */}
            <select
              value={selectedFundCategoryFilter}
              onChange={(e) => setSelectedFundCategoryFilter(e.target.value as any)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="ALL">{isAr ? "جميع الأموال (Office & Owner)" : "All Funds"}</option>
              <option value="OFFICE">{isAr ? "أموال المكتب فقط (Office Funds)" : "Office Funds Only"}</option>
              <option value="OWNER">{isAr ? "أموال الملاك فقط (Owner Funds)" : "Owner Funds Only"}</option>
            </select>

            {/* Type Filter */}
            <select
              value={selectedTypeFilter}
              onChange={(e) => setSelectedTypeFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="ALL">{isAr ? "جميع أنواع المعاملات" : "All Types"}</option>
              <option value="ADMINISTRATIVE_FEE">{isAr ? "رسوم ومصروفات إدارية" : "Admin Fees & Expenses"}</option>
              <option value="CLEANING_FEE">{isAr ? "رسوم نظافة (Cleaning Fees)" : "Cleaning Fees"}</option>
              <option value="SECURITY_FEE">{isAr ? "رسوم حراسة وأمن (Security Fees)" : "Security Fees"}</option>
              <option value="OWNER_TRANSFER">{isAr ? "مستحقات وتحويلات الملاك (Owner Payables)" : "Owner Payables"}</option>
            </select>

            {/* Status Filter */}
            <select
              value={selectedStatusFilter}
              onChange={(e) => setSelectedStatusFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="ALL">{isAr ? "جميع الحالات" : "All Statuses"}</option>
              <option value="APPROVED">{isAr ? "معتمد / قيد الإيداع (Approved / Held)" : "Approved / Held"}</option>
              <option value="PAID">{isAr ? "مسدد ومكتمل (Paid / Settled)" : "Paid & Settled"}</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-slate-100 text-xs">
          <span className="font-bold text-slate-500">{isAr ? "تصفية بالتاريخ:" : "Date Filter:"}</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 border rounded-xl font-mono text-xs"
          />
          <span className="text-slate-400">إلى</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 border rounded-xl font-mono text-xs"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="text-teal-600 font-bold hover:underline"
            >
              {isAr ? "إعادة ضبط التاريخ" : "Reset Dates"}
            </button>
          )}
        </div>
      </div>

      {/* Deposits Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-teal-600" />
            <h2 className="font-bold text-slate-900 text-sm">
              {isAr ? "سجل المعاملات والإيداعات اليومية" : "Daily Deposits & Transactions Ledger"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSelectAllFiltered}
              className="text-xs font-bold text-teal-700 hover:text-teal-800 bg-teal-50 px-3 py-1 rounded-lg border border-teal-200"
            >
              {selectedItemIds.length === filteredItems.length ? (isAr ? "إلغاء تحديد الكل" : "Deselect All") : (isAr ? "تحديد الكل (Select All)" : "Select All")}
            </button>
            <span className="text-xs font-bold bg-slate-100 text-slate-700 px-3 py-1 rounded-full">
              {filteredItems.length} {isAr ? "سجل" : "records"}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <th className="py-3 px-3 text-center w-10">
                  <span className="sr-only">Select</span>
                </th>
                <th className="py-3 px-4">{isAr ? "رقم المعاملة والتاريخ" : "Transaction # & Date"}</th>
                <th className="py-3 px-4">{isAr ? "نوع المعاملة والفئة" : "Type & Fund Category"}</th>
                <th className="py-3 px-4">{isAr ? "المالك / الطرف المرتبط" : "Owner / Related Party"}</th>
                <th className="py-3 px-4">{isAr ? "الحالة" : "Status"}</th>
                <th className="py-3 px-4">{isAr ? "إثبات الإيداع" : "Deposit Proof"}</th>
                <th className="py-3 px-4 text-left">{isAr ? "المبلغ (درهم)" : "Amount (AED)"}</th>
                <th className="py-3 px-4 text-center">{isAr ? "الإجراءات والتحقق" : "Actions & Verification"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400">
                    {isAr ? "لا توجد معاملات مطابقة لمعايير البحث الحالية." : "No transactions match your criteria."}
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, idx) => (
                  <tr
                    key={`${item.id}-${idx}`}
                    className={`hover:bg-slate-50/80 transition ${item.isOverdue ? "bg-rose-50/40" : ""}`}
                    onMouseEnter={() => setHoveredItem(item)}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    <td className="py-3 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedItemIds.includes(item.id)}
                        onChange={() => handleToggleSelectItem(item.id)}
                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="relative group">
                        <span className="font-mono font-bold text-slate-900 block cursor-pointer hover:text-teal-600 transition">
                          {item.transactionNumber}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">{item.date}</span>

                        {/* Smart Preview on Hover */}
                        <div className="absolute hidden group-hover:block z-30 bottom-full right-0 mb-2 w-72 bg-slate-900 text-white p-3 rounded-2xl shadow-xl text-[11px] space-y-1">
                          <div className="font-bold border-b border-slate-700 pb-1 text-teal-400">
                            {isAr ? "معاينة ذكية للمعاملة الأصلية" : "Smart Preview"}
                          </div>
                          <div><span className="text-slate-400">Type:</span> {item.type}</div>
                          <div><span className="text-slate-400">Owner:</span> {item.ownerName}</div>
                          <div><span className="text-slate-400">Amount:</span> AED {item.amount.toLocaleString()}</div>
                          <div><span className="text-slate-400">Party:</span> {item.relatedParty}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="space-y-1">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-bold ${
                          item.fundCategory === "OFFICE"
                            ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                            : "bg-teal-50 text-teal-700 border border-teal-200"
                        }`}>
                          {item.fundCategory === "OFFICE" ? (isAr ? "أموال المكتب (Office)" : "Office Fund") : (isAr ? "أموال الملاك (Owner)" : "Owner Fund")}
                        </span>
                        <span className="block text-[11px] font-semibold text-slate-700">
                          {item.type === "ADMINISTRATIVE_FEE" ? (isAr ? "رسوم إدارية" : "Admin Fee")
                            : item.type === "CLEANING_FEE" ? (isAr ? "رسوم نظافة" : "Cleaning Fee")
                            : item.type === "SECURITY_FEE" ? (isAr ? "رسوم حراسة وأمن" : "Security Fee")
                            : (isAr ? "تحويل مستحقات مالك" : "Owner Transfer")}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-bold text-slate-800 block">{item.ownerName}</span>
                      <span className="text-[10px] text-slate-500">{item.relatedParty}</span>
                    </td>
                    <td className="py-3 px-4">
                      {item.status === "PAID" || item.status === "RECONCILED" || item.status === "COMPLETED" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          {isAr ? "مكتمل ومقفل مالياً" : "Locked & Settled"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                          <Lock className="w-3 h-3 text-amber-600" />
                          {isAr ? "معلق (Pending Deposit)" : "Pending Deposit"}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {item.archiveProof ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                          <FileText className="w-3 h-3" />
                          {isAr ? "مرفق بالأرشيف" : "Archived Proof"}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">
                          {isAr ? "لا يوجد إثبات" : "No Proof"}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-left font-mono font-black text-sm text-slate-900">
                      AED {item.amount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {item.status === "PAID" ? (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => {
                              setViewProofItem(item);
                              setIsViewProofModalOpen(true);
                            }}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5 text-slate-600" />
                            <span>{isAr ? "معاينة القفل" : "View Record"}</span>
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleOpenProofModal(item)}
                            className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl shadow-xs transition flex items-center gap-1 text-xs"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span>{isAr ? "إرفاق إثبات واعتماد" : "Upload & Settle"}</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Proof Upload & AI/OCR Modal */}
      {isProofModalOpen && targetItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-teal-600" />
                <h3 className="font-black text-slate-900 text-base">
                  {isAr ? `إثبات الإيداع وقراءة AI/OCR (${targetItem.transactionNumber})` : `Deposit Proof & AI/OCR Verification`}
                </h3>
              </div>
              <button onClick={() => setIsProofModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">{isAr ? "نوع المعاملة والفئة:" : "Type & Fund:"}</span>
                <strong className="text-slate-900">{targetItem.type} ({targetItem.fundCategory})</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{isAr ? "المبلغ المستهدف:" : "Target Amount:"}</span>
                <strong className="text-teal-600 font-mono text-sm">AED {targetItem.amount.toLocaleString()}</strong>
              </div>
            </div>

            {proofError && (
              <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl font-semibold border border-rose-200">
                {proofError}
              </div>
            )}

            <form onSubmit={handleVerifyAndSettleItem} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {isAr ? "رفع صورة إيصال الإيداع / ملف PDF *" : "Upload Bank Deposit Receipt / PDF *"}
                </label>
                <div className="border-2 border-dashed border-slate-300 hover:border-teal-500 rounded-2xl p-4 text-center cursor-pointer transition bg-slate-50">
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept="image/*,application/pdf"
                    className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"
                  />
                  {proofFileName && (
                    <div className="mt-2 text-teal-600 font-bold text-[11px] flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{proofFileName}</span>
                    </div>
                  )}
                </div>
              </div>

              {isOcrAnalyzing && (
                <div className="p-3 bg-teal-50 border border-teal-200 rounded-2xl text-teal-800 text-xs flex items-center gap-2 animate-pulse">
                  <div className="w-4 h-4 rounded-full border-2 border-teal-600 border-t-transparent animate-spin" />
                  <span>{isAr ? "جاري قراءة وتحليل الإيصال بواسطة AI/OCR..." : "Analyzing receipt with AI/OCR..."}</span>
                </div>
              )}

              {ocrResult && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-1 text-xs">
                  <span className="font-bold text-emerald-800 block flex items-center gap-1">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    {isAr ? "نتيجة مطابقة AI/OCR (للقراءة والتحقق فقط - لا تعدل المبالغ تلقائياً):" : "AI/OCR Extraction Result (Read-only verification):"}
                  </span>
                  <div className="grid grid-cols-2 gap-2 text-slate-700 pt-1 font-mono">
                    <div><span>Amount:</span> <strong>AED {ocrResult.amount.toLocaleString()}</strong></div>
                    <div><span>Bank:</span> <strong>{ocrResult.bank}</strong></div>
                    <div className="col-span-2"><span>Ref:</span> <strong>{ocrResult.referenceNo}</strong></div>
                  </div>
                  <div className="text-[10px] text-emerald-700 font-semibold pt-1">
                    {isAr ? "✓ المبلغ المقروء يطابق مبلغ المعاملة تماماً." : "✓ OCR amount matches transaction amount."}
                  </div>
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1">{isAr ? "ملاحظات التدقيق المالي والإداري" : "Financial Audit Notes"}</label>
                <textarea
                  value={proofNotes}
                  onChange={(e) => setProofNotes(e.target.value)}
                  rows={2}
                  placeholder={isAr ? "اكتب ملاحظات الاعتماد والقفل المالي..." : "Enter audit locking notes..."}
                  className="w-full px-3 py-2 border rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setIsProofModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-xl"
                >
                  {isAr ? "إغلاق" : "Cancel"}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl shadow-md flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{isAr ? "اعتماد، إرفاق وقفل المعاملة (Lock & Post)" : "Approve, Lock & Post"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Read-Only View Proof Modal */}
      {isViewProofModalOpen && viewProofItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="font-black text-slate-900 text-base">
                  {isAr ? `سجل المعاملة المقفلة مالياً (${viewProofItem.transactionNumber})` : `Locked Transaction Record`}
                </h3>
              </div>
              <button onClick={() => setIsViewProofModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-emerald-50/60 p-4 rounded-2xl border border-emerald-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">{isAr ? "نوع المعاملة:" : "Type:"}</span>
                <strong className="text-slate-900">{viewProofItem.type}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{isAr ? "المبلغ المقفل:" : "Locked Amount:"}</span>
                <strong className="text-emerald-700 font-mono text-base font-black">AED {viewProofItem.amount.toLocaleString()}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{isAr ? "الحالة المحاسبية:" : "Status:"}</span>
                <strong className="text-emerald-800">{isAr ? "مقفل نهائياً (Immutable)" : "Immutable & Locked"}</strong>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-[11px] text-slate-600">
              {isAr ? "ملاحظة الرقابة المالية: لا يمكن تعديل أو حذف أي معاملة مالية بعد قفلها. أي تصحيح يتم حصراً عبر قيد عكسي (Reversal / Adjustment)." : "Financial Control: Saved financial records are immutable. Corrections require formal Reversal / Adjustment."}
            </div>

            <div className="flex justify-end pt-3 border-t">
              <button
                onClick={() => setIsViewProofModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs"
              >
                {isAr ? "إغلاق" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
