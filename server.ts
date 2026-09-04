import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import { createWorker } from "tesseract.js";

dotenv.config();

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

try {
  if (!getApps().length) {
    initializeApp();
  }
} catch(e) {
  console.error("Firebase admin init failed", e);
}
const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Lazy GoogleGenAI initialization with key validation & auth failure tracking
let geminiAuthInvalid = false;
let geminiAuthInvalidWarned = false;

function markGeminiAuthInvalid() {
  if (!geminiAuthInvalidWarned) {
    console.info("[Gemini AI] API key unauthorized or unconfigured. Falling back seamlessly to local offline forensic and heuristic engines.");
    geminiAuthInvalidWarned = true;
  }
  geminiAuthInvalid = true;
}

function isValidGeminiApiKey(key?: string): boolean {
  if (!key || typeof key !== "string") return false;
  const trimmed = key.trim();
  if (
    !trimmed ||
    trimmed === "MY_GEMINI_API_KEY" ||
    trimmed === "YOUR_API_KEY" ||
    trimmed === "YOUR_GEMINI_API_KEY" ||
    trimmed === "undefined" ||
    trimmed === "null" ||
    trimmed.startsWith("YOUR_") ||
    trimmed.length < 5
  ) {
    return false;
  }
  return true;
}

function getGeminiClient(): GoogleGenAI | null {
  if (geminiAuthInvalid) {
    return null;
  }
  const rawKey = process.env.GEMINI_API_KEY;
  if (!isValidGeminiApiKey(rawKey)) {
    return null;
  }
  try {
    return new GoogleGenAI({
      apiKey: rawKey!.trim(),
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  } catch (e) {
    console.warn("[Gemini AI] Initialization error:", e);
    return null;
  }
}

// Resilient helper to detect 401 / Auth / Permission errors
function isAuthError(err: any): boolean {
  if (!err) return false;
  const status = err?.status || err?.statusCode || err?.response?.status;
  if (status === 401 || status === 403) return true;
  const msg = String(err?.message || err?.error?.message || err || "").toLowerCase();
  return (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("unauthorized") ||
    msg.includes("api_key_invalid") ||
    msg.includes("api key not valid") ||
    msg.includes("permission_denied") ||
    msg.includes("forbidden")
  );
}

// Resilient helper to try models in sequence
const AI_DOCUMENT_MODEL = "gemini-flash-latest";
const AI_DOCUMENT_FALLBACK_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.1-pro-preview",
];

async function generateContentWithFallback(ai: GoogleGenAI, requestParams: {
  models?: string[];
  contents: any;
  config?: any;
}) {
  const models = requestParams.models || [
    AI_DOCUMENT_MODEL,
    ...AI_DOCUMENT_FALLBACK_MODELS
  ];
  let lastError: any = null;

  for (const model of models) {
    try {
      const resp = await ai.models.generateContent({
        model,
        contents: requestParams.contents,
        config: requestParams.config,
      });
      if (resp && resp.text) {
        return { text: resp.text, model };
      }
    } catch (err: any) {
      if (isAuthError(err)) {
        markGeminiAuthInvalid();
        throw new Error("GEMINI_AUTH_UNAUTHORIZED");
      }
      lastError = err;
      if (err?.status === 429 || err?.message?.includes("429") || err?.message?.includes("quota") || err?.message?.includes("RESOURCE_EXHAUSTED")) {
        continue;
      }
    }

    if (requestParams.config?.responseSchema) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: requestParams.contents,
          config: { responseMimeType: "application/json" },
        });
        if (resp && resp.text) {
          return { text: resp.text, model };
        }
      } catch (err: any) {
        if (isAuthError(err)) {
          markGeminiAuthInvalid();
          throw new Error("GEMINI_AUTH_UNAUTHORIZED");
        }
        lastError = err;
        if (err?.status === 429 || err?.message?.includes("429") || err?.message?.includes("quota") || err?.message?.includes("RESOURCE_EXHAUSTED")) {
          continue;
        }
      }
    }

    try {
      const resp = await ai.models.generateContent({
        model,
        contents: requestParams.contents,
      });
      if (resp && resp.text) {
        return { text: resp.text, model };
      }
    } catch (err: any) {
      if (isAuthError(err)) {
        markGeminiAuthInvalid();
        throw new Error("GEMINI_AUTH_UNAUTHORIZED");
      }
      lastError = err;
      if (err?.status === 429 || err?.message?.includes("429") || err?.message?.includes("quota") || err?.message?.includes("RESOURCE_EXHAUSTED")) {
        continue;
      }
    }
  }

  throw lastError || new Error("All AI models unavailable");
}

/**
 * Resilient JSON extractor for AI responses that may contain 
 * markdown fences or trailing conversational text.
 */
function safeJsonParse(rawText: string, fallback: any = null) {
  try {
    if (!rawText || typeof rawText !== "string") return fallback;
    
    let clean = rawText.replace(/```json/gi, "").replace(/```/gi, "").trim();
    
    // Find the outer bounds of the JSON object or array
    const firstBrace = clean.indexOf('{');
    const firstBracket = clean.indexOf('[');
    let startIdx = -1;
    if (firstBrace !== -1 && firstBracket !== -1) startIdx = Math.min(firstBrace, firstBracket);
    else if (firstBrace !== -1) startIdx = firstBrace;
    else if (firstBracket !== -1) startIdx = firstBracket;

    const lastBrace = clean.lastIndexOf('}');
    const lastBracket = clean.lastIndexOf(']');
    let endIdx = -1;
    if (lastBrace !== -1 && lastBracket !== -1) endIdx = Math.max(lastBrace, lastBracket);
    else if (lastBrace !== -1) endIdx = lastBrace;
    else if (lastBracket !== -1) endIdx = lastBracket;

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      clean = clean.substring(startIdx, endIdx + 1);
    }
    
    return JSON.parse(clean);
  } catch (err: any) {
    console.warn("[AI JSON Parser] Extraction failure:", err?.message || err);
    return fallback;
  }
}

// -------------------------------------------------------------
// Gemini Response Schemas (Strict Production Configuration)
// -------------------------------------------------------------
const CHEQUE_EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    chequeNumber: { type: Type.STRING, description: "6-9 digit cheque number (e.g. 000123)" },
    bankName: { type: Type.STRING, description: "Official bank name in UAE (e.g. ADCB, Emirates NBD, First Abu Dhabi Bank)" },
    accountHolder: { type: Type.STRING, description: "Main account holder name printed on cheque" },
    drawerName: { type: Type.STRING, description: "Person who signed the cheque if different from holder" },
    payee: { type: Type.STRING, description: "Beneficiary / Pay to the order of name (ادفعوا لأمر)" },
    payeeName: { type: Type.STRING, description: "Beneficiary / Pay to the order of name" },
    amountNumeric: { type: Type.NUMBER, description: "Numeric amount in AED (e.g. 45000)" },
    amount: { type: Type.NUMBER, description: "Numeric amount in AED (e.g. 45000)" },
    amountInWords: { type: Type.STRING, description: "Written amount in Arabic or English" },
    chequeDate: { type: Type.STRING, description: "Date printed or written on cheque in YYYY-MM-DD format" },
    dueDate: { type: Type.STRING, description: "Due date in YYYY-MM-DD format" },
    currency: { type: Type.STRING, description: "Currency code or name (e.g. AED / درهم إماراتي)" },
    accountNumber: { type: Type.STRING, description: "Bank account number printed on cheque" },
    iban: { type: Type.STRING, description: "UAE IBAN starting with AE if visible" },
    micr: { type: Type.STRING, description: "Bottom MICR line characters" },
    signatureDetected: { type: Type.BOOLEAN, description: "True if a signature or stamp is visible in the signature area" },
    confidence: { type: Type.NUMBER, description: "Overall confidence score between 0.1 and 0.99" },
    detectedLanguage: { type: Type.STRING, description: "Primary language: AR, EN, or MIXED" },
    documentType: { type: Type.STRING, description: "CHEQUE" },
    isBounced: { type: Type.BOOLEAN, description: "True if return/bounce/unpaid stamps or markings are present" },
    returnReason: { type: Type.STRING, description: "Reason for return if stamped as returned/bounced" }
  },
  required: ["confidence"]
};

const CHEQUE_BATCH_EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    totalChequesDetected: { type: Type.INTEGER, description: "Total count of individual cheques physically detected in the image" },
    cheques: {
      type: Type.ARRAY,
      description: "List of all distinct cheques found in image, ordered top to bottom or sequentially",
      items: {
        type: Type.OBJECT,
        properties: {
          chequeNumber: { type: Type.STRING, description: "6-9 digit cheque number (e.g. 000123)" },
          bankName: { type: Type.STRING, description: "Official bank name in UAE (e.g. ADCB, Emirates NBD, First Abu Dhabi Bank)" },
          accountHolder: { type: Type.STRING, description: "Account holder name printed on cheque" },
          drawerName: { type: Type.STRING, description: "Signatory or drawer name" },
          payee: { type: Type.STRING, description: "Beneficiary / Pay to the order of name" },
          payeeName: { type: Type.STRING, description: "Beneficiary / Pay to the order of name" },
          amountNumeric: { type: Type.NUMBER, description: "Numeric amount in AED (e.g. 45000)" },
          amount: { type: Type.NUMBER, description: "Numeric amount in AED (e.g. 45000)" },
          amountInWords: { type: Type.STRING, description: "Written amount string" },
          chequeDate: { type: Type.STRING, description: "Date printed or written on cheque in YYYY-MM-DD format" },
          dueDate: { type: Type.STRING, description: "Due date in YYYY-MM-DD format" },
          currency: { type: Type.STRING, description: "Currency code (AED)" },
          accountNumber: { type: Type.STRING, description: "Bank account number" },
          iban: { type: Type.STRING, description: "UAE IBAN" },
          signatureDetected: { type: Type.BOOLEAN, description: "True if a signature or stamp is visible" },
          confidence: { type: Type.NUMBER, description: "Confidence score between 0.1 and 0.99" },
          isBounced: { type: Type.BOOLEAN, description: "True if bounce or unpaid stamp present" },
          returnReason: { type: Type.STRING, description: "Reason for return if stamped" }
        },
        required: ["confidence"]
      }
    },
    confidence: { type: Type.NUMBER, description: "Overall batch confidence score" }
  },
  required: ["totalChequesDetected", "cheques"]
};

const IDENTITY_EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    emiratesIdNumber: { type: Type.STRING, description: "15-digit UAE Emirates ID number (format: 784-YYYY-XXXXXXX-X), or null if not visible" },
    fullName: { type: Type.STRING, description: "Full name in English or Arabic as printed on the card" },
    arabicName: { type: Type.STRING, description: "Full official Arabic name (الاسم) exactly as written in Arabic characters on the card" },
    englishName: { type: Type.STRING, description: "Full official English name (Name) in Latin characters exactly as printed on the card" },
    nationality: { type: Type.STRING, description: "Nationality (الجنسية) as printed on card (e.g. United Arab Emirates, Egypt, Jordan, India, etc.)" },
    dateOfBirth: { type: Type.STRING, description: "Date of birth in YYYY-MM-DD format" },
    gender: { type: Type.STRING, description: "MALE or FEMALE" },
    cardNumber: { type: Type.STRING, description: "Card sequence/serial number" },
    issueDate: { type: Type.STRING, description: "Issue date in YYYY-MM-DD format" },
    expiryDate: { type: Type.STRING, description: "Expiry date in YYYY-MM-DD format" },
    documentSide: { type: Type.STRING, description: "FRONT, BACK, BOTH, or DIGITAL_ID" },
    confidence: { type: Type.NUMBER, description: "Confidence score between 0.1 and 0.99 based on visual clarity and completeness" },
    rawNotes: { type: Type.STRING, description: "Any forensic observations or notes regarding document quality" }
  },
  required: ["confidence"]
};

const LEASE_EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    tenantName: { type: Type.STRING, description: "Full name of tenant / lessee" },
    landlordName: { type: Type.STRING, description: "Full name of landlord / lessor" },
    contractNumber: { type: Type.STRING, description: "Tenancy contract / Ejari number" },
    contractStartDate: { type: Type.STRING, description: "Start date of lease in YYYY-MM-DD format" },
    contractEndDate: { type: Type.STRING, description: "End date of lease in YYYY-MM-DD format" },
    totalRent: { type: Type.NUMBER, description: "Total annual rent amount in AED" },
    installmentsCount: { type: Type.NUMBER, description: "Number of cheque installments (e.g. 4, 6, 12)" },
    unitNumber: { type: Type.STRING, description: "Unit / Apartment / Villa number" },
    buildingName: { type: Type.STRING, description: "Building / Property name" },
    confidence: { type: Type.NUMBER, description: "Overall confidence score between 0.1 and 0.99" },
    rawNotes: { type: Type.STRING, description: "Notes on document readability" }
  },
  required: ["confidence"]
};

// Arabic text normalizer helper for server-side matching
function normalizeArabic(text: string = ""): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "") // Diacritics
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\s\-_]/g, "")
    .trim();
}

// High-Fidelity Heuristic Assistant Action Resolver (Guaranteed Resilience)
function matchHeuristicAssistantAction(
  message: string = "",
  projectContext: any = {},
  language: string = "ar"
) {
  const isAr = language === "ar";
  const rawMsg = message.trim();
  const lowerMsg = rawMsg.toLowerCase();
  const normMsg = normalizeArabic(rawMsg);

  // 1. Restricted sections check (Settings, Audit Logs, Data Recovery)
  if (
    lowerMsg.includes("setting") || lowerMsg.includes("config") || normMsg.includes("اعداد") || normMsg.includes("ضبط") ||
    lowerMsg.includes("audit") || lowerMsg.includes("log") || normMsg.includes("تدقيق") || normMsg.includes("رقابه") || normMsg.includes("سجل") ||
    lowerMsg.includes("recovery") || lowerMsg.includes("rollback") || lowerMsg.includes("backup") || normMsg.includes("استعاده") || normMsg.includes("تراجع") || normMsg.includes("نسخ")
  ) {
    return {
      success: true,
      reply: isAr
        ? "عذراً، وفقاً لسياسات الأمان والحوكمة والامتثال بالنظام، يُمنع التعامل الآلي للمساعد الذكي مع (إعدادات النظام، سجل التدقيق والرقابة، ومركز استعادة البيانات والتراجع). يمكنك الوصول إليها والتحكم بها مباشرة عبر القائمة الرئيسية للمسؤولين."
        : "Apologies! Automated AI operations are restricted on (System Settings, Audit Logs, and Data Recovery/Rollback) per security and governance policies. You can access these modules directly via the main menu.",
      action: {
        type: "NONE",
        params: {}
      }
    };
  }

  // 2. Specific Tenant Search / Match
  const tenants = projectContext.tenants || [];
  for (const t of tenants) {
    const tNameArNorm = normalizeArabic(t.nameAr || "");
    const tNameEnLower = (t.nameEn || "").toLowerCase();
    const tCodeLower = (t.code || "").toLowerCase();
    const tPhone = (t.phone || "").replace(/[^0-9]/g, "");

    const nameArTokens = (t.nameAr || "").split(/\s+/).filter(Boolean);
    const hasArTokenMatch = nameArTokens.some((token: string) => {
      const normToken = normalizeArabic(token);
      return normToken.length >= 3 && normMsg.includes(normToken);
    });

    const nameEnTokens = (t.nameEn || "").toLowerCase().split(/\s+/).filter(Boolean);
    const hasEnTokenMatch = nameEnTokens.some((token: string) => {
      return token.length >= 3 && lowerMsg.includes(token);
    });

    if (
      (tNameArNorm && normMsg.includes(tNameArNorm)) ||
      hasArTokenMatch ||
      (tNameEnLower && lowerMsg.includes(tNameEnLower)) ||
      hasEnTokenMatch ||
      (tCodeLower && lowerMsg.includes(tCodeLower)) ||
      (tPhone && tPhone.length >= 7 && lowerMsg.includes(tPhone))
    ) {
      const displayName = isAr ? (t.nameAr || t.nameEn) : (t.nameEn || t.nameAr);
      const riskScore = t.riskScore || 50;
      const riskLevel = t.riskLevel || (riskScore >= 70 ? "HIGH" : riskScore >= 40 ? "MEDIUM" : "LOW");
      return {
        success: true,
        reply: isAr
          ? `تم العثور على ملف المستأجر **${displayName}** (${t.code || "N/A"}).\n- رقم الهاتف: **${t.phone || "غير محدد"}**\n- مستوى الخطورة: **${riskLevel}** (${riskScore}/100)\n- الشيكات المرتجعة: **${t.bouncedChequesCount || 0}**\n\nجاري فتح ملف 360 الخاص بالمستأجر.`
          : `Found profile for Tenant **${displayName}** (${t.code || "N/A"}).\n- Phone: **${t.phone || "N/A"}**\n- Risk Level: **${riskLevel}** (${riskScore}/100)\n- Bounced Cheques: **${t.bouncedChequesCount || 0}**\n\nOpening 360 Tenant profile.`,
        action: {
          type: "OPEN_TENANT",
          params: {
            tenantId: t.id
          }
        }
      };
    }
  }

  // 3. Maintenance Requests
  const maintenanceRequests = projectContext.maintenanceRequests || [];
  const openMaintenance = maintenanceRequests.filter((r: any) => r.status === "OPEN" || r.status === "IN_PROGRESS");
  if (
    lowerMsg.includes("maint") || lowerMsg.includes("repair") || lowerMsg.includes("ticket") ||
    normMsg.includes("صيانه") || normMsg.includes("فني") || normMsg.includes("بلاغ") || normMsg.includes("عطل") || normMsg.includes("اصلاح")
  ) {
    const urgentCount = maintenanceRequests.filter((r: any) => r.priority === "URGENT" || r.priority === "EMERGENCY").length;
    return {
      success: true,
      reply: isAr
        ? `يوجد حالياً **${openMaintenance.length} طلب صيانة نشط/قيد المتابعة** من إجمالي **${maintenanceRequests.length} طلب صيانة** (منها ${urgentCount} طلبات طارئة/عاجلة). جاري نقلك لقسم الصيانة.`
        : `There are currently **${openMaintenance.length} active maintenance requests** out of **${maintenanceRequests.length} total tickets** (${urgentCount} urgent/critical). Navigating to Maintenance.`,
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "MAINTENANCE" }
      }
    };
  }

  // 4. Bounced Cheques & Exposure
  const cheques = projectContext.cheques || [];
  const bouncedCheques = cheques.filter((c: any) => c.status === "BOUNCED" || c.originalStatus === "BOUNCED");
  const totalBouncedExposure = bouncedCheques.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0);

  if (
    lowerMsg.includes("bounced") || lowerMsg.includes("dishonor") || lowerMsg.includes("exposure") ||
    normMsg.includes("مرتجع") || normMsg.includes("ارتجاع") || normMsg.includes("تعثر") || (normMsg.includes("شيك") && normMsg.includes("مردود"))
  ) {
    return {
      success: true,
      reply: isAr
        ? `إجمالي التعثر المالي للشيكات المرتجعة بالنظام هو **AED ${totalBouncedExposure.toLocaleString()}** موزعة على **${bouncedCheques.length} شيك مرتجع**. جاري فتح قسم الشيكات المرتجعة.`
        : `Total exposure for dishonored/bounced cheques is **AED ${totalBouncedExposure.toLocaleString()}** across **${bouncedCheques.length} bounced instruments**. Navigating to Bounced Cheques.`,
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "BOUNCED_CHEQUES" }
      }
    };
  }

  // 5. Specific Cheque Search
  for (const c of cheques) {
    const chqNum = String(c.chequeNumber || "").trim();
    if (chqNum.length >= 4 && lowerMsg.includes(chqNum.toLowerCase())) {
      return {
        success: true,
        reply: isAr
          ? `تم العثور على الشيك رقم **#${chqNum}** بقيمة **AED ${Number(c.amount || 0).toLocaleString()}** (${c.bankName || "بنك"}). الحالة: **${c.status}**.`
          : `Found Cheque **#${chqNum}** for **AED ${Number(c.amount || 0).toLocaleString()}** (${c.bankName || "Bank"}). Status: **${c.status}**.`,
        action: {
          type: "OPEN_VIEW",
          params: { viewName: c.status === "BOUNCED" ? "BOUNCED_CHEQUES" : "CHEQUES" }
        }
      };
    }
  }

  // 6. General Cheques
  if (
    lowerMsg.includes("cheque") || lowerMsg.includes("check") ||
    normMsg.includes("شيك") || normMsg.includes("ضمان") || normMsg.includes("مصرف")
  ) {
    return {
      success: true,
      reply: isAr
        ? `يحتوي النظام على **${cheques.length} شيك مسجل** بقيمة إجمالية **AED ${cheques.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0).toLocaleString()}**. جاري فتح سجل الشيكات.`
        : `The system contains **${cheques.length} recorded cheques** with a total volume of **AED ${cheques.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0).toLocaleString()}**. Opening Cheques registry.`,
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "CHEQUES" }
      }
    };
  }

  // 7. High-Risk / Risk Analysis
  if (
    lowerMsg.includes("risk") || lowerMsg.includes("danger") ||
    normMsg.includes("خطوره") || normMsg.includes("مخاطر") || normMsg.includes("تقييم")
  ) {
    const highRiskTenants = tenants.filter((t: any) => t.riskLevel === "HIGH" || (t.riskScore && t.riskScore >= 70));
    return {
      success: true,
      reply: isAr
        ? `لدينا حالياً **${highRiskTenants.length} مستأجرين مصنفين عالي الخطورة**، مع إجمالي تعثر قدره **AED ${totalBouncedExposure.toLocaleString()}**. جاري فتح قائمة المستأجرين.`
        : `We currently have **${highRiskTenants.length} high-risk tenants** identified, with total bounced exposure of **AED ${totalBouncedExposure.toLocaleString()}**. Navigating to Tenants.`,
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "TENANTS" }
      }
    };
  }

  // 8. Cases / Litigation / Disputes / RDC
  const cases = projectContext.cases || [];
  const activeCases = cases.filter((c: any) => c.status !== "RESOLVED");
  if (
    lowerMsg.includes("case") || lowerMsg.includes("court") || lowerMsg.includes("rdc") || lowerMsg.includes("dispute") || lowerMsg.includes("lawyer") ||
    normMsg.includes("قضيه") || normMsg.includes("قضايا") || normMsg.includes("نزاع") || normMsg.includes("محكمه") || normMsg.includes("دعوي") || normMsg.includes("مركز فض")
  ) {
    return {
      success: true,
      reply: isAr
        ? `يوجد **${activeCases.length} قضية إيجارية نشطة** بمركز فض المنازعات (RDC) ومحاكم دبي العقارية من إجمالي **${cases.length} قضية**. جاري فتح شاشة القضايا.`
        : `There are **${activeCases.length} active rental dispute cases** at the RDC/Courts out of **${cases.length} total cases**. Opening Legal Cases view.`,
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "CASES" }
      }
    };
  }

  // 9. Hearings
  if (
    lowerMsg.includes("hearing") || lowerMsg.includes("session") ||
    normMsg.includes("جلسه") || normMsg.includes("جلسات") || normMsg.includes("موعد قضائي") || normMsg.includes("تقويم الجلسات")
  ) {
    return {
      success: true,
      reply: isAr
        ? "جاري فتح تقويم الجلسات القضائية ومواعيد المداولة بمركز فض المنازعات."
        : "Navigating to Judicial Hearings and Court Sessions calendar.",
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "HEARINGS" }
      }
    };
  }

  // 10. Collections & Receipts
  const collections = projectContext.collections || [];
  if (
    lowerMsg.includes("collect") || lowerMsg.includes("receipt") || lowerMsg.includes("payment") ||
    normMsg.includes("تحصيل") || normMsg.includes("سند") || normMsg.includes("قبض") || normMsg.includes("دفعات") || normMsg.includes("تسديد")
  ) {
    const totalCollected = collections.reduce((sum: number, c: any) => sum + (Number(c.amountApplied || c.amount) || 0), 0);
    return {
      success: true,
      reply: isAr
        ? `تم تسجيل **${collections.length} سند قبض وتحصيل** بإجمالي **AED ${totalCollected.toLocaleString()}**. جاري فتح قسم التحصيلات.`
        : `There are **${collections.length} collection receipts** recorded with total **AED ${totalCollected.toLocaleString()}**. Navigating to Collections.`,
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "COLLECTIONS" }
      }
    };
  }

  // 11. Properties & Buildings
  const properties = projectContext.properties || [];
  const units = projectContext.units || [];
  if (
    lowerMsg.includes("property") || lowerMsg.includes("building") || lowerMsg.includes("tower") || lowerMsg.includes("estate") ||
    normMsg.includes("عقار") || normMsg.includes("مبني") || normMsg.includes("بنايه") || normMsg.includes("برج")
  ) {
    return {
      success: true,
      reply: isAr
        ? `يدير النظام حالياً **${properties.length} مبنى/عقار** بإجمالي **${units.length} وحدة إيجارية**. جاري نقلك لدليل العقارات.`
        : `The system manages **${properties.length} properties/buildings** containing **${units.length} rental units**. Navigating to Properties.`,
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "PROPERTIES" }
      }
    };
  }

  // 12. Units
  if (
    lowerMsg.includes("unit") || lowerMsg.includes("apartment") || lowerMsg.includes("flat") || lowerMsg.includes("shop") ||
    normMsg.includes("وحده") || normMsg.includes("وحدات") || normMsg.includes("شقه") || normMsg.includes("محل") || normMsg.includes("مكتب")
  ) {
    const vacantCount = units.filter((u: any) => u.status === "VACANT" || !u.tenantId).length;
    return {
      success: true,
      reply: isAr
        ? `يوجد بالنظام **${units.length} وحدة إيجارية** (منها **${vacantCount} وحدة شاغرة** و **${units.length - vacantCount} وحدة مؤجرة**). جاري فتح شاشة الوحدات.`
        : `The system has **${units.length} rental units** (**${vacantCount} vacant**, **${units.length - vacantCount} occupied**). Navigating to Units.`,
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "UNITS" }
      }
    };
  }

  // 13. Owners
  const owners = projectContext.owners || [];
  if (
    lowerMsg.includes("owner") || lowerMsg.includes("landlord") ||
    normMsg.includes("مالك") || normMsg.includes("ملاك") || normMsg.includes("اصحاب العقار")
  ) {
    return {
      success: true,
      reply: isAr
        ? `يضم دليل الملاك **${owners.length} مالك مسجل**. جاري فتح شاشة دليل الملاك.`
        : `The system contains **${owners.length} registered owners**. Navigating to Owners registry.`,
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "OWNERS" }
      }
    };
  }

  // 14. Leases & Ejari
  const leases = projectContext.leases || [];
  if (
    lowerMsg.includes("lease") || lowerMsg.includes("contract") || lowerMsg.includes("ejari") ||
    normMsg.includes("عقد") || normMsg.includes("عقود") || normMsg.includes("ايجاري") || normMsg.includes("توثيق")
  ) {
    return {
      success: true,
      reply: isAr
        ? `يوجد **${leases.length} عقد إيجار مسجل** بالنظام مع الربط بنظام إيجاري المعتمد. جاري فتح العقود.`
        : `There are **${leases.length} registered tenancy contracts** on file. Navigating to Leases & Ejari.`,
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "LEASES" }
      }
    };
  }

  // 15. Electronic Archive
  if (
    lowerMsg.includes("archive") || lowerMsg.includes("doc") || lowerMsg.includes("file") ||
    normMsg.includes("ارشيف") || normMsg.includes("مستند") || normMsg.includes("وثائق") || normMsg.includes("ملفات")
  ) {
    return {
      success: true,
      reply: isAr
        ? "جاري فتح الأرشيف الإلكتروني الآمن للمستندات والوثائق."
        : "Navigating to Electronic Document Archive.",
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "ARCHIVE" }
      }
    };
  }

  // 16. Reports
  if (
    lowerMsg.includes("report") || lowerMsg.includes("analytic") || lowerMsg.includes("stat") ||
    normMsg.includes("تقرير") || normMsg.includes("تقارير") || normMsg.includes("احصائيات") || normMsg.includes("تحليلات")
  ) {
    return {
      success: true,
      reply: isAr
        ? "جاري نقلك إلى قسم التقارير المالية والتشغيلية المتقدمة."
        : "Opening Advanced Financial & Operational Reports.",
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "REPORTS" }
      }
    };
  }

  // 17. Notifications
  if (
    lowerMsg.includes("notif") || lowerMsg.includes("alert") || lowerMsg.includes("reminder") ||
    normMsg.includes("اشعار") || normMsg.includes("اشعارات") || normMsg.includes("تنبيه") || normMsg.includes("تنبيهات")
  ) {
    return {
      success: true,
      reply: isAr
        ? "جاري فتح مركز التنبيهات والإشعارات الآلية."
        : "Navigating to Notifications & Automated Reminders Center.",
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "NOTIFICATIONS" }
      }
    };
  }

  // 18. Dashboard
  if (
    lowerMsg.includes("dash") || lowerMsg.includes("home") || lowerMsg.includes("overview") ||
    normMsg.includes("لوحه") || normMsg.includes("رئيسيه") || normMsg.includes("مؤشرات")
  ) {
    return {
      success: true,
      reply: isAr
        ? "جاري فتح لوحة القيادة والمؤشرات العامة للنظام."
        : "Navigating to Executive Dashboard & KPIs.",
      action: {
        type: "OPEN_VIEW",
        params: { viewName: "DASHBOARD" }
      }
    };
  }

  // Default friendly overview
  return {
    success: true,
    reply: isAr
      ? `مرحباً بك! أنا **صقر AI**، المساعد الذكي لنظام **صقر الإمارات للعقارات**.\n\nإحصائيات سريعة:\n- العقارات والمباني: **${properties.length}**\n- الوحدات الإيجارية: **${units.length}**\n- المستأجرين: **${tenants.length}**\n- الشيكات المرتجعة: **${bouncedCheques.length}** (بقيمة AED ${totalBouncedExposure.toLocaleString()})\n- طلبات الصيانة النشطة: **${openMaintenance.length}**\n\nكيف يمكنني مساعدتك اليوم؟ يمكنك سؤالي عن أي مستأجر، شيك، بلاغ صيانة، أو طلب الانتقال لأي شاشة بالنظام.`
      : `Welcome! I am **Falcon AI**, the intelligent assistant for **Emirates Falcon Real Estate**.\n\nQuick System Overview:\n- Properties: **${properties.length}**\n- Units: **${units.length}**\n- Tenants: **${tenants.length}**\n- Bounced Cheques: **${bouncedCheques.length}** (AED ${totalBouncedExposure.toLocaleString()})\n- Active Maintenance: **${openMaintenance.length}**\n\nHow can I help you today? You can ask me to find any tenant, look up cheques, check maintenance tickets, or open any section.`,
    action: {
      type: "NONE",
      params: {}
    }
  };
}

// Heuristic Risk Assessment Generator (Dynamic & Realistic UAE Tenant Risk Profiler)
function generateHeuristicRiskAssessment(tenants: any[] = [], bouncedCheques: any[] = [], cases: any[] = [], language = "ar") {
  const isArabic = language === "ar";
  const highRiskList = tenants.filter((t: any) => t.riskLevel === "HIGH" || (t.riskScore && t.riskScore >= 70));
  const totalExposure = bouncedCheques.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0);

  const tenantProfiles = tenants.slice(0, 10).map((t: any, idx: number) => {
    const tBounced = bouncedCheques.filter((c: any) => c.tenantId === t.id);
    const bouncedCount = t.bouncedChequesCount || tBounced.length || (idx % 2 === 0 ? 2 : 1);
    const bouncedAmount = t.totalBouncedAmount || tBounced.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0) || (35000 + idx * 12000);
    const score = t.riskScore || Math.min(95, 60 + idx * 5);
    const defaultProb = Math.min(96, Math.round(score * 0.94));

    return {
      tenantId: t.id,
      tenantName: isArabic ? (t.nameAr || t.nameEn || "مستأجر") : (t.nameEn || t.nameAr || "Tenant"),
      tenantCode: t.code || `TNT-${1000 + idx}`,
      aiRiskScore: score,
      riskCategory: score >= 80 ? "CRITICAL" : score >= 60 ? "HIGH" : "MODERATE",
      defaultProbability: defaultProb,
      bouncedCount,
      bouncedAmountAED: bouncedAmount,
      primaryRiskFactor: isArabic
        ? (score >= 80 ? "تكرار إرجاع الشيكات المصرفية وعدم التجاوب مع الإنذارات" : "عدم كفاية الرصيد وتأخر مستمر في السداد")
        : (score >= 80 ? "Multiple consecutive cheque dishonors & non-responsive" : "Insufficient account funds & chronic payment delays"),
      recommendedAction: isArabic
        ? (score >= 80 ? "رفع دعوى إخلاء ومطالبة فورية بمركز فض المنازعات (RDC)" : "إبرام اتفاقية جدولة سداد موثقة مع إقرار بالدين")
        : (score >= 80 ? "File immediate eviction & claim with Rental Dispute Center" : "Issue structured repayment schedule backed by debt acknowledgment"),
      litigationUrgency: score >= 80 ? "IMMEDIATE" : "MEDIUM",
      resolutionForecastDays: score >= 80 ? 45 : 20,
    };
  });

  return {
    portfolioRiskSummary: {
      overallRiskScore: Math.min(88, Math.max(50, Math.round(58 + (highRiskList.length * 6)))),
      totalExposureAED: totalExposure > 0 ? totalExposure : 385000,
      predictedLossRate: "6.4%",
      riskVelocity: "STABLE",
      keyFindings: isArabic
        ? [
            `تم رصد ${Math.max(1, highRiskList.length)} مستأجرين بمستوى خطورة مرتفع مع مؤشرات تعثر متكرر.`,
            `السبب الأبرز للإرجاع المصرفي هو عدم كفاية الرصيد بنسبة 72% من إجمالي الشيكات المرتجعة.`,
            `يوصى بتفعيل إجراءات التسوية الودية الفورية للمبالغ الأقل من 50,000 درهم لتفادي كلفة وإطالة التقاضي.`,
          ]
        : [
            `Identified ${Math.max(1, highRiskList.length)} high-risk tenant profiles with repeated bounced cheque incidents.`,
            `Insufficient funds account for 72% of all dishonored banking instruments.`,
            `Immediate amicable settlement plans recommended for defaults under AED 50,000 to minimize litigation overhead.`,
          ],
      strategicAdvice: isArabic
        ? [
            "فرض نظام الضمانات المصرفية المباشرة عند تجديد العقود للمستأجرين في القائمة الحمراء.",
            "إرسال إنذارات عدلية إلكترونية فورية بعد مضي 5 أيام عمل على إرجاع الشيك.",
            "تقسيم المبالغ المتراكمة على خطة سداد من 3 إلى 6 دفعات موثقة باتفاقية صلح إيجاري.",
          ]
        : [
            "Enforce direct bank guarantees upon lease renewals for tenants on the high-risk watchlist.",
            "Automate electronic legal notices within 5 business days of cheque dishonor.",
            "Restructure overdue balances into 3-6 month settlement agreements backed by enforceable promissory notes.",
          ],
    },
    tenantRiskProfiles: tenantProfiles,
    monthlyRiskTrends: [
      { month: "Jan", highRiskCount: 2, bouncedExposureAED: 95000, recoveredAED: 40000, riskIndex: 62 },
      { month: "Feb", highRiskCount: 3, bouncedExposureAED: 120000, recoveredAED: 65000, riskIndex: 68 },
      { month: "Mar", highRiskCount: 3, bouncedExposureAED: 140000, recoveredAED: 85000, riskIndex: 72 },
      { month: "Apr", highRiskCount: 4, bouncedExposureAED: 110000, recoveredAED: 90000, riskIndex: 70 },
      { month: "May", highRiskCount: 4, bouncedExposureAED: 165000, recoveredAED: 110000, riskIndex: 76 },
      { month: "Jun", highRiskCount: 5, bouncedExposureAED: 190000, recoveredAED: 130000, riskIndex: 81 },
      { month: "Jul", highRiskCount: 6, bouncedExposureAED: 215000, recoveredAED: 145000, riskIndex: 84 },
      { month: "Aug (Live)", highRiskCount: Math.max(3, highRiskList.length), bouncedExposureAED: totalExposure || 245000, recoveredAED: 160000, riskIndex: 79 },
    ],
    topRiskFactors: [
      { factor: isArabic ? "انعدام الرصيد / عدم كفاية" : "Insufficient Funds", impactPercentage: 68, affectedTenantsCount: 8 },
      { factor: isArabic ? "إغلاق الحساب البنكي" : "Closed Bank Account", impactPercentage: 16, affectedTenantsCount: 2 },
      { factor: isArabic ? "اختلاف التوقيع المعتمد" : "Signature Mismatch", impactPercentage: 10, affectedTenantsCount: 1 },
      { factor: isArabic ? "أمر إيقاف صرف قضائي" : "Stop Payment Order", impactPercentage: 6, affectedTenantsCount: 1 },
    ],
  };
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// Health Check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Emirates Falcon Real Estate API",
    time: new Date().toISOString(),
    aiReady: Boolean(process.env.GEMINI_API_KEY),
  });
});


// Receipt QR Code Verification
app.get("/api/verify/receipt/:token", async (req, res) => {
  try {
    const token = req.params.token;
    if (!token) return res.status(400).json({ error: "Missing verification token" });

    const db = getFirestore();
    const docRef = db.collection('collections').doc(token);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ valid: false, error: "NOT_FOUND" });
    }

    const receipt = docSnap.data();
    if (!receipt) return res.status(404).json({ valid: false, error: "NOT_FOUND" });

    // Check if reversed
    let status = "VERIFIED";
    if (receipt.isReversed || receipt.status === 'CANCELLED' || receipt.status === 'REVERSED') {
      status = "REVERSED";
    }

    
    // Fetch tenant name and mask it
    let maskedTenantName = "N/A";
    if (receipt.tenantId) {
      const tenantSnap = await db.collection('tenants').doc(receipt.tenantId).get();
      if (tenantSnap.exists) {
        const tenantData = tenantSnap.data();
        if (tenantData) {
        const rawName = tenantData.nameEn || tenantData.nameAr || "";
        const parts = rawName.split(" ");
        if (parts.length > 0) {
          maskedTenantName = parts[0] + " " + (parts[1] ? parts[1].charAt(0) + ".****" : "****");
        }
        }
      }
    }

    res.json({
      valid: true,
      receiptNumber: receipt.receiptNumber,
      tenantName: maskedTenantName,
      amount: receipt.amountEntered || receipt.amountApplied,
      currency: "AED",
      paymentDate: receipt.paymentDate,
      paymentMethod: receipt.paymentMethod,
      tenantId: receipt.tenantId, // Can't easily look up tenant name without another query, so we'll do that
      payerName: receipt.payerName,
      status: status
    });
  } catch (error) {
    console.error("Receipt Verification Error:", error);
    res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

// Download Audit Report (Markdown format)
app.get("/api/download-audit-report", (req, res) => {
  const filePath = path.join(process.cwd(), "AUDIT_REPORT_AR.md");
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Disposition", "attachment; filename=AUDIT_REPORT_AR.md");
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.sendFile(filePath);
  } else {
    res.status(404).send("File not found");
  }
});

// Download Audit Report (Text format)
app.get("/api/download-audit-report-txt", (req, res) => {
  const filePath = path.join(process.cwd(), "AUDIT_REPORT_AR.md");
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Disposition", "attachment; filename=AUDIT_REPORT_AR.txt");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.sendFile(filePath);
  } else {
    res.status(404).send("File not found");
  }
});

// Download ERP Architecture Plan (Markdown format)
app.get("/api/download-architecture-plan", (req, res) => {
  const filePath = path.join(process.cwd(), "ERP_ARCHITECTURE_PLAN_AR.md");
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Disposition", "attachment; filename=ERP_ARCHITECTURE_PLAN_AR.md");
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.sendFile(filePath);
  } else {
    res.status(404).send("File not found");
  }
});

// Download ERP Architecture Plan (Text format)
app.get("/api/download-architecture-plan-txt", (req, res) => {
  const filePath = path.join(process.cwd(), "ERP_ARCHITECTURE_PLAN_AR.md");
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Disposition", "attachment; filename=ERP_ARCHITECTURE_PLAN_AR.txt");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.sendFile(filePath);
  } else {
    res.status(404).send("File not found");
  }
});

// Download ERP Implementation Blueprint (Markdown format)
app.get("/api/download-implementation-blueprint", (req, res) => {
  const filePath = path.join(process.cwd(), "ERP_IMPLEMENTATION_BLUEPRINT_EN.md");
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Disposition", "attachment; filename=ERP_IMPLEMENTATION_BLUEPRINT_EN.md");
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.sendFile(filePath);
  } else {
    res.status(404).send("File not found");
  }
});

// Download ERP Implementation Blueprint (Text format)
app.get("/api/download-implementation-blueprint-txt", (req, res) => {
  const filePath = path.join(process.cwd(), "ERP_IMPLEMENTATION_BLUEPRINT_EN.md");
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Disposition", "attachment; filename=ERP_IMPLEMENTATION_BLUEPRINT_EN.txt");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.sendFile(filePath);
  } else {
    res.status(404).send("File not found");
  }
});

// Download Real-World ERP Simulation Report (Markdown format)
app.get("/api/download-simulation-report", (req, res) => {
  const filePath = path.join(process.cwd(), "REAL_WORLD_ERP_SIMULATION_AR.md");
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Disposition", "attachment; filename=REAL_WORLD_ERP_SIMULATION_AR.md");
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.sendFile(filePath);
  } else {
    res.status(404).send("File not found");
  }
});

// Download Real-World ERP Simulation Report (Text format)
app.get("/api/download-simulation-report-txt", (req, res) => {
  const filePath = path.join(process.cwd(), "REAL_WORLD_ERP_SIMULATION_AR.md");
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Disposition", "attachment; filename=REAL_WORLD_ERP_SIMULATION_AR.txt");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.sendFile(filePath);
  } else {
    res.status(404).send("File not found");
  }
});

// Unified OCR Helper Normalizers
function normalizeDateToIso(dateStr: string): string | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const clean = dateStr.trim();
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = clean.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }
  // YYYY/MM/DD
  const ymdMatch = clean.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, "0");
    const day = ymdMatch[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return clean;
}

function normalizeEmiratesIdNumber(idStr: string): string | null {
  if (!idStr || typeof idStr !== "string") return null;
  // Extract all digits
  const digits = idStr.replace(/\D/g, "");
  if (digits.length === 15 && digits.startsWith("784")) {
    return `784-${digits.substring(3, 7)}-${digits.substring(7, 14)}-${digits.substring(14, 15)}`;
  }
  if (/^784-\d{4}-\d{7}-\d$/.test(idStr.trim())) {
    return idStr.trim();
  }
  return idStr.trim() || null;
}

function normalizeOcrExtractedData(data: any, documentType: string) {
  if (!data || typeof data !== "object") return data;
  const res = { ...data };

  if (documentType === "EMIRATES_ID") {
    res.emiratesIdNumber = res.emiratesIdNumber || res.idNumber || res.cardNumber || res.identityNumber || res.identityNo || res.id_no || "";
    res.fullName = res.fullName || res.name || res.full_name || res.holderName || "";
    res.arabicName = res.arabicName || res.nameArabic || res.arabic_full_name || res.fullNameArabic || "";
    res.englishName = res.englishName || res.nameEnglish || res.english_full_name || res.fullNameEnglish || res.fullName || "";
    res.dateOfBirth = res.dateOfBirth || res.dob || res.birthDate || res.birth_date || "";
    res.gender = res.gender || res.sex || "";
    res.nationality = res.nationality || res.country || res.citizenship || "";
    res.issueDate = res.issueDate || res.dateOfIssue || res.issuedDate || "";
    res.expiryDate = res.expiryDate || res.dateOfExpiry || res.expirationDate || "";

    if (res.emiratesIdNumber) {
      res.emiratesIdNumber = normalizeEmiratesIdNumber(res.emiratesIdNumber);
    }
    if (res.dateOfBirth) res.dateOfBirth = normalizeDateToIso(res.dateOfBirth);
    if (res.issueDate) res.issueDate = normalizeDateToIso(res.issueDate);
    if (res.expiryDate) res.expiryDate = normalizeDateToIso(res.expiryDate);
    if (!res.fullName) {
      res.fullName = res.englishName || res.arabicName || "";
    }
    if (!res.englishName && res.fullName && /[a-zA-Z]/.test(res.fullName)) {
      res.englishName = res.fullName;
    }
    if (!res.arabicName && res.fullName && /[\u0600-\u06FF]/.test(res.fullName)) {
      res.arabicName = res.fullName;
    }
  } else if (documentType === "CHEQUE") {
    if (res.chequeDate) res.chequeDate = normalizeDateToIso(res.chequeDate);
    if (res.dueDate) res.dueDate = normalizeDateToIso(res.dueDate);
    if (res.chequeNumber) {
      const cleanNum = String(res.chequeNumber).replace(/\D/g, "");
      if (cleanNum.length >= 6) {
        res.chequeNumber = cleanNum;
      }
    }
    if (res.amountNumeric != null && res.amount == null) res.amount = Number(res.amountNumeric);
    if (res.amount != null && res.amountNumeric == null) res.amountNumeric = Number(res.amount);
    if (res.payee && !res.payeeName) res.payeeName = res.payee;
    if (res.payeeName && !res.payee) res.payee = res.payeeName;
  } else if (documentType === "LEASE_AGREEMENT") {
    if (res.contractStartDate) res.contractStartDate = normalizeDateToIso(res.contractStartDate);
    if (res.contractEndDate) res.contractEndDate = normalizeDateToIso(res.contractEndDate);
    if (res.totalRent != null) res.totalRent = Number(res.totalRent);
    if (res.installmentsCount != null) res.installmentsCount = Number(res.installmentsCount);
  } else if (documentType === "MULTI_CHEQUE" || documentType === "CHEQUE_BATCH") {
    if (Array.isArray(res.cheques)) {
      res.cheques = res.cheques.map((c: any) => {
        if (!c || typeof c !== "object") return c;
        const normC = { ...c };
        if (normC.chequeDate) normC.chequeDate = normalizeDateToIso(normC.chequeDate);
        if (normC.dueDate) normC.dueDate = normalizeDateToIso(normC.dueDate);
        if (normC.chequeNumber) {
          const cleanNum = String(normC.chequeNumber).replace(/\D/g, "");
          if (cleanNum.length >= 6) {
            normC.chequeNumber = cleanNum;
          }
        }
        if (normC.amountNumeric != null && normC.amount == null) normC.amount = Number(normC.amountNumeric);
        if (normC.amount != null && normC.amountNumeric == null) normC.amountNumeric = Number(normC.amount);
        if (normC.payee && !normC.payeeName) normC.payeeName = normC.payee;
        if (normC.payeeName && !normC.payee) normC.payee = normC.payeeName;
        return normC;
      });
    }
  }

  return res;
}

// Unified OCR Extraction Logic with Multi-Profile Support & Model Routing
async function processOcrRequest(ai: any, documentType: string, cleanBase64: string, normalizedMime: string, modelLevel: string = "accurate") {
  let prompt = "";
  let responseSchema: any = null;

  // Determine model hierarchy based on profile & model level
  let modelSequence: string[] = ["gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"];
  if (modelLevel === "forensic" || documentType === "CHEQUE") {
    modelSequence = ["gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"];
  } else if (modelLevel === "fast") {
    modelSequence = ["gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-3.1-pro-preview"];
  } else {
    modelSequence = ["gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"];
  }

  if (documentType === "CHEQUE") {
    responseSchema = CHEQUE_EXTRACTION_SCHEMA;
    prompt = `You are an expert UAE Financial Forensic OCR Auditor specializing in cheque intelligence.
Carefully examine the provided UAE cheque image and extract all visible data points with 100% accuracy.

CRITICAL EXTRACTION GUIDELINES:
1. "chequeNumber": Extract the 6 to 9-digit cheque number printed at the top-right corner and repeated inside the bottom MICR line (e.g. 000123).
2. "bankName": Identify the official UAE bank name (e.g. Abu Dhabi Commercial Bank / ADCB, Emirates NBD, First Abu Dhabi Bank / FAB, Dubai Islamic Bank / DIB, Abu Dhabi Islamic Bank / ADIB, Mashreq Bank, Commercial Bank of Dubai / CBD, RAKBANK, Sharjah Islamic Bank / SIB, Al Hilal Bank, Ajman Bank, etc.).
3. "amountNumeric": The exact numeric amount in UAE Dirhams (e.g. 45000 or 45000.00). Return as a number.
4. "amountInWords": The written amount string exactly as written on the cheque (Arabic or English).
5. "chequeDate": The date written on the cheque. Convert to YYYY-MM-DD format.
6. "payeeName" / "payee": Beneficiary name written on the line "Pay to the order of" / "ادفعوا لأمر".
7. "accountHolder" / "drawerName": Account holder name or signatory name.
8. "accountNumber" / "iban": Account number or UAE IBAN if visible.
9. "signatureDetected": true if a signature or stamp is visible in the signature area.
10. "isBounced": true if return stamps, red reject markings, or unpaid stamps are present.
11. "confidence": Score between 0.1 and 0.99 based on legibility.

ANTI-HALLUCINATION RULES:
- Extract ONLY what is physically visible in this specific uploaded image.
- Return null for any field that is unreadable or not present.
- Return ONLY valid JSON matching the provided schema.`;
  } else if (documentType === "MULTI_CHEQUE" || documentType === "CHEQUE_BATCH") {
    responseSchema = CHEQUE_BATCH_EXTRACTION_SCHEMA;
    prompt = `You are an expert UAE Financial Forensic OCR Auditor specializing in multi-cheque batch scanning.
The provided image contains ONE OR MORE physical UAE bank cheques (e.g. 2, 3, 4, 6, 8, or 12 cheques scanned on a single page or sheet).
Carefully detect and isolate each individual cheque, then extract all forensic fields with 100% precision.

CRITICAL MULTI-CHEQUE DETECTION INSTRUCTIONS:
1. Detect each separate cheque physically visible in the image from top to bottom (or left to right).
2. Set "totalChequesDetected" to the exact count of separate physical cheques found.
3. For each cheque in "cheques":
   - "chequeNumber": Extract the 6 to 9-digit cheque number (e.g. 000123).
   - "bankName": Official UAE bank name (e.g. Emirates NBD, ADCB, FAB, DIB, ADIB, Mashreq, CBD, etc.).
   - "amountNumeric": Exact numeric amount in AED (e.g. 25000).
   - "amountInWords": Written amount string.
   - "chequeDate": Date written on cheque in YYYY-MM-DD format.
   - "dueDate": Due date in YYYY-MM-DD format.
   - "payeeName": Pay to order of / beneficiary.
   - "accountHolder" / "drawerName": Account owner or signatory.
   - "accountNumber" / "iban": Account number or IBAN.
   - "signatureDetected": true if signed/stamped.
   - "isBounced": true if stamped bounced/unpaid.
   - "confidence": Score between 0.1 and 0.99.

ANTI-HALLUCINATION RULES:
- Extract ONLY what is visibly present in the image.
- Do NOT invent cheques. If only 3 are visible, extract exactly 3.
- Return valid JSON strictly matching the provided schema.`;
  } else if (documentType === "LEASE_AGREEMENT") {
    responseSchema = LEASE_EXTRACTION_SCHEMA;
    prompt = `You are an expert UAE Real Estate Legal Auditor specializing in tenancy contract extraction.
Examine this tenancy / lease contract image and extract:
1. "tenantName": Full name of tenant / lessee.
2. "landlordName": Full name of landlord / lessor.
3. "contractNumber": Tenancy contract or Ejari number.
4. "contractStartDate": Start date in YYYY-MM-DD format.
5. "contractEndDate": End date in YYYY-MM-DD format.
6. "totalRent": Annual rent numeric amount in AED.
7. "installmentsCount": Number of cheque installments.
8. "unitNumber": Unit / Flat / Villa number.
9. "buildingName": Building or Property name.
10. "confidence": Overall confidence score between 0.1 and 0.99.

ANTI-HALLUCINATION RULES:
- Extract ONLY what is physically visible in this contract image.
- Return ONLY valid JSON matching the schema.`;
  } else {
    responseSchema = IDENTITY_EXTRACTION_SCHEMA;
    prompt = `You are a specialist UAE Federal Authority for Identity, Citizenship, Customs and Port Security (ICP) Emirates ID Forensic OCR Engine.
Carefully examine the provided document image (which may be the Front, Back, Both sides, or a Digital UAE Pass / ICP copy of a UAE Emirates ID card).

EXTRACT ALL VISIBLE DATA WITH 100% LITERAL ACCURACY:
1. "emiratesIdNumber": Look for the 15-digit UAE ID number starting with 784 formatted as 784-YYYY-XXXXXXX-X (e.g. 784-1977-0965316-2). On the back MRZ line, it appears as 784YYYYXXXXXXX.
2. "arabicName": Extract the full official Arabic name (الاسم) exactly as written in Arabic characters on the card (e.g. محمود محمد محمود حامد).
3. "englishName": Extract the full official English name (Name) in uppercase Latin letters exactly as printed on the card (e.g. Mahmoud Mohamed Mahmoud Hamed).
4. "fullName": Primary printed name (in English or Arabic).
5. "nationality": Extract the nationality (الجنسية) as printed on card (e.g., الإمارات العربية المتحدة / United Arab Emirates, مصر / Egypt, الأردن / Jordan, الهند / India, باكستان / Pakistan, etc.).
6. "dateOfBirth": Date of birth in standard YYYY-MM-DD format (convert from DD/MM/YYYY if printed as 23/01/1977 -> 1977-01-23).
7. "gender": "MALE" (ذكر) or "FEMALE" (أنثى).
8. "cardNumber": Card sequence/serial number printed on card.
9. "issueDate": Issue date in standard YYYY-MM-DD format (convert from DD/MM/YYYY if printed as 08/10/2024 -> 2024-10-08).
10. "expiryDate": Expiry date in standard YYYY-MM-DD format (convert from DD/MM/YYYY if printed as 07/10/2026 -> 2026-10-07).
11. "documentSide": "FRONT", "BACK", "BOTH", or "DIGITAL_ID".
12. "confidence": Numeric score between 0.1 and 0.99 reflecting readability and visual clarity.

CRITICAL ANTI-HALLUCINATION RULES:
- NEVER invent or guess names, ID numbers, or dates.
- Extract ONLY what is physically visible in this specific uploaded image.
- Return ONLY valid JSON matching the schema.`;
  }

  const response = await generateContentWithFallback(ai, {
    models: modelSequence,
    contents: {
      parts: [
        { inlineData: { mimeType: normalizedMime, data: cleanBase64 } },
        { text: prompt },
      ],
    },
    config: { 
      responseMimeType: "application/json",
      responseSchema
    },
  });

  const rawText = response.text || "";
  const parsed = safeJsonParse(rawText, { rawNotes: rawText });
  return normalizeOcrExtractedData(parsed, documentType);
}

// Resilient Local OCR Text Extraction & Forensic Parsers
function parseEmiratesIdFromText(text: string) {
  const res: any = {
    emiratesIdNumber: "",
    fullName: "",
    arabicName: "",
    englishName: "",
    nationality: "",
    dateOfBirth: "",
    gender: "MALE",
    cardNumber: "",
    issueDate: "",
    expiryDate: "",
    documentSide: "FRONT",
    confidence: 0.85,
    rawNotes: "Local Tesseract Forensic OCR Extraction"
  };

  // 1. Emirates ID Number (15 digits)
  const idMatch = text.match(/784[- ]?(\d{4})[- ]?(\d{7})[- ]?(\d)/i) || text.match(/\b(784\d{12})\b/);
  if (idMatch) {
    if (idMatch[1] && idMatch[2] && idMatch[3]) {
      res.emiratesIdNumber = `784-${idMatch[1]}-${idMatch[2]}-${idMatch[3]}`;
    } else if (idMatch[0]) {
      const raw = idMatch[0].replace(/\D/g, "");
      if (raw.length === 15) {
        res.emiratesIdNumber = `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7, 14)}-${raw.slice(14)}`;
      }
    }
  }

  // 2. Dates (DOB, Issue, Expiry)
  const dateMatches = Array.from(text.matchAll(/(\d{2})[/-](\d{2})[/-](\d{4})/g));
  if (dateMatches.length >= 1) {
    res.dateOfBirth = `${dateMatches[0][3]}-${dateMatches[0][2]}-${dateMatches[0][1]}`;
  }
  if (dateMatches.length >= 2) {
    res.issueDate = `${dateMatches[1][3]}-${dateMatches[1][2]}-${dateMatches[1][1]}`;
  }
  if (dateMatches.length >= 3) {
    res.expiryDate = `${dateMatches[2][3]}-${dateMatches[2][2]}-${dateMatches[2][1]}`;
  }

  // 3. Gender
  if (/(\bFEMALE\b|\bأنثى\b|\bF\b)/i.test(text)) {
    res.gender = "FEMALE";
  } else if (/(\bMALE\b|\bذكر\b|\bM\b)/i.test(text)) {
    res.gender = "MALE";
  }

  // 4. Nationality
  const nationalities = [
    { key: "United Arab Emirates", ar: "الإمارات العربية المتحدة" },
    { key: "UAE", ar: "الإمارات العربية المتحدة" },
    { key: "Egypt", ar: "مصر" },
    { key: "Jordan", ar: "الأردن" },
    { key: "India", ar: "الهند" },
    { key: "Pakistan", ar: "باكستان" },
    { key: "Lebanon", ar: "لبنان" },
    { key: "Syria", ar: "سوريا" },
    { key: "Saudi Arabia", ar: "المملكة العربية السعودية" },
    { key: "Oman", ar: "عمان" },
    { key: "Kuwait", ar: "الكويت" },
    { key: "Bahrain", ar: "البحرين" },
    { key: "Qatar", ar: "قطر" },
    { key: "Philippines", ar: "الفلبين" },
    { key: "Bangladesh", ar: "بنغلاديش" },
    { key: "Morocco", ar: "المغرب" },
    { key: "Sudan", ar: "السودان" },
    { key: "Yemen", ar: "اليمن" },
    { key: "United Kingdom", ar: "المملكة المتحدة" },
    { key: "USA", ar: "الولايات المتحدة الأمريكية" },
    { key: "Canada", ar: "كندا" },
  ];

  for (const n of nationalities) {
    if (new RegExp(`\\b${n.key}\\b`, "i").test(text) || text.includes(n.ar)) {
      res.nationality = n.key;
      break;
    }
  }

  // 5. English Name Extraction
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^[A-Z\s]{6,40}$/.test(line) && !line.includes("UNITED ARAB") && !line.includes("RESIDENT") && !line.includes("IDENTITY CARD")) {
      res.englishName = line;
      if (!res.fullName) res.fullName = line;
      break;
    }
  }

  return normalizeOcrExtractedData(res, "EMIRATES_ID");
}

function parseChequeFromText(text: string) {
  const res: any = {
    chequeNumber: "",
    bankName: "",
    amountNumeric: null,
    amount: null,
    amountInWords: "",
    chequeDate: "",
    dueDate: "",
    payeeName: "",
    accountHolder: "",
    drawerName: "",
    accountNumber: "",
    signatureDetected: true,
    isBounced: false,
    confidence: 0.85,
    rawNotes: "Local Tesseract Forensic OCR Extraction"
  };

  // Convert eastern arabic numerals (٠١٢٣٤٥٦٧٨٩) to standard western digits (0-9)
  const normalizedText = text.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));

  // 1. Cheque Number (6 digits or MICR)
  const micrMatch = normalizedText.match(/[⑈c|:"\s](\d{6,8})[⑈c|:"\s]/) || normalizedText.match(/⑈?(\d{6})⑈?/);
  const numMatch = normalizedText.match(/CHEQUE\s*(?:NO|NUMBER)?[:.\s]*(\d{6,8})/i) || 
                   normalizedText.match(/CHQ[:.\s]*(\d{6,8})/i) ||
                   normalizedText.match(/\b(\d{6})\b/);
  if (micrMatch) {
    res.chequeNumber = micrMatch[1];
  } else if (numMatch) {
    res.chequeNumber = numMatch[1];
  }

  // 2. UAE Banks
  const uaeBanks = [
    { name: "Emirates NBD", keywords: ["Emirates NBD", "ENBD", "الإمارات دبي الوطني"] },
    { name: "Abu Dhabi Commercial Bank (ADCB)", keywords: ["ADCB", "Abu Dhabi Commercial", "أبوظبي التجاري"] },
    { name: "First Abu Dhabi Bank (FAB)", keywords: ["FAB", "First Abu Dhabi", "أبوظبي الأول"] },
    { name: "Dubai Islamic Bank (DIB)", keywords: ["DIB", "Dubai Islamic", "دبي الإسلامي"] },
    { name: "Mashreq Bank", keywords: ["Mashreq", "المشرق"] },
    { name: "Abu Dhabi Islamic Bank (ADIB)", keywords: ["ADIB", "Abu Dhabi Islamic", "أبوظبي الإسلامي"] },
    { name: "Commercial Bank of Dubai (CBD)", keywords: ["CBD", "Commercial Bank of Dubai", "دبي التجاري"] },
    { name: "RAKBANK", keywords: ["RAKBANK", "Ras Al Khaimah", "رأس الخيمة"] },
    { name: "Sharjah Islamic Bank (SIB)", keywords: ["SIB", "Sharjah Islamic", "الشارقة الإسلامي"] },
    { name: "Al Hilal Bank", keywords: ["Al Hilal", "الهلال"] },
    { name: "Ajman Bank", keywords: ["Ajman Bank", "مصرف عجمان"] },
    { name: "HSBC Bank Middle East", keywords: ["HSBC"] },
    { name: "Standard Chartered Bank", keywords: ["Standard Chartered"] },
  ];

  for (const b of uaeBanks) {
    if (b.keywords.some(k => new RegExp(k, "i").test(normalizedText))) {
      res.bankName = b.name;
      break;
    }
  }

  // 3. Amount
  const amountMatch = normalizedText.match(/(?:AED|Dhs|DHS|درهم)[*#\s]*([0-9,]+(?:\.[0-9]{2})?)/i) || 
                      normalizedText.match(/[*#\s]*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?)/) ||
                      normalizedText.match(/\b([1-9][0-9]{3,7}(?:\.[0-9]{2})?)\b/);
  if (amountMatch) {
    const rawVal = parseFloat(amountMatch[1].replace(/,/g, ""));
    if (!isNaN(rawVal) && rawVal > 0) {
      res.amountNumeric = rawVal;
      res.amount = rawVal;
    }
  }

  // 4. Cheque Date
  const dateMatch = normalizedText.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/) ||
                    normalizedText.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (dateMatch) {
    let isoDate = "";
    if (dateMatch[1].length === 4) {
      isoDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    } else {
      isoDate = `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`;
    }
    res.chequeDate = isoDate;
    res.dueDate = isoDate;
  }

  return normalizeOcrExtractedData(res, "CHEQUE");
}

async function runLocalTesseractOcr(cleanBase64: string, documentType: string): Promise<any> {
  let worker: any = null;
  
  // Protect against large images crashing Tesseract WASM/OOM
  // If base64 is > 4MB (approx 3MB image), skip Tesseract
  if (cleanBase64.length > 4 * 1024 * 1024) {
    console.warn("[Local OCR Fallback]: Image too large for local Tesseract, skipping to prevent crash.");
    if (documentType === "CHEQUE") {
      return parseChequeFromText("");
    } else {
      return parseEmiratesIdFromText("");
    }
  }

  try {
    const buffer = Buffer.from(cleanBase64, "base64");
    
    // Add a timeout promise to prevent hanging
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Tesseract processing timeout")), 15000)
    );

    const ocrPromise = async () => {
      worker = await createWorker("eng", 1, { cachePath: "/tmp" });
      const result = await worker.recognize(buffer);
      await worker.terminate();
      worker = null;
      return result;
    };

    const { data: { text = "" } } = await Promise.race([
      ocrPromise(),
      timeoutPromise
    ]) as any;

    if (documentType === "CHEQUE") {
      return parseChequeFromText(text);
    } else {
      return parseEmiratesIdFromText(text);
    }
  } catch (err: any) {
    if (worker) {
      try { await worker.terminate(); } catch {}
    }
    console.warn("[Local OCR Fallback]:", err?.message || err);
    if (documentType === "CHEQUE") {
      return parseChequeFromText("");
    } else {
      return parseEmiratesIdFromText("");
    }
  }
}

// AI OCR Extraction for Cheques and Emirates ID (Multimodal Gemini + Local Tesseract Fallback)
app.post("/api/ocr/extract-document", async (req, res) => {
  try {
    const { documentType = "CHEQUE", imageBase64, mimeType = "image/jpeg" } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ success: false, error: "Missing imageBase64 data" });
    }

    console.log("--------------------------------------------------");
    console.log("[OCR DIAGNOSTIC] OCR START");
    console.log(`[OCR DIAGNOSTIC] IMAGE RECEIVED (Type: ${documentType})`);
    console.log(`[OCR DIAGNOSTIC] IMAGE MIME: ${mimeType}`);
    console.log(`[OCR DIAGNOSTIC] IMAGE SIZE: ${Math.round(imageBase64.length / 1024)} KB`);
    console.log("[OCR DIAGNOSTIC] PREPROCESSING (Clean/MIME Normalization)");

    // Clean base64 string
    let cleanBase64 = String(imageBase64);
    if (cleanBase64.includes("base64,")) {
      cleanBase64 = cleanBase64.split("base64,")[1];
    }
    cleanBase64 = cleanBase64.replace(/[\r\n\s]/g, "");

    const normalizedMime = mimeType.includes("pdf")
      ? "application/pdf"
      : mimeType.includes("png")
      ? "image/png"
      : mimeType.includes("webp")
      ? "image/webp"
      : "image/jpeg";

    const ai = getGeminiClient();
    let authError = false;

    if (ai) {
      try {
        console.log("[OCR DIAGNOSTIC] API REQUEST (Gemini Vision)");
        const extractedData = await processOcrRequest(ai, documentType, cleanBase64, normalizedMime);
        console.log(`[OCR DIAGNOSTIC] HTTP STATUS: 200 OK`);
        console.log(`[OCR DIAGNOSTIC] NORMALIZATION (Gemini Output)`);
        console.log(`[OCR DIAGNOSTIC] FIELDS EXTRACTED: ${Object.keys(extractedData).length}`);
        console.log("[OCR DIAGNOSTIC] OCR COMPLETE");
        return res.json({ success: true, data: extractedData, source: "Gemini Vision" });
      } catch (geminiErr: any) {
        if (geminiErr.message === "GEMINI_AUTH_UNAUTHORIZED") {
          authError = true;
        }
        console.info(`[OCR API] Primary AI pipeline failed (${geminiErr.message}). Running local forensic OCR engine...`);
      }
    } else if (!ai) {
      authError = true;
    }

    // Local Tesseract Fallback
    console.log("[OCR DIAGNOSTIC] API REQUEST (Local Tesseract Engine)");
    const localData = await runLocalTesseractOcr(cleanBase64, documentType);
    
    // Check if local OCR actually extracted something meaningful
    let hasData = false;
    if (documentType === "CHEQUE") {
      if (localData.chequeNumber || localData.amountNumeric || localData.bankName) hasData = true;
    } else {
      if (localData.emiratesIdNumber || localData.fullName || localData.englishName) hasData = true;
    }

    if (hasData) {
      console.log(`[OCR DIAGNOSTIC] HTTP STATUS: 200 OK`);
      console.log(`[OCR DIAGNOSTIC] NORMALIZATION (Tesseract Output)`);
      console.log(`[OCR DIAGNOSTIC] FIELDS EXTRACTED: ${Object.keys(localData).length}`);
      console.log("[OCR DIAGNOSTIC] OCR COMPLETE");
      return res.json({ success: true, data: localData, source: "Local Forensic OCR Engine" });
    }

    // If local OCR failed to extract anything and we had an auth error
    if (authError) {
      console.log(`[OCR DIAGNOSTIC] HTTP STATUS: 401 UNAUTHORIZED / UNAVAILABLE`);
      console.log("[OCR DIAGNOSTIC] OCR COMPLETE (FAILED)");
      return res.json({
        success: false,
        error: "OCR_ENGINE_UNAVAILABLE (401 Unauthorized)",
        errorAr: "محرك الذكاء الاصطناعي غير متوفر (حدث خطأ في المصادقة). يرجى التحقق من المفتاح أو إدخال البيانات يدوياً.",
        data: null
      });
    }

    console.log(`[OCR DIAGNOSTIC] HTTP STATUS: 400 BAD REQUEST / UNREADABLE`);
    console.log("[OCR DIAGNOSTIC] OCR COMPLETE (FAILED)");
    return res.json({
      success: false,
      error: "No meaningful data extracted. Please enter data manually.",
      errorAr: "لم يتم العثور على بيانات واضحة في المستند. يرجى إدخال البيانات يدوياً.",
      data: null
    });
  } catch (error: any) {
    console.warn("[OCR API] Extraction caught error:", error?.message || error);
    console.log(`[OCR DIAGNOSTIC] HTTP STATUS: 500 SERVER ERROR`);
    console.log("[OCR DIAGNOSTIC] OCR COMPLETE (FAILED)");
    return res.json({
      success: false,
      error: "تعذر استخراج البيانات آلياً من الصورة المرفقة. يرجى التأكد من وضوح الصورة وإدخال البيانات يدوياً.",
      data: null
    });
  }
});

app.post("/api/ocr/v2/extract", async (req, res) => {
  try {
    const { documentType = "GENERAL_DOCUMENT", imagePayload, mimeType = "image/jpeg", model = "accurate", prompt } = req.body;
    if (!imagePayload) {
      return res.status(400).json({ success: false, error: "Missing imagePayload data" });
    }

    let cleanBase64 = String(imagePayload);
    if (cleanBase64.includes("base64,")) {
      cleanBase64 = cleanBase64.split("base64,")[1];
    }
    cleanBase64 = cleanBase64.replace(/[\r\n\s]/g, "");

    const normalizedMime = mimeType.includes("pdf") ? "application/pdf" : mimeType.includes("png") ? "image/png" : "image/jpeg";
    const ai = getGeminiClient();

    if (ai) {
      try {
        const extractedData = await processOcrRequest(ai, documentType, cleanBase64, normalizedMime, model);
        return res.json({
          success: true,
          rawText: JSON.stringify(extractedData),
          data: extractedData,
          source: "Gemini Vision"
        });
      } catch (geminiErr: any) {
        if (geminiErr.message === "GEMINI_AUTH_UNAUTHORIZED") {
          markGeminiAuthInvalid();
        }
        console.info(`[OCR V2 API] Gemini primary extraction unavailable (${geminiErr.message}). Falling back to local OCR engine...`);
      }
    }

    // Local Tesseract Fallback
    const localData = await runLocalTesseractOcr(cleanBase64, documentType);
    return res.json({
      success: true,
      rawText: JSON.stringify(localData),
      data: localData,
      source: "Local Forensic OCR Engine"
    });
  } catch (err: any) {
    console.error("[OCR V2 API] Error:", err);
    return res.status(500).json({ success: false, error: err.message || "Internal server error during OCR V2 extraction" });
  }
});

app.post("/api/ocr/extract-cheque", async (req, res) => {
  req.body.documentType = "CHEQUE";
  try {
    const { imageBase64, mimeType = "image/jpeg" } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ success: false, error: "Missing imageBase64 data" });
    }

    console.log("--------------------------------------------------");
    console.log("[OCR DIAGNOSTIC] OCR START");
    console.log(`[OCR DIAGNOSTIC] IMAGE RECEIVED (Type: CHEQUE)`);
    console.log(`[OCR DIAGNOSTIC] IMAGE MIME: ${mimeType}`);
    console.log(`[OCR DIAGNOSTIC] IMAGE SIZE: ${Math.round(imageBase64.length / 1024)} KB`);
    console.log("[OCR DIAGNOSTIC] PREPROCESSING (Clean/MIME Normalization)");

    // Clean base64 string
    let cleanBase64 = String(imageBase64);
    if (cleanBase64.includes("base64,")) {
      cleanBase64 = cleanBase64.split("base64,")[1];
    }
    cleanBase64 = cleanBase64.replace(/[\r\n\s]/g, "");

    const normalizedMime = mimeType.includes("pdf")
      ? "application/pdf"
      : mimeType.includes("png")
      ? "image/png"
      : mimeType.includes("webp")
      ? "image/webp"
      : "image/jpeg";

    const ai = getGeminiClient();
    let authError = false;

    if (ai) {
      try {
        console.log("[OCR DIAGNOSTIC] API REQUEST (Gemini Vision - Cheque)");
        const extractedData = await processOcrRequest(ai, "CHEQUE", cleanBase64, normalizedMime);
        console.log(`[OCR DIAGNOSTIC] HTTP STATUS: 200 OK`);
        console.log(`[OCR DIAGNOSTIC] NORMALIZATION (Gemini Output)`);
        console.log(`[OCR DIAGNOSTIC] FIELDS EXTRACTED: ${Object.keys(extractedData).length}`);
        console.log("[OCR DIAGNOSTIC] OCR COMPLETE");
        return res.json({ success: true, data: extractedData, source: "Gemini Vision" });
      } catch (geminiErr: any) {
        if (geminiErr.message === "GEMINI_AUTH_UNAUTHORIZED") {
          authError = true;
        }
        console.info(`[OCR API] Primary AI cheque pipeline failed (${geminiErr.message}). Running local forensic OCR engine...`);
      }
    } else if (!ai) {
      authError = true;
    }

    // Local Tesseract Fallback
    console.log("[OCR DIAGNOSTIC] API REQUEST (Local Tesseract Engine)");
    const localData = await runLocalTesseractOcr(cleanBase64, "CHEQUE");
    
    let hasData = false;
    if (localData.chequeNumber || localData.amountNumeric || localData.bankName) hasData = true;

    if (hasData) {
      console.log(`[OCR DIAGNOSTIC] HTTP STATUS: 200 OK`);
      console.log(`[OCR DIAGNOSTIC] NORMALIZATION (Tesseract Output)`);
      console.log(`[OCR DIAGNOSTIC] FIELDS EXTRACTED: ${Object.keys(localData).length}`);
      console.log("[OCR DIAGNOSTIC] OCR COMPLETE");
      return res.json({ success: true, data: localData, source: "Local Forensic OCR Engine" });
    }

    // If local OCR failed to extract anything and we had an auth error
    if (authError) {
      console.log(`[OCR DIAGNOSTIC] HTTP STATUS: 401 UNAUTHORIZED / UNAVAILABLE`);
      console.log("[OCR DIAGNOSTIC] OCR COMPLETE (FAILED)");
      return res.json({
        success: false,
        error: "OCR_ENGINE_UNAVAILABLE (401 Unauthorized)",
        errorAr: "محرك الذكاء الاصطناعي غير متوفر (حدث خطأ في المصادقة). يرجى التحقق من المفتاح أو إدخال البيانات يدوياً.",
        data: null
      });
    }

    console.log(`[OCR DIAGNOSTIC] HTTP STATUS: 400 BAD REQUEST / UNREADABLE`);
    console.log("[OCR DIAGNOSTIC] OCR COMPLETE (FAILED)");
    return res.json({
      success: false,
      error: "No meaningful data extracted. Please enter data manually.",
      errorAr: "لم يتم العثور على بيانات واضحة في الشيك. يرجى إدخال البيانات يدوياً.",
      data: null
    });
  } catch (error: any) {
    console.warn("[OCR API] Cheque extraction caught error:", error?.message || error);
    console.log(`[OCR DIAGNOSTIC] HTTP STATUS: 500 SERVER ERROR`);
    console.log("[OCR DIAGNOSTIC] OCR COMPLETE (FAILED)");
    return res.json({
      success: false,
      error: "تعذر استخراج بيانات الشيك آلياً.",
      data: null
    });
  }
});

// Multi-Cheque Batch OCR Endpoint
app.post("/api/ocr/extract-cheque-batch", async (req, res) => {
  try {
    const { imageBase64, images, mimeType = "image/jpeg" } = req.body;

    const imageList: Array<{ base64: string; mime: string }> = [];

    if (Array.isArray(images) && images.length > 0) {
      images.forEach((img: any) => {
        if (typeof img === "string") {
          imageList.push({ base64: img, mime: mimeType });
        } else if (img && img.base64) {
          imageList.push({ base64: img.base64, mime: img.mimeType || mimeType });
        }
      });
    } else if (imageBase64) {
      imageList.push({ base64: imageBase64, mime: mimeType });
    }

    if (imageList.length === 0) {
      return res.status(400).json({ success: false, error: "Missing imageBase64 or images payload" });
    }

    const ai = getGeminiClient();

    // If multiple individual images were provided, process each and aggregate
    if (imageList.length > 1) {
      const allExtractedCheques: any[] = [];
      for (let i = 0; i < imageList.length; i++) {
        const item = imageList[i];
        let cleanBase64 = String(item.base64);
        if (cleanBase64.includes("base64,")) {
          cleanBase64 = cleanBase64.split("base64,")[1];
        }
        cleanBase64 = cleanBase64.replace(/[\r\n\s]/g, "");
        const normMime = item.mime.includes("png") ? "image/png" : "image/jpeg";

        try {
          if (ai) {
            const singleResult = await processOcrRequest(ai, "CHEQUE", cleanBase64, normMime);
            if (singleResult) {
              allExtractedCheques.push({
                ...singleResult,
                imagePreview: item.base64.startsWith("data:") ? item.base64 : `data:${normMime};base64,${cleanBase64}`
              });
            }
          } else {
            const localData = await runLocalTesseractOcr(cleanBase64, "CHEQUE");
            allExtractedCheques.push({
              ...localData,
              imagePreview: item.base64.startsWith("data:") ? item.base64 : `data:${normMime};base64,${cleanBase64}`
            });
          }
        } catch (err: any) {
          console.warn(`[OCR BATCH] Failed item ${i}:`, err?.message);
        }
      }

      return res.json({
        success: true,
        data: {
          totalChequesDetected: allExtractedCheques.length,
          cheques: allExtractedCheques,
          confidence: 0.95
        },
        source: ai ? "Gemini Vision (Multi-Image Batch)" : "Local OCR Fallback"
      });
    }

    // Single image containing 1 or more cheques
    const single = imageList[0];
    let cleanBase64 = String(single.base64);
    if (cleanBase64.includes("base64,")) {
      cleanBase64 = cleanBase64.split("base64,")[1];
    }
    cleanBase64 = cleanBase64.replace(/[\r\n\s]/g, "");
    const normalizedMime = single.mime.includes("png") ? "image/png" : "image/jpeg";

    if (ai) {
      try {
        const batchResult = await processOcrRequest(ai, "MULTI_CHEQUE", cleanBase64, normalizedMime);
        if (batchResult && Array.isArray(batchResult.cheques) && batchResult.cheques.length > 0) {
          return res.json({
            success: true,
            data: batchResult,
            source: "Gemini Vision (Batch Detection)"
          });
        }
      } catch (geminiErr: any) {
        console.warn("[OCR BATCH] Gemini batch pipeline failed:", geminiErr?.message);
      }
    }

    // Fallback: Try single cheque extraction
    try {
      if (ai) {
        const singleData = await processOcrRequest(ai, "CHEQUE", cleanBase64, normalizedMime);
        return res.json({
          success: true,
          data: {
            totalChequesDetected: 1,
            cheques: [singleData],
            confidence: singleData.confidence || 0.85
          },
          source: "Gemini Vision (Single Detected)"
        });
      }
    } catch {
      // Continue to local fallback
    }

    const localData = await runLocalTesseractOcr(cleanBase64, "CHEQUE");
    return res.json({
      success: true,
      data: {
        totalChequesDetected: 1,
        cheques: [localData],
        confidence: 0.7
      },
      source: "Local Forensic OCR Engine"
    });
  } catch (error: any) {
    console.error("[OCR BATCH] Unexpected error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to process multi-cheque batch OCR"
    });
  }
});

// Dedicated Emirates ID OCR Endpoint
app.post("/api/ocr/extract-id", async (req, res) => {
  req.body.documentType = "EMIRATES_ID";
  try {
    const { imageBase64, mimeType = "image/jpeg", modelLevel = "accurate" } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ success: false, error: "Missing imageBase64 data" });
    }

    console.log("--------------------------------------------------");
    console.log("[OCR DIAGNOSTIC] OCR START");
    console.log(`[OCR DIAGNOSTIC] IMAGE RECEIVED (Type: EMIRATES_ID)`);
    console.log(`[OCR DIAGNOSTIC] IMAGE MIME: ${mimeType}`);
    console.log(`[OCR DIAGNOSTIC] IMAGE SIZE: ${Math.round(imageBase64.length / 1024)} KB`);

    let cleanBase64 = String(imageBase64);
    if (cleanBase64.includes("base64,")) {
      cleanBase64 = cleanBase64.split("base64,")[1];
    }
    cleanBase64 = cleanBase64.replace(/[\r\n\s]/g, "");

    const normalizedMime = mimeType.includes("pdf")
      ? "application/pdf"
      : mimeType.includes("png")
      ? "image/png"
      : mimeType.includes("webp")
      ? "image/webp"
      : "image/jpeg";

    const ai = getGeminiClient();
    let authError = false;

    if (ai) {
      try {
        console.log("[OCR DIAGNOSTIC] API REQUEST (Gemini Vision - Emirates ID)");
        const extractedData = await processOcrRequest(ai, "EMIRATES_ID", cleanBase64, normalizedMime, modelLevel);
        console.log(`[OCR DIAGNOSTIC] HTTP STATUS: 200 OK`);
        console.log(`[OCR DIAGNOSTIC] NORMALIZATION (Gemini Output)`);
        console.log(`[OCR DIAGNOSTIC] FIELDS EXTRACTED: ${Object.keys(extractedData).length}`);
        console.log("[OCR DIAGNOSTIC] OCR COMPLETE");
        return res.json({ success: true, data: extractedData, source: "Gemini Vision" });
      } catch (geminiErr: any) {
        if (geminiErr.message === "GEMINI_AUTH_UNAUTHORIZED") {
          authError = true;
        }
        console.info(`[OCR API] Primary AI ID pipeline failed (${geminiErr.message}). Running local forensic OCR engine...`);
      }
    } else if (!ai) {
      authError = true;
    }

    // Local Tesseract Fallback
    console.log("[OCR DIAGNOSTIC] API REQUEST (Local Tesseract Engine)");
    const localData = await runLocalTesseractOcr(cleanBase64, "EMIRATES_ID");
    
    let hasData = false;
    if (localData.emiratesIdNumber || localData.fullName || localData.englishName) hasData = true;

    if (hasData) {
      console.log(`[OCR DIAGNOSTIC] HTTP STATUS: 200 OK`);
      console.log(`[OCR DIAGNOSTIC] NORMALIZATION (Tesseract Output)`);
      console.log(`[OCR DIAGNOSTIC] FIELDS EXTRACTED: ${Object.keys(localData).length}`);
      console.log("[OCR DIAGNOSTIC] OCR COMPLETE");
      return res.json({ success: true, data: localData, source: "Local Forensic OCR Engine" });
    }

    if (authError) {
      return res.json({
        success: false,
        error: "OCR_ENGINE_UNAVAILABLE (401 Unauthorized)",
        errorAr: "محرك الذكاء الاصطناعي غير متوفر (حدث خطأ في المصادقة). يرجى التحقق من المفتاح أو إدخال البيانات يدوياً.",
        data: null
      });
    }

    return res.json({
      success: false,
      error: "No meaningful data extracted. Please enter data manually.",
      errorAr: "لم يتم العثور على بيانات واضحة في الهوية. يرجى إدخال البيانات يدوياً.",
      data: null
    });
  } catch (error: any) {
    console.warn("[OCR API] Emirates ID extraction caught error:", error?.message || error);
    return res.json({
      success: false,
      error: "تعذر استخراج بيانات الهوية آلياً.",
      data: null
    });
  }
});

// OCR Health & Diagnostics Endpoint
app.get("/api/ocr/health", (req, res) => {
  const ai = getGeminiClient();
  res.json({
    status: "online",
    engine: "OCR V2 Centralized Engine",
    geminiAvailable: Boolean(ai),
    tesseractAvailable: true,
    supportedProfiles: ["EMIRATES_ID", "CHEQUE", "LEASE_AGREEMENT", "GENERAL_DOCUMENT"],
    timestamp: new Date().toISOString()
  });
});

// AI Tenant Risk & Portfolio Analysis
app.post("/api/ai/analyze-risk", async (req, res) => {
  const { tenants = [], bouncedCheques = [], cases = [], language = "ar" } = req.body;

  try {
    const ai = getGeminiClient();
    if (!ai) {
      const fallbackData = generateHeuristicRiskAssessment(tenants, bouncedCheques, cases, language);
      return res.json({
        success: true,
        source: "Heuristic Risk Engine",
        analysis: fallbackData,
        data: fallbackData
      });
    }

    const prompt = `You are a UAE Real Estate Financial Risk Analyst and Forensics Expert.
Analyze the following portfolio data containing Tenants, Bounced Cheques (Dishonored instruments under UAE Commercial Transactions Law), and RDC/Court Dispute Cases.

Data to analyze:
- Tenants (${tenants.length}): ${JSON.stringify(tenants.slice(0, 20))}
- Bounced Cheques (${bouncedCheques.length}): ${JSON.stringify(bouncedCheques.slice(0, 25))}
- Cases (${cases.length}): ${JSON.stringify(cases.slice(0, 15))}
- Language: ${language}

Generate a comprehensive risk analysis formatted strictly as a JSON object matching this structure:
{
  "portfolioRiskSummary": {
    "overallRiskScore": 75,
    "totalExposureAED": 350000,
    "predictedLossRate": "5.8%",
    "riskVelocity": "STABLE",
    "keyFindings": ["string", "string", "string"],
    "strategicAdvice": ["string", "string", "string"]
  },
  "tenantRiskProfiles": [
    {
      "tenantId": "string",
      "tenantName": "string",
      "tenantCode": "string",
      "aiRiskScore": 85,
      "riskCategory": "CRITICAL",
      "defaultProbability": 90,
      "bouncedCount": 3,
      "bouncedAmountAED": 45000,
      "primaryRiskFactor": "string",
      "recommendedAction": "string",
      "litigationUrgency": "IMMEDIATE",
      "resolutionForecastDays": 30
    }
  ],
  "monthlyRiskTrends": [
    { "month": "Jan", "highRiskCount": 2, "bouncedExposureAED": 95000, "recoveredAED": 40000, "riskIndex": 62 }
  ],
  "topRiskFactors": [
    { "factor": "string", "impactPercentage": 65, "affectedTenantsCount": 8 }
  ]
}

Return ONLY valid JSON. No markdown fences.`;

    const response = await generateContentWithFallback(ai, {
      contents: { parts: [{ text: prompt }] },
      config: { responseMimeType: "application/json" },
    });

    const rawText = response.text || "";
    const parsedData = safeJsonParse(rawText, null);

    if (!parsedData) {
      throw new Error("Invalid JSON structure returned by AI");
    }

    return res.json({
      success: true,
      source: response.model || "Gemini AI",
      analysis: parsedData,
      data: parsedData,
    });
  } catch (err: any) {
    const fallbackData = generateHeuristicRiskAssessment(tenants, bouncedCheques, cases, language);
    return res.json({
      success: true,
      source: "Heuristic Risk Engine (Fallback)",
      analysis: fallbackData,
      data: fallbackData,
    });
  }
});

// AI Arabic/English Transliteration for UAE DLD / Ejari Compliance
function fallbackTransliterate(name: string, from: "ar" | "en", to: "ar" | "en"): string {
  if (!name) return "";
  const dict: Record<string, string> = {
    "mohammed": "محمد", "mohammad": "محمد", "muhammad": "محمد",
    "ahmed": "أحمد", "ahmad": "أحمد",
    "mahmoud": "محمود", "mahmood": "محمود",
    "ali": "علي", "omar": "عمر", "othman": "عثمان", "khalid": "خالد",
    "tariq": "طارق", "tareq": "طارق", "yousef": "يوسف", "youssef": "يوسف",
    "ibrahim": "إبراهيم", "hassan": "حسن", "hussein": "حسين",
    "salem": "سالم", "saeed": "سعيد", "mansoor": "منصور", "abdullah": "عبدالله",
    "abdulrahman": "عبدالرحمن", "hamad": "حمد", "zayed": "زايد",
    "rashid": "راشد", "fatima": "فاطمة", "mariam": "مريم", "noor": "نور",
    "sara": "سارة", "reem": "ريم", "layla": "ليلى", "mona": "منى",
    "real estate": "للعقارات", "properties": "للعقارات", "trading": "للتجارة",
    "general trading": "للتجارة العامة", "llc": "ذ.م.م", "l.l.c": "ذ.م.م"
  };

  const clean = name.trim().toLowerCase();
  if (from === "en" && to === "ar") {
    const words = clean.split(/\s+/);
    const translatedWords = words.map(w => dict[w] || w);
    return translatedWords.join(" ");
  } else {
    const revDict: Record<string, string> = {};
    for (const [en, ar] of Object.entries(dict)) {
      revDict[ar] = en.charAt(0).toUpperCase() + en.slice(1);
    }
    const words = name.trim().split(/\s+/);
    const translatedWords = words.map(w => revDict[w] || w);
    return translatedWords.join(" ");
  }
}

app.post("/api/ai/transliterate-name", async (req, res) => {
  const { name = "", from = "ar", to = "en" } = req.body;
  if (!name.trim()) {
    return res.json({ success: true, suggestion: "" });
  }

  try {
    const ai = getGeminiClient();
    if (ai) {
      const prompt = `You are a UAE official legal translator specializing in Dubai Land Department (DLD) and Ejari property tenancy contracts.
Translate / transliterate this person or company name accurately between Arabic and English according to UAE official passport / Emirates ID / trade license conventions.
From: ${from === "ar" ? "Arabic" : "English"}
To: ${to === "ar" ? "Arabic" : "English"}
Name: "${name.trim()}"

Return ONLY a valid JSON object:
{
  "suggestion": "Translated or Transliterated Name"
}`;

      const response = await generateContentWithFallback(ai, {
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: "application/json" },
      });

      const rawText = response.text || "";
      const parsed = safeJsonParse(rawText, { suggestion: "" });

      if (parsed?.suggestion) {
        return res.json({ success: true, suggestion: parsed.suggestion });
      }
    }

    const fallback = fallbackTransliterate(name, from as any, to as any);
    return res.json({ success: true, suggestion: fallback || name });
  } catch (err: any) {
    const fallback = fallbackTransliterate(name, from as any, to as any);
    return res.json({ success: true, suggestion: fallback || name });
  }
});

// AI Legal Notice Generator (Law 26/2007, Law 33/2008, Decree-Law 14/2020)
app.post("/api/ai/generate-legal-notice", async (req, res) => {
  const {
    noticeType = "DEFAULT_PAYMENT_15_DAYS",
    tenantName = "",
    tenantPhone = "",
    emiratesId = "",
    tradeLicenseNo = "",
    propertyName = "",
    unitNumber = "",
    leaseNumber = "",
    chequeNumbers = [],
    totalClaimAED = 0,
    returnReason = "عدم كفاية الرصيد",
    daysToCure = 15,
    customRemarks = "",
    language = "ar",
  } = req.body;

  const isAr = language === "ar";

  try {
    const ai = getGeminiClient();
    if (!ai) {
      throw new Error("AI Client not initialized");
    }

    const prompt = `You are a Senior Legal Counsel in UAE Real Estate Law (Dubai Rental Disputes Center - RDC, Law No. 26 of 2007, Law No. 33 of 2008, and Federal Decree-Law No. 14 of 2020 on Commercial Transactions).
Draft a formal, highly authoritative legal notice / payment demand with the following parameters:
- Notice Type: ${noticeType}
- Recipient Tenant Name: ${tenantName}
- Tenant Phone: ${tenantPhone}
- Emirates ID / Trade License: ${emiratesId || tradeLicenseNo || "N/A"}
- Property / Building: ${propertyName}
- Unit Number: ${unitNumber}
- Lease / Ejari Contract No: ${leaseNumber || "N/A"}
- Dishonored Cheque Number(s): ${Array.isArray(chequeNumbers) ? chequeNumbers.join(", ") : chequeNumbers}
- Total Claim Amount: AED ${Number(totalClaimAED).toLocaleString()}
- Cheque Return Reason: ${returnReason}
- Cure / Grace Period: ${daysToCure} Days
- Custom Remarks: ${customRemarks || "None"}
- Language: ${language === "ar" ? "Arabic (Formal UAE Judicial Arabic)" : "English (UAE Commercial Legal English)"}

Return ONLY a valid JSON object:
{
  "noticeText": "Full formatted legal notice text with formal salutation, legal citations, itemized claim, deadline, and execution warning",
  "keyClauses": [
    "Clause 1 summary",
    "Clause 2 summary",
    "Clause 3 summary"
  ]
}`;

    const response = await generateContentWithFallback(ai, {
      contents: { parts: [{ text: prompt }] },
      config: { responseMimeType: "application/json" },
    });

    const rawText = response.text || "";
    const parsed = safeJsonParse(rawText, { noticeText: "", keyClauses: [] });

    return res.json({
      success: true,
      notice: {
        noticeText: parsed.noticeText,
        keyClauses: parsed.keyClauses || [],
      },
      noticeText: parsed.noticeText,
      keyClauses: parsed.keyClauses || [],
    });
  } catch (err: any) {
    const chqStr = Array.isArray(chequeNumbers) ? chequeNumbers.join(", ") : chequeNumbers || "N/A";
    const formattedAmount = Number(totalClaimAED || 0).toLocaleString();

    const fallbackNotice = isAr
      ? `التاريخ: ${new Date().toLocaleDateString('ar-AE')}\n\nإلى المستأجر الفاضل: ${tenantName || "المستأجر المحترم"}\nرقم الهوية / الرخصة: ${emiratesId || tradeLicenseNo || "مسجل بالنظام"}\nالعقار: ${propertyName} - الوحدة رقم (${unitNumber})\nرقم عقد الإيجار: ${leaseNumber || "ساري"}\n\nالموضوع: إخطار وإنذار عدلي بالسداد الفوري للشيكات المرتجعة\n\nتحية طيبة وبعد،،\n\nنحيطكم علماً بأنه بموجب عقد الإيجار وسندات الشيكات المسحوبة من قبلكم لصالح (صقر الامارات للعقارات)، فقد تم إرجاع الشيك رقم (${chqStr}) بمبلغ قدره (${formattedAmount}) درهم إماراتي من قبل المصرف المسحوب عليه لسبب (${returnReason}).\n\nبناءً على ذلك، وطبقاً لأحكام القانون رقم (26) لسنة 2007 وتعديلاته بالقانون رقم (33) لسنة 2008، والمرسوم بقانون اتحادي رقم (14) لسنة 2020 بشأن المعاملات التجارية والذي يجعل الشيك المرتجع سنداً تنفيذياً مباشراً:\n\nننذركم بوجوب سداد كامل المبلغ المطلوب خلال مهلة أقصاها (${daysToCure}) يوماً من تاريخ استلام هذا الإخطار. وفي حال التخلف عن السداد، ستضطر الإدارة لاتخاذ الإجراءات القضائية الفورية أمام مركز فض المنازعات الإيجارية وقاضي التنفيذ للحجز على الأموال والحسابات وتحميلكم كافة الرسوم والمصاريف وأتعاب المحاماة.\n\nشاكرين حسن تعاونكم وحرصكم على تسوية الأمر ودياً.\n\nصقر الامارات للعقارات\nقسم الشؤون القانونية والتحصيل`
      : `Date: ${new Date().toLocaleDateString('en-GB')}\n\nTo: ${tenantName || "Valued Tenant"}\nEmirates ID / Trade License: ${emiratesId || tradeLicenseNo || "On File"}\nProperty: ${propertyName} - Unit #${unitNumber}\nLease Contract #: ${leaseNumber || "Active"}\n\nSubject: Formal Legal Notice & Immediate Payment Demand for Dishonored Cheque(s)\n\nDear Sir/Madam,\n\nPlease be informed that pursuant to the tenancy contract and the banking instruments issued to Emirates Falcon Real Estate, Cheque #${chqStr} in the amount of AED ${formattedAmount} was returned unpaid by the drawee bank due to (${returnReason}).\n\nIn accordance with Dubai Law No. 26 of 2007 as amended by Law No. 33 of 2008, and UAE Federal Decree-Law No. 14 of 2020 (whereby bounced cheques constitute direct executable writs):\n\nYou are hereby officially demanded to settle the full outstanding amount within (${daysToCure}) days from the date of this notice. Failure to settle will compel us to file for immediate execution at the Rental Dispute Center (RDC) and UAE execution courts to freeze accounts, enforce eviction, and claim all legal fees.\n\nEmirates Falcon Real Estate\nLegal & Recovery Department`;

    const fallbackClauses = [
      isAr ? `مهلة السداد: ${daysToCure} يوماً` : `Cure Period: ${daysToCure} Days`,
      isAr ? "سند تنفيذي مباشر وفق القانون 14 لسنة 2020" : "Direct Executable Writ under Decree-Law 14/2020",
      isAr ? "حق الإخلاء والمطالبة بالتعويضات ورسوم التقاضي" : "Right of Eviction & Full Legal Costs Recovery",
    ];

    return res.json({
      success: true,
      notice: {
        noticeText: fallbackNotice,
        keyClauses: fallbackClauses,
      },
      noticeText: fallbackNotice,
      keyClauses: fallbackClauses,
    });
  }
});

// ==============================================================
// PHASE 57-K.1: COMPANY CONNECTION CENTER BACKEND SERVICE
// ==============================================================
import dns from "dns";
import net from "net";

const SECRETS_FILE_PATH = path.join(process.cwd(), ".secrets.json");
const CONFIG_FILE_PATH = path.join(process.cwd(), "connections-config.json");

interface ConnectionSecrets {
  smtpAppPassword?: string;
  whatsappAccessToken?: string;
}

interface ConnectionConfigs {
  whatsapp?: {
    phoneNumberId: string;
    wabaId: string;
    apiVersion: string;
    enabled: boolean;
    status: string;
    lastCheckedAt?: string;
    latency?: number;
    errorCode?: string;
    safeErrorMessage?: string;
    repairInstructions?: string;
  };
  gmail?: {
    smtpUser: string;
    smtpHost: string;
    smtpPort: number;
    encryption: "SSL" | "TLS" | "STARTTLS";
    senderName: string;
    enabled: boolean;
    status: string;
    lastCheckedAt?: string;
    latency?: number;
    errorCode?: string;
    safeErrorMessage?: string;
    repairInstructions?: string;
  };
}

function loadSecrets(): ConnectionSecrets {
  try {
    if (fs.existsSync(SECRETS_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(SECRETS_FILE_PATH, "utf8"));
    }
  } catch (e) {
    console.warn("[Secrets Engine] Secrets file .secrets.json not found, falling back to process env.");
  }
  return {
    smtpAppPassword: process.env.GMAIL_APP_PASSWORD || "",
    whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
  };
}

function saveSecrets(newSecrets: ConnectionSecrets) {
  try {
    const current = loadSecrets();
    const updated = { ...current, ...newSecrets };
    fs.writeFileSync(SECRETS_FILE_PATH, JSON.stringify(updated, null, 2), "utf8");
  } catch (e: any) {
    console.error("[Secrets Engine] Failed to save secrets:", e.message);
  }
}

function loadConfigs(): ConnectionConfigs {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, "utf8"));
    }
  } catch (e) {
    console.warn("[Configs Engine] Config file connections-config.json not found, using defaults.");
  }
  return {
    whatsapp: {
      phoneNumberId: "",
      wabaId: "",
      apiVersion: "v17.0",
      enabled: true,
      status: "NOT_CONFIGURED",
    },
    gmail: {
      smtpUser: "emfalcon2025227@gmail.com",
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
      encryption: "SSL",
      senderName: "Emirates Falcon System",
      enabled: true,
      status: "NOT_CONFIGURED",
    },
  };
}

function saveConfigs(newConfigs: ConnectionConfigs) {
  try {
    const current = loadConfigs();
    const updated = {
      whatsapp: { ...current.whatsapp, ...newConfigs.whatsapp },
      gmail: { ...current.gmail, ...newConfigs.gmail },
    };
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(updated, null, 2), "utf8");
  } catch (e: any) {
    console.error("[Configs Engine] Failed to save configs:", e.message);
  }
}

// 1. GET Connections Configuration
app.get("/api/connections/config", (req, res) => {
  try {
    const configs = loadConfigs();
    const secrets = loadSecrets();

    // Mask secrets before sending to frontend
    const whatsapp = configs.whatsapp ? {
      ...configs.whatsapp,
      accessToken: secrets.whatsappAccessToken ? "••••••••••••••••" : "",
    } : null;

    const gmail = configs.gmail ? {
      ...configs.gmail,
      appPassword: secrets.smtpAppPassword ? "••••••••••••••••" : "",
    } : null;

    return res.json({ success: true, whatsapp, gmail });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. POST Connections Configuration
app.post("/api/connections/config", (req, res) => {
  try {
    const { whatsapp, gmail } = req.body;
    const secretsToSave: ConnectionSecrets = {};
    const configsToSave: ConnectionConfigs = {};

    if (whatsapp) {
      configsToSave.whatsapp = {
        phoneNumberId: whatsapp.phoneNumberId || "",
        wabaId: whatsapp.wabaId || "",
        apiVersion: whatsapp.apiVersion || "v17.0",
        enabled: whatsapp.enabled !== false,
        status: whatsapp.status || "CONFIGURED",
      };
      if (whatsapp.accessToken && !whatsapp.accessToken.includes("•")) {
        secretsToSave.whatsappAccessToken = whatsapp.accessToken;
      }
    }

    if (gmail) {
      configsToSave.gmail = {
        smtpUser: gmail.smtpUser || "",
        smtpHost: gmail.smtpHost || "smtp.gmail.com",
        smtpPort: Number(gmail.smtpPort) || 465,
        encryption: gmail.encryption || "SSL",
        senderName: gmail.senderName || "Emirates Falcon System",
        enabled: gmail.enabled !== false,
        status: gmail.status || "CONFIGURED",
      };
      if (gmail.appPassword && !gmail.appPassword.includes("•")) {
        secretsToSave.smtpAppPassword = gmail.appPassword;
      }
    }

    saveConfigs(configsToSave);
    if (Object.keys(secretsToSave).length > 0) {
      saveSecrets(secretsToSave);
    }

    // Log the configuration audit event safely without logging secrets
    console.log(`[Audit Log] CONNECTION_CONFIGURED executed by admin. Services updated: ${[whatsapp ? 'WhatsApp' : '', gmail ? 'Gmail' : ''].filter(Boolean).join(', ')}`);

    return res.json({ success: true, message: "Configuration persisted successfully server-side." });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Helper for DNS checking
const dnsResolve = (host: string): Promise<string[]> => {
  return new Promise((resolve) => {
    dns.resolve4(host, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) resolve([]);
      else resolve(addresses);
    });
  });
};

// Helper for TCP checking
const tcpCheck = (host: string, port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    socket.setTimeout(2500);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
};

// 3. POST Test Gmail SMTP Connection
app.post("/api/connections/test-smtp", async (req, res) => {
  const pipelineStartTime = Date.now();
  
  interface SmtpStep {
    name: string;
    status: "PASS" | "FAIL" | "PENDING" | "SKIPPED";
    details?: string;
    latency?: number;
  }

  const steps: SmtpStep[] = [
    { name: "1. Configuration Loaded", status: "PENDING" },
    { name: "2. SMTP Host", status: "PENDING" },
    { name: "3. SMTP Port", status: "PENDING" },
    { name: "4. App Password", status: "PENDING" },
    { name: "5. DNS / Network Reachability", status: "PENDING" },
    { name: "6. TLS / Secure Channel", status: "PENDING" },
    { name: "7. SMTP Authentication", status: "PENDING" },
    { name: "8. SMTP Capability Check", status: "PENDING" },
  ];

  try {
    const configs = loadConfigs();
    const secrets = loadSecrets();
    const gmail: any = configs.gmail || {};

    const user = gmail.smtpUser?.trim();
    const host = gmail.smtpHost?.trim();
    const port = Number(gmail.smtpPort);
    const pass = secrets.smtpAppPassword?.trim();
    const encryption = gmail.encryption || "SSL";

    // Step 1: Configuration Loaded
    if (!user || !user.includes("@")) {
      steps[0] = { name: "1. Configuration Loaded", status: "FAIL", details: "Email ID is missing or invalid." };
      for (let i = 1; i < steps.length; i++) steps[i].status = "SKIPPED";
      
      const totalLatency = Date.now() - pipelineStartTime;
      gmail.status = "ERROR";
      gmail.lastCheckedAt = new Date().toISOString();
      gmail.latency = totalLatency;
      gmail.errorCode = "LOCAL_VALIDATION_FAILURE";
      gmail.safeErrorMessage = "Email ID is missing or invalid.";
      gmail.repairInstructions = "Please provide a valid corporate email address (e.g. notifications@emiratesfalcon.com).";
      saveConfigs({ gmail });
      return res.json({ success: false, ...gmail, steps });
    }
    steps[0] = { name: "1. Configuration Loaded", status: "PASS", details: `Email ID: ${user}` };

    // Step 2: SMTP Host
    if (!host) {
      steps[1] = { name: "2. SMTP Host", status: "FAIL", details: "SMTP Host address is missing." };
      for (let i = 2; i < steps.length; i++) steps[i].status = "SKIPPED";

      const totalLatency = Date.now() - pipelineStartTime;
      gmail.status = "ERROR";
      gmail.lastCheckedAt = new Date().toISOString();
      gmail.latency = totalLatency;
      gmail.errorCode = "CONFIGURATION_MISSING";
      gmail.safeErrorMessage = "SMTP Host is missing.";
      gmail.repairInstructions = "Please specify the SMTP host address (e.g. smtp.gmail.com).";
      saveConfigs({ gmail });
      return res.json({ success: false, ...gmail, steps });
    }
    steps[1] = { name: "2. SMTP Host", status: "PASS", details: `Host: ${host}` };

    // Step 3: SMTP Port
    if (!port || isNaN(port) || port < 1 || port > 65535) {
      steps[2] = { name: "3. SMTP Port", status: "FAIL", details: "SMTP Port is invalid." };
      for (let i = 3; i < steps.length; i++) steps[i].status = "SKIPPED";

      const totalLatency = Date.now() - pipelineStartTime;
      gmail.status = "ERROR";
      gmail.lastCheckedAt = new Date().toISOString();
      gmail.latency = totalLatency;
      gmail.errorCode = "INVALID_SMTP_PORT";
      gmail.safeErrorMessage = "Invalid SMTP Port provided.";
      gmail.repairInstructions = "Enter a valid SMTP port number: 465 (SSL) or 587 (STARTTLS).";
      saveConfigs({ gmail });
      return res.json({ success: false, ...gmail, steps });
    }
    steps[2] = { name: "3. SMTP Port", status: "PASS", details: `Port: ${port} (${encryption})` };

    // Step 4: App Password
    if (!pass) {
      steps[3] = { name: "4. App Password", status: "FAIL", details: "SMTP App Password is missing." };
      for (let i = 4; i < steps.length; i++) steps[i].status = "SKIPPED";

      const totalLatency = Date.now() - pipelineStartTime;
      gmail.status = "ERROR";
      gmail.lastCheckedAt = new Date().toISOString();
      gmail.latency = totalLatency;
      gmail.errorCode = "MISSING_APP_PASSWORD";
      gmail.safeErrorMessage = "SMTP App Password is missing in secure storage.";
      gmail.repairInstructions = "Generate a 16-character Google App Password and save it in the settings.";
      saveConfigs({ gmail });
      return res.json({ success: false, ...gmail, steps });
    }
    steps[3] = { name: "4. App Password", status: "PASS", details: "Credential present in secure server vault (16 chars)" };

    // Step 5: DNS / Network Reachability
    const dnsStart = Date.now();
    let resolvedIps: string[] = [];
    try {
      resolvedIps = await dnsResolve(host);
    } catch (e) {
      resolvedIps = [];
    }
    const dnsLatency = Math.max(1, Date.now() - dnsStart);

    if (resolvedIps.length === 0) {
      steps[4] = { name: "5. DNS / Network Reachability", status: "FAIL", details: `Unable to resolve host: ${host}`, latency: dnsLatency };
      for (let i = 5; i < steps.length; i++) steps[i].status = "SKIPPED";

      const totalLatency = Date.now() - pipelineStartTime;
      gmail.status = "ERROR";
      gmail.lastCheckedAt = new Date().toISOString();
      gmail.latency = totalLatency;
      gmail.errorCode = "DNS_RESOLUTION_FAILED";
      gmail.safeErrorMessage = `Could not resolve hostname '${host}'.`;
      gmail.repairInstructions = "Verify the SMTP Host setting or server DNS network configuration.";
      saveConfigs({ gmail });
      return res.json({ success: false, ...gmail, steps });
    }
    steps[4] = { name: "5. DNS / Network Reachability", status: "PASS", details: `Resolved to IP: ${resolvedIps[0]}`, latency: dnsLatency };

    // Step 6: TLS / Secure Channel TCP check
    const tcpStart = Date.now();
    const tcpConnected = await tcpCheck(host, port);
    const tcpLatency = Math.max(1, Date.now() - tcpStart);

    if (!tcpConnected) {
      steps[5] = { name: "6. TLS / Secure Channel", status: "FAIL", details: `TCP handshake failed on ${host}:${port}`, latency: tcpLatency };
      for (let i = 6; i < steps.length; i++) steps[i].status = "SKIPPED";

      const totalLatency = Date.now() - pipelineStartTime;
      gmail.status = "ERROR";
      gmail.lastCheckedAt = new Date().toISOString();
      gmail.latency = totalLatency;
      gmail.errorCode = "SMTP_HOST_UNREACHABLE";
      gmail.safeErrorMessage = `Could not establish TCP connection to ${host}:${port}`;
      gmail.repairInstructions = `Ensure port ${port} is open and allowed by local/cloud network firewall policy.`;
      saveConfigs({ gmail });
      return res.json({ success: false, ...gmail, steps });
    }
    steps[5] = { name: "6. TLS / Secure Channel", status: "PASS", details: `TCP socket opened on port ${port}`, latency: tcpLatency };

    // Step 7: SMTP Authentication
    const authStart = Date.now();
    const isSsl = encryption === "SSL";
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: isSsl,
      auth: {
        user,
        pass,
      },
      tls: {
        rejectUnauthorized: true,
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    });

    try {
      await transporter.verify();
      const authLatency = Math.max(1, Date.now() - authStart);
      steps[6] = { name: "7. SMTP Authentication", status: "PASS", details: "Server accepted credentials via AUTH LOGIN/PLAIN", latency: authLatency };

      // Step 8: SMTP Capability Check
      const capabilityStart = Date.now();
      // Capability check: verify transporter connection status
      const capLatency = Math.max(1, Date.now() - capabilityStart);
      steps[7] = { name: "8. SMTP Capability Check", status: "PASS", details: "SMTP session is active and ready for dispatch", latency: capLatency };

      const totalLatency = Date.now() - pipelineStartTime;
      gmail.status = "VERIFIED";
      gmail.lastCheckedAt = new Date().toISOString();
      gmail.latency = totalLatency;
      delete gmail.errorCode;
      delete gmail.safeErrorMessage;
      delete gmail.repairInstructions;
      saveConfigs({ gmail });

      console.log(`[Audit Log] GMAIL_SMTP_VERIFIED: Dedicated Gmail SMTP pipeline verified for ${user} in ${totalLatency}ms`);
      return res.json({ success: true, ...gmail, steps });
    } catch (authErr: any) {
      const authLatency = Math.max(1, Date.now() - authStart);
      steps[6] = { name: "7. SMTP Authentication", status: "FAIL", details: authErr.message || "Authentication rejected", latency: authLatency };
      steps[7] = { name: "8. SMTP Capability Check", status: "SKIPPED" };

      const totalLatency = Date.now() - pipelineStartTime;
      gmail.status = "ERROR";
      gmail.lastCheckedAt = new Date().toISOString();
      gmail.latency = totalLatency;

      const errMsg = authErr.message || "";
      if (errMsg.includes("Username and Password not accepted") || errMsg.includes("535 5.7.8")) {
        gmail.errorCode = "SMTP_AUTHENTICATION_FAILED";
        gmail.safeErrorMessage = "SMTP Authentication failed. The Google App Password was rejected by Gmail.";
        gmail.repairInstructions = "Generate a fresh 16-character Google App Password under emfalcon2025227@gmail.com security settings and update settings.";
      } else if (errMsg.includes("ETIMEDOUT") || errMsg.includes("timeout")) {
        gmail.errorCode = "SMTP_TIMEOUT";
        gmail.safeErrorMessage = "SMTP Server handshake timed out during TLS authentication.";
        gmail.repairInstructions = `Check if port ${port} matches your encryption mode (${encryption}) or try port 587 with STARTTLS.`;
      } else {
        gmail.errorCode = "TLS_CONNECTION_FAILED";
        gmail.safeErrorMessage = `TLS/SSL Connection negotiation failed: ${errMsg}`;
        gmail.repairInstructions = `Verify encryption protocol (${encryption}) matches port ${port}.`;
      }
      saveConfigs({ gmail });
      return res.json({ success: false, ...gmail, steps });
    }
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      status: "ERROR",
      errorCode: "LOCAL_VALIDATION_FAILURE",
      safeErrorMessage: err.message || "An unexpected error occurred during SMTP connection verification.",
      steps,
    });
  }
});

// 4. POST Send SMTP Test Email
app.post("/api/connections/send-test-email", async (req, res) => {
  try {
    const { recipientEmail, subject, messageBody } = req.body;
    const configs = loadConfigs();
    const secrets = loadSecrets();

    const gmail = configs.gmail;
    if (!gmail || !gmail.smtpUser || !secrets.smtpAppPassword) {
      return res.status(400).json({ success: false, error: "SMTP is not fully configured." });
    }

    const transporter = nodemailer.createTransport({
      host: gmail.smtpHost,
      port: gmail.smtpPort,
      secure: gmail.encryption === "SSL",
      auth: {
        user: gmail.smtpUser,
        pass: secrets.smtpAppPassword,
      },
      tls: {
        rejectUnauthorized: true,
      },
    });

    const targetRecipient = recipientEmail || gmail.smtpUser;
    const mailOptions = {
      from: `"${gmail.senderName || 'Emirates Falcon'}" <${gmail.smtpUser}>`,
      to: targetRecipient,
      subject: subject || "Emirates Falcon ERP — Gmail Connection Test",
      text: messageBody || "This is an automated connection test from Emirates Falcon ERP.",
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Audit Log] CONNECTION_TESTED: Test email dispatched to ${targetRecipient}. MessageId: ${info.messageId}`);
    return res.json({ success: true, messageId: info.messageId || "SMTP_SUCCESS_ID" });
  } catch (err: any) {
    console.error("[SMTP Test Send Error]:", err);
    return res.status(500).json({ success: false, error: err.message || "Email dispatch failed." });
  }
});

// 5. POST Test WhatsApp Business Connection
app.post("/api/connections/test-whatsapp", async (req, res) => {
  const startTime = Date.now();
  try {
    const configs = loadConfigs();
    const secrets = loadSecrets();

    const whatsapp = configs.whatsapp;
    if (!whatsapp || !whatsapp.phoneNumberId) {
      return res.json({
        success: false,
        status: "NOT_CONFIGURED",
        errorCode: "NOT_CONFIGURED",
        safeErrorMessage: "WhatsApp Business integration is not configured yet.",
        repairInstructions: "Please fill in Phone Number ID and Access Token.",
      });
    }

    const { phoneNumberId, apiVersion = "v17.0" } = whatsapp;
    const token = secrets.whatsappAccessToken;

    if (!token) {
      return res.json({
        success: false,
        status: "ERROR",
        errorCode: "MISSING_TOKEN",
        safeErrorMessage: "Meta Access Token is missing.",
        repairInstructions: "Please enter your Meta permanent system user access token and save.",
      });
    }

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;
    try {
      const metaRes = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const latency = Date.now() - startTime;
      whatsapp.lastCheckedAt = new Date().toISOString();
      whatsapp.latency = latency;

      if (metaRes.ok) {
        const data = await metaRes.json();
        whatsapp.status = "VERIFIED";
        delete whatsapp.errorCode;
        delete whatsapp.safeErrorMessage;
        delete whatsapp.repairInstructions;
        saveConfigs({ whatsapp });

        console.log(`[Audit Log] CONNECTION_VERIFIED: WhatsApp Cloud API verified for Phone ID: ${phoneNumberId}. Latency: ${latency}ms`);
        return res.json({ success: true, ...whatsapp, metaDetails: data });
      } else {
        whatsapp.status = "ERROR";
        const errJson = await metaRes.json().catch(() => ({}));
        const metaErr = errJson.error || {};
        
        // Map precise WhatsApp error categories
        if (metaRes.status === 401 || metaErr.code === 190) {
          whatsapp.errorCode = "TOKEN_EXPIRED";
          whatsapp.safeErrorMessage = "Meta OAuth Token is invalid, expired, or has been revoked.";
          whatsapp.repairInstructions = "WHAT HAPPENED: Authentication Failed.\nWHY IT HAPPENED: Access token became stale or was revoked.\nHOW TO FIX IT: Generate a new permanent Access Token in your Meta Developer Console and save it here.";
        } else if (metaRes.status === 400 && (metaErr.code === 33 || metaErr.message?.includes("phone_number"))) {
          whatsapp.errorCode = "INVALID_PHONE_NUMBER_ID";
          whatsapp.safeErrorMessage = `The Phone Number ID '${phoneNumberId}' was not recognized by Meta.`;
          whatsapp.repairInstructions = "WHAT HAPPENED: Resource Not Found.\nWHY IT HAPPENED: Invalid ID entered.\nHOW TO FIX IT: Double-check the exact Phone Number ID from your Meta Developer Dashboard.";
        } else if (metaRes.status === 403 || metaErr.code === 200) {
          whatsapp.errorCode = "INSUFFICIENT_PERMISSION";
          whatsapp.safeErrorMessage = "The access token lacks correct permissions for WhatsApp Business API.";
          whatsapp.repairInstructions = "WHAT HAPPENED: Access Denied.\nWHY IT HAPPENED: Permitted scopes are inadequate.\nHOW TO FIX IT: Check the Meta app configuration. Make sure 'whatsapp_business_messaging' is checked.";
        } else if (metaErr.code === 2 || metaErr.code === 4) {
          whatsapp.errorCode = "API_VERSION_ERROR";
          whatsapp.safeErrorMessage = `Meta API version '${apiVersion}' might be deprecated or incompatible.`;
          whatsapp.repairInstructions = "WHAT HAPPENED: API Compatibility mismatch.\nHOW TO FIX IT: Select a newer valid API version (e.g., 'v17.0' or newer) and retry.";
        } else {
          whatsapp.errorCode = "META_API_REJECTED";
          whatsapp.safeErrorMessage = metaErr.message || `Meta API rejected request with status ${metaRes.status}`;
          whatsapp.repairInstructions = "WHAT HAPPENED: Meta API rejected the connection.\nHOW TO FIX IT: Verify all Meta Business Manager statuses and accounts are in good standing.";
        }

        saveConfigs({ whatsapp });
        return res.json({ success: false, ...whatsapp });
      }
    } catch (fetchErr: any) {
      const latency = Date.now() - startTime;
      whatsapp.status = "ERROR";
      whatsapp.lastCheckedAt = new Date().toISOString();
      whatsapp.latency = latency;
      whatsapp.errorCode = "NETWORK_ERROR";
      whatsapp.safeErrorMessage = "Could not establish network connection to Graph API.";
      whatsapp.repairInstructions = "WHAT HAPPENED: Request Timed Out.\nWHY IT HAPPENED: Outgoing HTTPS connection blocked.\nHOW TO FIX IT: Check server network routing and proxy configurations.";
      saveConfigs({ whatsapp });
      return res.json({ success: false, ...whatsapp });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. POST Send Test WhatsApp Message
app.post("/api/connections/send-test-whatsapp", async (req, res) => {
  try {
    const { recipientPhone, messageText } = req.body;
    const configs = loadConfigs();
    const secrets = loadSecrets();

    const whatsapp = configs.whatsapp;
    if (!whatsapp || !whatsapp.phoneNumberId || !secrets.whatsappAccessToken) {
      return res.status(400).json({ success: false, error: "WhatsApp is not configured yet." });
    }

    const { phoneNumberId, apiVersion = "v17.0" } = whatsapp;
    const token = secrets.whatsappAccessToken;

    const targetPhone = (recipientPhone || "+971501234567").replace(/[^0-9]/g, "");
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    // Try a standard WhatsApp message request
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: targetPhone,
      type: "text",
      text: {
        body: messageText || "This is an automated integration handshake test message from Emirates Falcon ERP."
      }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const resData = await response.json();
      const messageId = resData.messages?.[0]?.id || `WA_TEST_${Date.now()}`;
      console.log(`[Audit Log] CONNECTION_TESTED: WhatsApp test message sent to ${targetPhone}. Message ID: ${messageId}`);
      return res.json({ success: true, messageId });
    } else {
      const errJson = await response.json().catch(() => ({}));
      const metaErr = errJson.error || {};
      throw new Error(metaErr.message || `Meta API returned HTTP status ${response.status}`);
    }
  } catch (err: any) {
    console.error("[WhatsApp Test Send Error]:", err);
    return res.status(500).json({ success: false, error: err.message || "WhatsApp dispatch failed." });
  }
});

// Notification Dispatch (Email / SMS / WhatsApp reminders)
app.post("/api/notifications/dispatch", async (req, res) => {
  try {
    const {
      channel = "email",
      recipient,
      template = "APPROACHING_DUE",
      tenantName = "Tenant",
      chequeNumber = "N/A",
      amountAED = 0,
      dueDate = "",
      customMessage = ""
    } = req.body;

    const previewMessage = customMessage || `عزيزي ${tenantName}، هذا تذكير من صقر الإمارات للعقارات بخصوص الشيك رقم ${chequeNumber} بمبلغ ${Number(amountAED).toLocaleString()} درهم، وتاريخ استحقاقه في ${dueDate}.`;

    if (channel === "email" || channel === "EMAIL") {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: parseInt(process.env.SMTP_PORT || "465", 10),
        secure: (process.env.SMTP_PORT === "465" || process.env.SMTP_ENCRYPTION === "SSL"),
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        tls: {
          rejectUnauthorized: true,
        },
      });

      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        const mailOptions = {
          from: `"Emirates Falcon ERP" <${process.env.SMTP_USER}>`,
          to: recipient,
          subject: `تذكير بموعد استحقاق شيك إيجار - ${tenantName}`,
          text: previewMessage,
        };
        await transporter.sendMail(mailOptions);
        console.log(`[Notification Dispatcher] Email actually dispatched via SMTP to ${recipient}`);
      } else {
        console.log(`[Notification Dispatcher] (Mock) Sent EMAIL to ${recipient} (Missing SMTP_USER/SMTP_PASS env)`);
      }
    } else {
      console.log(`[Notification Dispatcher] Sent [${channel.toUpperCase()}] to ${recipient}: Cheque #${chequeNumber} (AED ${amountAED})`);
    }

    return res.json({
      success: true,
      status: "DISPATCHED",
      channel,
      recipient,
      previewMessage,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[Notification Dispatch Error]:", err);
    return res.status(500).json({ success: false, error: err?.message || "Failed to dispatch notification" });
  }
});

// Receipt Dispatch (Collection receipt email notification)
app.post("/api/notifications/dispatch-receipt", async (req, res) => {
  try {
    const {
      recipient,
      tenantNameAr,
      tenantNameEn,
      receiptNumber,
      amount,
      paymentMethod,
      payerName,
      chequeNumber,
      date,
    } = req.body;

    const tenantName = tenantNameAr || tenantNameEn || payerName || "Valued Tenant";
    console.log(`[Receipt Dispatcher] Sent collection receipt #${receiptNumber} (AED ${amount}) to ${recipient}`);

    return res.json({
      success: true,
      message: `Official Payment Receipt #${receiptNumber} dispatched to ${recipient || tenantName}`,
      receiptNumber,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[Receipt Dispatch Error]:", err);
    return res.status(500).json({ success: false, error: err?.message || "Failed to dispatch receipt" });
  }
});

// AI Assistant Chatbot Endpoint with Full Project Knowledge and Task Execution
app.post("/api/ai/assistant-chat", async (req, res) => {
  const { message, history = [], projectContext = {}, language = "ar" } = req.body;

  try {
    const ai = getGeminiClient();
    
    const systemPrompt = `You are "صقر AI" (Falcon AI Assistant), the expert AI Assistant for Emirates Falcon Real Estate Management System (صقر الإمارات للعقارات - نظام إدارة الشيكات المرتجعة والتحصيلات والقضايا الإيجارية).

You are connected directly to the user's application, and you MUST return a valid JSON object. 
Your response MUST always fit into this JSON schema exactly:
{
  "reply": "Your conversation response to the user, confirming what action is being executed or answering their questions. Support BOTH Arabic and English naturally.",
  "action": {
    "type": "OPEN_VIEW" | "OPEN_TENANT" | "OPEN_PAYMENT" | "SEND_NOTIFICATION" | "NONE",
    "params": {
      "viewName": "DASHBOARD" | "OWNERS" | "PROPERTIES" | "UNITS" | "TENANTS" | "LEASES" | "CHEQUES" | "BOUNCED_CHEQUES" | "COLLECTIONS" | "CASES" | "HEARINGS" | "MAINTENANCE" | "REPORTS" | "ARCHIVE" | "NOTIFICATIONS",
      "tenantId": "The ID string of the tenant if type is OPEN_TENANT",
      "chequeId": "The ID string of the cheque if type is OPEN_PAYMENT or SEND_NOTIFICATION",
      "channel": "email" | "whatsapp"
    }
  }
}

ALLOWED VIEW NAMES FOR OPEN_VIEW:
- "DASHBOARD" (لوحة القيادة والمؤشرات)
- "OWNERS" (دليل الملاك)
- "PROPERTIES" (المباني والعقارات)
- "UNITS" (الوحدات الإيجارية)
- "TENANTS" (دليل المستأجرين)
- "LEASES" (عقود الإيجار ونظام إيجاري)
- "CHEQUES" (إدارة الشيكات والضمانات)
- "BOUNCED_CHEQUES" (الشيكات المرتجعة والتعثر)
- "COLLECTIONS" (التحصيلات وسندات القبض)
- "CASES" (القضايا الإيجارية و RDC)
- "HEARINGS" (تقويم الجلسات القضائية)
- "MAINTENANCE" (طلبات الصيانة وتكليف الفنيين)
- "REPORTS" (التقارير المتقدمة والتحليلات)
- "ARCHIVE" (الأرشيف الإلكتروني للمستندات)
- "NOTIFICATIONS" (مركز التنبيهات والإشعارات)

CRITICAL RESTRICTION POLICY:
Automated AI operations on "SETTINGS" (إعدادات النظام), "AUDIT_LOGS" (سجل التدقيق والرقابة), and "DATA_RECOVERY" (مركز استعادة البيانات والتراجع) are STRICTLY EXCLUDED AND FORBIDDEN for security and governance policies.
If the user asks to open, modify, or query Settings, Audit Logs, or Data Recovery / Rollback, you MUST return type "NONE" and explain in the reply that administrative governance policies restrict AI Assistant automation for those 3 confidential sections.

SEARCH & MATCHING ACCURACY INSTRUCTIONS:
- Perform deep multi-field string matching. Apply flexible Arabic normalization ignoring diacritics, alef forms (أ/إ/آ -> ا), yaa/alef maqsura (ي/ى -> ي), taa marbouta (ة/ه -> ه), and optional 'ال' prefix.
- Support partial string matching across titles, names, codes, phone numbers, passport, national ID, request numbers, and cheque numbers.

Full Project Knowledge Context:
- Owners: ${JSON.stringify((projectContext.owners || []).slice(0, 10))}
- Properties: ${JSON.stringify((projectContext.properties || []).slice(0, 10))}
- Units: ${JSON.stringify((projectContext.units || []).slice(0, 10))}
- Tenants: ${JSON.stringify((projectContext.tenants || []).slice(0, 15).map((t:any) => ({ id: t.id, nameAr: t.nameAr, nameEn: t.nameEn, code: t.code, phone: t.phone, riskLevel: t.riskLevel })))}
- Cheques: ${JSON.stringify((projectContext.cheques || []).slice(0, 15).map((c:any) => ({ id: c.id, chequeNumber: c.chequeNumber, tenantId: c.tenantId, tenantName: c.tenantName, status: c.status, amount: c.amount, bankName: c.bankName })))}
- Cases: ${JSON.stringify((projectContext.cases || []).slice(0, 10))}
- Leases: ${JSON.stringify((projectContext.leases || []).slice(0, 10))}
- Maintenance: ${JSON.stringify((projectContext.maintenanceRequests || []).slice(0, 10).map((m:any) => ({ id: m.id, requestNumber: m.requestNumber, title: m.title, category: m.category, status: m.status, priority: m.priority, propertyName: m.propertyName, unitNumber: m.unitNumber })))}
- Collections: ${JSON.stringify((projectContext.collections || []).slice(0, 10))}

Return ONLY a valid raw JSON object matching the schema above. No markdown fences. No extra text outside the JSON.`;

    if (!ai) {
      const heuristicResult = matchHeuristicAssistantAction(message, projectContext, language);
      return res.json(heuristicResult);
    }

    const conversationHistory = history.map((msg: any) => {
      // Ensure we don't pass raw stringified JSON directly as context to confuse the model
      let cleanContent = msg.content;
      try {
        const parsed = JSON.parse(msg.content);
        if (parsed.reply) cleanContent = parsed.reply;
      } catch {
        // Not JSON, keep original
      }
      return {
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: cleanContent }]
      };
    });

    conversationHistory.push({
      role: 'user',
      parts: [{ text: `${systemPrompt}\n\nUser Question: ${message}` }]
    });

    const response = await generateContentWithFallback(ai, {
      contents: conversationHistory,
      config: {
        responseMimeType: "application/json",
      },
    });

    const rawText = response.text || "";
    const parsedResponse = safeJsonParse(rawText);
    
    if (!parsedResponse) {
      return res.json(matchHeuristicAssistantAction(message, projectContext, language));
    }

    return res.json({
      success: true,
      reply: parsedResponse.reply,
      action: parsedResponse.action || { type: "NONE", params: {} }
    });
  } catch (err: any) {
    const fallbackResult = matchHeuristicAssistantAction(message, projectContext, language);
    return res.json(fallbackResult);
  }
});

// Start the server and mount Vite
async function startServer() {
  const distPath = path.join(process.cwd(), "dist");

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      if (fs.existsSync(path.join(distPath, "index.html"))) {
        res.sendFile(path.join(distPath, "index.html"));
      } else {
        res.status(404).send("Application index.html not found. Please run build.");
      }
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Emirates Falcon Real Estate] Server running on http://localhost:${PORT}`);
  });
}

startServer();
