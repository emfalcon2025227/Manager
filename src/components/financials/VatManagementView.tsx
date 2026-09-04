import React, { useState } from "react";
import { 
  Percent, 
  Plus, 
  Calendar, 
  CheckCircle2, 
  AlertCircle, 
  History, 
  Trash2, 
  Edit3,
  Search,
  Filter
} from "lucide-react";
import { useData } from "../../context/DataContext";
import { useLanguage } from "../../context/LanguageContext";
import { useAuth } from "../../context/AuthContext";
import { VatRateRecord, VatRateStatus, VatRateCategory } from "../../types";
import { motion, AnimatePresence } from "motion/react";

export const VatManagementView: React.FC = () => {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { vatRates = [], addVatRate, updateVatRate, deleteVatRate } = useData();
  const { hasPermission } = useAuth();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newRate, setNewRate] = useState<number>(5.0);
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split("T")[0]);
  const [category, setCategory] = useState<VatRateCategory>("ADMIN_FEE");
  const [error, setError] = useState("");

  const sortedRates = [...vatRates].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

  const handleAdd = () => {
    if (!hasPermission("MANAGE_VAT_CONFIG") && !hasPermission("MANAGE_CHART_OF_ACCOUNTS")) {
      setError(isAr ? "ليس لديك صلاحية لإدارة إعدادات ضريبة القيمة المضافة" : "You don't have permission to manage VAT config");
      return;
    }

    const result = addVatRate({
      rate: newRate,
      effectiveFrom,
      category,
      status: "ACTIVE"
    });

    if (result.success) {
      setIsAddModalOpen(false);
      setNewRate(5.0);
      setEffectiveFrom(new Date().toISOString().split("T")[0]);
      setError("");
    } else {
      setError(result.error || "Error adding VAT rate");
    }
  };

  const toggleStatus = (id: string, currentStatus: VatRateStatus) => {
    const newStatus: VatRateStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    updateVatRate(id, { status: newStatus }, `Changed status to ${newStatus}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Percent className="w-6 h-6 text-indigo-600" />
            {isAr ? "إدارة ضريبة القيمة المضافة" : "VAT Management"}
          </h2>
          <p className="text-slate-500 mt-1">
            {isAr 
              ? "تكوين معدلات ضريبة القيمة المضافة التاريخية والمستقبلية" 
              : "Configure historical and future VAT rates"}
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors font-medium shadow-sm"
        >
          <Plus className="w-5 h-5" />
          {isAr ? "إضافة معدل ضريبة جديد" : "Add New VAT Rate"}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right dir-rtl">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-sm">
              <tr>
                <th className={`px-6 py-4 ${isAr ? "text-right" : "text-left"}`}>
                  {isAr ? "المعدل (%)" : "Rate (%)"}
                </th>
                <th className={`px-6 py-4 ${isAr ? "text-right" : "text-left"}`}>
                  {isAr ? "يسري من تاريخ" : "Effective From"}
                </th>
                <th className={`px-6 py-4 ${isAr ? "text-right" : "text-left"}`}>
                  {isAr ? "الفئة" : "Category"}
                </th>
                <th className={`px-6 py-4 ${isAr ? "text-right" : "text-left"}`}>
                  {isAr ? "الحالة" : "Status"}
                </th>
                <th className={`px-6 py-4 ${isAr ? "text-right" : "text-left"}`}>
                  {isAr ? "تاريخ الإنشاء" : "Created At"}
                </th>
                <th className={`px-6 py-4 ${isAr ? "text-right" : "text-left"}`}>
                  {isAr ? "الإجراءات" : "Actions"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRates.map((record) => (
                <tr key={record.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className={`px-6 py-4 font-bold text-indigo-600 ${isAr ? "text-right text-lg" : "text-left text-lg"}`}>
                    {record.rate}%
                  </td>
                  <td className={`px-6 py-4 text-slate-700 font-medium ${isAr ? "text-right" : "text-left"}`}>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-slate-400" />
                      {record.effectiveFrom}
                    </div>
                  </td>
                  <td className={`px-6 py-4 ${isAr ? "text-right" : "text-left"}`}>
                    <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-xs font-semibold">
                      {record.category === "ADMIN_FEE" 
                        ? (isAr ? "الرسوم الإدارية" : "Administrative Fee")
                        : record.category}
                    </span>
                  </td>
                  <td className={`px-6 py-4 ${isAr ? "text-right" : "text-left"}`}>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                      record.status === "ACTIVE" 
                        ? "bg-emerald-100 text-emerald-700" 
                        : "bg-slate-100 text-slate-600"
                    }`}>
                      {record.status === "ACTIVE" 
                        ? (isAr ? "نشط" : "Active") 
                        : (isAr ? "غير نشط" : "Inactive")}
                    </span>
                  </td>
                  <td className={`px-6 py-4 text-slate-500 text-sm ${isAr ? "text-right" : "text-left"}`}>
                    {new Date(record.createdAt).toLocaleDateString(isAr ? 'ar-AE' : 'en-GB')}
                  </td>
                  <td className={`px-6 py-4 ${isAr ? "text-right" : "text-left"}`}>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleStatus(record.id, record.status)}
                        className={`p-2 rounded-lg transition-colors ${
                          record.status === "ACTIVE" 
                            ? "hover:bg-amber-50 text-amber-600" 
                            : "hover:bg-emerald-50 text-emerald-600"
                        }`}
                        title={record.status === "ACTIVE" ? (isAr ? "إيقاف" : "Deactivate") : (isAr ? "تفعيل" : "Activate")}
                      >
                        <History className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          const result = deleteVatRate(record.id);
                          if (!result.success) alert(result.error);
                        }}
                        className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title={isAr ? "حذف" : "Delete"}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add VAT Rate Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 overflow-hidden"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <Percent className="w-5 h-5 text-indigo-600" />
                  {isAr ? "إضافة معدل ضريبة جديد" : "Add New VAT Rate"}
                </h3>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-100 text-rose-600 rounded-lg flex items-center gap-2 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    {isAr ? "معدل الضريبة (%)" : "VAT Rate (%)"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={newRate}
                    onChange={(e) => setNewRate(parseFloat(e.target.value))}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    placeholder="5.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    {isAr ? "تاريخ السريان" : "Effective From"}
                  </label>
                  <input
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    {isAr ? "الفئة" : "Category"}
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as VatRateCategory)}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  >
                    <option value="ADMIN_FEE">{isAr ? "الرسوم الإدارية" : "Administrative Fee"}</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  onClick={handleAdd}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl transition-all shadow-md shadow-indigo-200 active:scale-[0.98]"
                >
                  {isAr ? "حفظ" : "Save"}
                </button>
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2.5 rounded-xl transition-all active:scale-[0.98]"
                >
                  {isAr ? "إلغاء" : "Cancel"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
