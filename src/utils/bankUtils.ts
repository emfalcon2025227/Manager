import { UAE_BANKS, UaeBank } from "../data/uaeBanks";

const CUSTOM_BANKS_STORAGE_KEY = "emirates_falcon_custom_uae_banks_v1";

/**
 * Normalizes a bank name for exact duplicate comparison (trim, collapse spaces, lowercase, Arabic normalization)
 */
export function normalizeBankName(name: string): string {
  if (!name) return "";
  let clean = name.trim().toLowerCase();
  clean = clean.replace(/\s+/g, " ");
  // Arabic equivalences: normalize alef, yaa, taa marbouta
  clean = clean
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْ]/g, ""); // strip diacritics
  return clean;
}

/**
 * Checks if a bank with normalized name already exists in bank list
 */
export function isDuplicateBank(existingBanks: UaeBank[], newName: string): boolean {
  const normNew = normalizeBankName(newName);
  if (!normNew) return true;
  return existingBanks.some(
    (b) =>
      normalizeBankName(b.nameEn) === normNew ||
      normalizeBankName(b.nameAr) === normNew ||
      (b.code && normalizeBankName(b.code) === normNew)
  );
}

/**
 * Gets custom banks stored in localStorage
 */
export function getStoredCustomBanks(): UaeBank[] {
  try {
    if (typeof window === "undefined" || typeof localStorage === "undefined") {
      return [];
    }
    const raw = localStorage.getItem(CUSTOM_BANKS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse custom banks from localStorage:", e);
    return [];
  }
}


/**
 * Saves a new custom bank to localStorage
 */
export function saveCustomBank(bankName: string): UaeBank {
  const trimmed = bankName.trim();
  const customBanks = getStoredCustomBanks();
  const newBank: UaeBank = {
    id: `custom-bank-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    nameEn: trimmed,
    nameAr: trimmed,
    code: trimmed.substring(0, 8).toUpperCase(),
  };

  const updated = [...customBanks, newBank];
  try {
    localStorage.setItem(CUSTOM_BANKS_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to save custom bank:", e);
  }

  return newBank;
}

/**
 * Returns all banks (standard UAE_BANKS + custom user added banks)
 */
export function getAllUaeBanks(): UaeBank[] {
  const custom = getStoredCustomBanks();
  // Filter out any custom bank that duplicates UAE_BANKS
  const uniqueCustom = custom.filter((cb) => !isDuplicateBank(UAE_BANKS, cb.nameAr));
  return [...UAE_BANKS, ...uniqueCustom];
}
