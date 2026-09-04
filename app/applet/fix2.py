with open("src/components/master/LeaseEditorModal.tsx", "r", encoding="utf-8") as f:
    text = f.read()

# Locate where tenantAdminFeeExempt && ( starts after tenantFeeEnabled block
idx = text.find("{tenantAdminFeeExempt && (", text.find("{tenantFeeEnabled && (() => {"))
if idx == -1:
    print("Could not find tenantAdminFeeExempt block")
else:
    # Find where Collection Toggle starts around line 2811
    coll_idx = text.find("{/* Collection Toggle & Fields */}", idx)
    print("idx:", idx, "coll_idx:", coll_idx)

    clean_exemption_block = """{/* EXEMPTION UI */}
                               {tenantAdminFeeExempt && (
                                 <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg space-y-2 animate-in fade-in zoom-in-95 duration-200">
                                   <div className="flex items-center justify-between">
                                     <span className="text-[10px] font-black text-amber-800 uppercase tracking-tight">{language === "ar" ? "تفاصيل الإعفاء" : "Exemption Details"}</span>
                                     <div className="flex items-center gap-1.5">
                                       <input
                                         type="checkbox"
                                         id="tenant-exemption-approved-tab4"
                                         disabled={!canApproveExemption}
                                         checked={tenantAdminFeeApproved}
                                         onChange={(e) => setTenantAdminFeeApproved(e.target.checked)}
                                         className="w-3 h-3 rounded text-amber-600 border-amber-300"
                                       />
                                       <label htmlFor="tenant-exemption-approved-tab4" className="text-[9px] font-bold text-amber-900 cursor-pointer">{language === "ar" ? "اعتماد" : "Approve"}</label>
                                     </div>
                                   </div>
                                   <select
                                     value={tenantAdminFeeExemptionReason}
                                     onChange={(e) => setTenantAdminFeeExemptReason(e.target.value as any)}
                                     className="w-full px-2 py-1 text-[10px] bg-white border border-amber-200 rounded font-bold outline-none"
                                   >
                                     <option value="MANAGEMENT_DECISION">{language === "ar" ? "قرار إداري" : "Management Decision"}</option>
                                     <option value="SPECIAL_CONTRACT_AGREEMENT">{language === "ar" ? "اتفاقية خاصة" : "Special Agreement"}</option>
                                     <option value="PROMOTIONAL_EXEMPTION">{language === "ar" ? "إعفاء ترويجي" : "Promotional"}</option>
                                     <option value="RENEWAL_INCENTIVE">{language === "ar" ? "حافز تجديد" : "Renewal Incentive"}</option>
                                     <option value="OTHER">{language === "ar" ? "أسباب أخرى" : "Other Reasons"}</option>
                                   </select>
                                   <textarea
                                     value={tenantAdminFeeExemptionNote}
                                     onChange={(e) => setTenantAdminFeeExemptNote(e.target.value)}
                                     rows={2}
                                     className="w-full px-2 py-1.5 text-[10px] bg-white border border-amber-200 rounded font-bold outline-none resize-none"
                                     placeholder={language === "ar" ? "تفاصيل الإعفاء..." : "Exemption details..."}
                                   />
                                 </div>
                               )}

                               {/* Exemption Toggle */}
                               <div className="p-2.5 bg-amber-50/50 rounded-lg border border-amber-200/60 flex items-center justify-between">
                                 <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                                   <ShieldCheck className="w-4 h-4 text-amber-600" />
                                   <span>{language === "ar" ? "إعفاء من الرسوم" : "Exempt from Fees"}</span>
                                 </div>
                                 <label className="relative inline-flex items-center cursor-pointer">
                                   <input
                                     type="checkbox"
                                     checked={tenantAdminFeeExempt}
                                     onChange={(e) => setTenantAdminFeeExempt(e.target.checked)}
                                     className="sr-only peer"
                                   />
                                   <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                                 </label>
                               </div>

                               """

    updated = text[:idx] + clean_exemption_block + text[coll_idx:]
    with open("src/components/master/LeaseEditorModal.tsx", "w", encoding="utf-8") as f:
        f.write(updated)
    print("Successfully fixed tenant exemption block!")
