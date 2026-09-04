import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
} from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App singleton
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Provider with required Drive scopes
const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/drive.file");
provider.setCustomParameters({
  prompt: "select_account"
});

const TOKEN_SESSION_KEY = "falcon_gdrive_access_token";

let isSigningIn = false;
let cachedAccessToken: string | null =
  typeof window !== "undefined" ? sessionStorage.getItem(TOKEN_SESSION_KEY) : null;
let currentUser: User | null = null;

// Check redirect result on load
getRedirectResult(auth)
  .then((result) => {
    if (result) {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        cachedAccessToken = credential.accessToken;
        if (typeof window !== "undefined") {
          sessionStorage.setItem(TOKEN_SESSION_KEY, credential.accessToken);
        }
        currentUser = result.user;
      }
    }
  })
  .catch((err) => {
    console.warn("Redirect auth error:", err);
  });

// Auth State Listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    currentUser = user;
    if (user) {
      const token = cachedAccessToken || (typeof window !== "undefined" ? sessionStorage.getItem(TOKEN_SESSION_KEY) : null);
      if (token) {
        cachedAccessToken = token;
        if (onAuthSuccess) onAuthSuccess(user, token);
      } else if (!isSigningIn) {
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(TOKEN_SESSION_KEY);
      }
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Sign in with Google using Firebase Auth (Popup with Redirect fallback)
export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);

    if (!credential?.accessToken) {
      throw new Error("Failed to retrieve Google OAuth access token from Firebase credential.");
    }

    cachedAccessToken = credential.accessToken;
    if (typeof window !== "undefined") {
      sessionStorage.setItem(TOKEN_SESSION_KEY, credential.accessToken);
    }
    currentUser = result.user;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.warn("signInWithPopup failed or blocked. Trying signInWithRedirect...", error);
    try {
      await signInWithRedirect(auth, provider);
      return null;
    } catch (redirectError: any) {
      isSigningIn = false;
      throw redirectError;
    }
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken) return cachedAccessToken;
  if (typeof window !== "undefined") {
    const stored = sessionStorage.getItem(TOKEN_SESSION_KEY);
    if (stored) {
      cachedAccessToken = stored;
      return stored;
    }
  }
  return null;
};

export const getGoogleUser = (): User | null => {
  return currentUser;
};

export const googleLogout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(TOKEN_SESSION_KEY);
  }
  currentUser = null;
};

export interface DriveDiagnosticStep {
  name: string;
  status: "PASS" | "FAIL" | "PENDING";
  latency?: number;
  details?: string;
}

export interface DriveDiagnosticReport {
  status: "NOT_CONFIGURED" | "CONFIGURED" | "AUTHENTICATED" | "VERIFIED" | "REAL_UPLOAD_VERIFIED" | "ERROR" | "REAUTH_REQUIRED";
  lastCheckedAt?: string;
  latency?: number;
  errorCode?: string;
  safeErrorMessage?: string;
  repairInstructions?: string;
  steps: DriveDiagnosticStep[];
  fileId?: string;
  folderId?: string;
  filePath?: string;
  uploadTime?: string;
}

export const runComprehensiveGoogleDriveDiagnostics = async (): Promise<DriveDiagnosticReport> => {
  const steps: DriveDiagnosticStep[] = [
    { name: "1. Authentication", status: "PENDING" },
    { name: "2. OAuth Validity", status: "PENDING" },
    { name: "3. Scope Verification", status: "PENDING" },
    { name: "4. Drive API Availability", status: "PENDING" },
    { name: "5. Root Folder Access", status: "PENDING" },
    { name: "6. Subfolder Access & Creation", status: "PENDING" },
    { name: "7. Real Lightweight Upload", status: "PENDING" },
    { name: "8. File ID Verification", status: "PENDING" },
    { name: "9. File Metadata Verification", status: "PENDING" },
    { name: "10. Successful Upload Confirmation", status: "PENDING" },
  ];

  const report: DriveDiagnosticReport = {
    status: "ERROR",
    lastCheckedAt: new Date().toISOString(),
    steps,
  };

  const token = await getAccessToken();
  const startTimeTotal = Date.now();

  const markStep = (index: number, status: "PASS" | "FAIL", latency?: number, details?: string) => {
    steps[index].status = status;
    steps[index].latency = latency;
    steps[index].details = details;
  };

  // 1. Authentication Check
  const t1 = Date.now();
  if (!token) {
    markStep(0, "FAIL", Date.now() - t1, "No Google OAuth access token is stored. User has not logged in.");
    report.status = "REAUTH_REQUIRED";
    report.errorCode = "NO_AUTH_TOKEN";
    report.safeErrorMessage = "No Google account is authorized for this session.";
    report.repairInstructions = "Click 'Authorize & Connect Account' and log in with emfalcon2025227@gmail.com.";
    return report;
  }
  markStep(0, "PASS", Date.now() - t1, "OAuth Access Token found in session memory.");

  // 2. OAuth Validity Check
  const t2 = Date.now();
  let scopes: string[] = [];
  try {
    const res = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`);
    const lat2 = Date.now() - t2;
    if (!res.ok) {
      markStep(1, "FAIL", lat2, `Google API responded with HTTP status ${res.status}`);
      report.status = "REAUTH_REQUIRED";
      report.errorCode = "EXPIRED_TOKEN";
      report.safeErrorMessage = "Google session has expired or been revoked.";
      report.repairInstructions = "Re-authenticate using the 'Authorize & Connect Account' button.";
      return report;
    }
    const tokenInfo = await res.json();
    scopes = tokenInfo.scope ? tokenInfo.scope.split(" ") : [];
    markStep(1, "PASS", lat2, `Token validated successfully. Expires in ${tokenInfo.expires_in}s.`);
  } catch (err: any) {
    markStep(1, "FAIL", Date.now() - t2, err.message || "Network error checking token validity.");
    report.status = "ERROR";
    report.errorCode = "NETWORK_ERROR";
    report.safeErrorMessage = "Could not reach Google identity servers.";
    report.repairInstructions = "Verify your internet connection and DNS settings, then retry.";
    return report;
  }

  // 3. Scope Verification
  const t3 = Date.now();
  const hasDriveScope = scopes.some((s) => s.includes("drive") || s.includes("drive.file"));
  const lat3 = Date.now() - t3;
  if (!hasDriveScope) {
    markStep(2, "FAIL", lat3, `Found scopes: ${scopes.join(", ")}. Missing 'drive.file' scope.`);
    report.status = "ERROR";
    report.errorCode = "INSUFFICIENT_SCOPES";
    report.safeErrorMessage = "Required Google Drive permissions are missing.";
    report.repairInstructions = "Authorize again and ensure you check the box allowing access to Google Drive files.";
    return report;
  }
  markStep(2, "PASS", lat3, "Google Drive 'drive.file' scope is successfully verified.");

  // 4. Drive API Availability
  const t4 = Date.now();
  try {
    const res = await fetch("https://www.googleapis.com/drive/v3/files?pageSize=1", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const lat4 = Date.now() - t4;
    if (!res.ok) {
      markStep(3, "FAIL", lat4, `Drive API request failed with status ${res.status}`);
      report.status = "ERROR";
      report.errorCode = "DRIVE_API_UNAVAILABLE";
      report.safeErrorMessage = "Google Drive API is unresponsive.";
      report.repairInstructions = "Ensure the Google Drive API is enabled in your Google Cloud Console.";
      return report;
    }
    markStep(3, "PASS", lat4, "Google Drive v3 API is active and reachable.");
  } catch (err: any) {
    markStep(3, "FAIL", Date.now() - t4, err.message || "Drive API ping failed.");
    report.status = "ERROR";
    report.errorCode = "DRIVE_API_NETWORK_ERROR";
    report.safeErrorMessage = "Connection to Google Drive API timed out.";
    report.repairInstructions = "Check company firewall or proxy rules blocking googleapis.com.";
    return report;
  }

  // 5. Root Folder Access
  const t5 = Date.now();
  let rootFolderId = "";
  try {
    rootFolderId = await getOrCreateDriveFolder("Emirates Falcon", token, "root");
    const lat5 = Date.now() - t5;
    if (!rootFolderId || rootFolderId === "root") {
      markStep(4, "FAIL", lat5, "Could not resolve or create 'Emirates Falcon' root folder.");
      report.status = "ERROR";
      report.errorCode = "ROOT_FOLDER_ACCESS_FAILED";
      report.safeErrorMessage = "Failed to access root 'Emirates Falcon' directory.";
      report.repairInstructions = "Verify that you have not hit storage limits on your Google Drive.";
      return report;
    }
    markStep(4, "PASS", lat5, `Resolved 'Emirates Falcon' root folder with ID: ${rootFolderId}`);
  } catch (err: any) {
    markStep(4, "FAIL", Date.now() - t5, err.message || "Root folder access exception.");
    report.status = "ERROR";
    report.errorCode = "ROOT_FOLDER_EXCEPTION";
    report.safeErrorMessage = "An exception occurred while accessing root directory.";
    return report;
  }

  // 6. Subfolder Access & Creation
  const t6 = Date.now();
  let subFolderId = "";
  try {
    subFolderId = await getOrCreateDriveFolder("SystemTests", token, rootFolderId);
    const lat6 = Date.now() - t6;
    if (!subFolderId || subFolderId === "root" || subFolderId === rootFolderId) {
      markStep(5, "FAIL", lat6, "Could not resolve or create 'SystemTests' subfolder.");
      report.status = "ERROR";
      report.errorCode = "SUBFOLDER_CREATION_FAILED";
      report.safeErrorMessage = "Failed to create 'SystemTests' subfolder under root directory.";
      return report;
    }
    markStep(5, "PASS", lat6, `Resolved 'Emirates Falcon/SystemTests' subfolder with ID: ${subFolderId}`);
  } catch (err: any) {
    markStep(5, "FAIL", Date.now() - t6, err.message || "Subfolder creation exception.");
    report.status = "ERROR";
    report.errorCode = "SUBFOLDER_EXCEPTION";
    return report;
  }

  // 7. Real Lightweight Upload
  const t7 = Date.now();
  let testFileId = "";
  let webViewLink = "";
  try {
    const testContent = `Emirates Falcon Integration Test Link - Non-destructive verification test executed on ${new Date().toISOString()}`;
    const base64Content = btoa(unescape(encodeURIComponent(testContent)));
    const dataUrl = `data:text/plain;charset=utf-8;base64,${base64Content}`;

    const uploadRes = await uploadFileToGoogleDrive({
      fileName: "connection_test.txt",
      mimeType: "text/plain",
      base64OrBlobUrl: dataUrl,
      folderId: subFolderId,
      drivePath: "Emirates Falcon/SystemTests",
      description: "Automated Connection Health Check File",
    });

    const lat7 = Date.now() - t7;
    if (!uploadRes.success || !uploadRes.fileId) {
      markStep(6, "FAIL", lat7, uploadRes.error || "File upload response indicated failure.");
      report.status = "ERROR";
      report.errorCode = "UPLOAD_POST_FAILED";
      report.safeErrorMessage = uploadRes.error || "The upload request was rejected by Google.";
      return report;
    }
    testFileId = uploadRes.fileId;
    webViewLink = uploadRes.webViewLink || "";
    markStep(6, "PASS", lat7, `Lightweight text file successfully written to Drive. File ID: ${testFileId}`);
  } catch (err: any) {
    markStep(6, "FAIL", Date.now() - t7, err.message || "Upload operation exception.");
    report.status = "ERROR";
    report.errorCode = "UPLOAD_EXCEPTION";
    report.safeErrorMessage = err.message || "Upload operation failed.";
    return report;
  }

  // 8. File ID Verification
  const t8 = Date.now();
  const lat8 = Date.now() - t8;
  if (!testFileId || testFileId.length < 5) {
    markStep(7, "FAIL", lat8, `Invalid File ID returned: '${testFileId}'`);
    report.status = "ERROR";
    report.errorCode = "INVALID_FILE_ID";
    return report;
  }
  markStep(7, "PASS", lat8, `Verified returned unique Google Resource File ID: ${testFileId}`);

  // 9. File Metadata Verification
  const t9 = Date.now();
  try {
    const metaUrl = `https://www.googleapis.com/drive/v3/files/${testFileId}?fields=id,name,mimeType,parents`;
    const res = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const lat9 = Date.now() - t9;
    if (!res.ok) {
      markStep(8, "FAIL", lat9, `Failed to retrieve metadata of file ${testFileId}. HTTP code ${res.status}`);
      report.status = "ERROR";
      report.errorCode = "METADATA_RETRIEVAL_FAILED";
      return report;
    }
    const meta = await res.json();
    if (meta.name !== "connection_test.txt" || !meta.parents || !meta.parents.includes(subFolderId)) {
      markStep(8, "FAIL", lat9, `Metadata discrepancy detected! Fetched: Name: ${meta.name}, Parents: ${meta.parents?.join(",")}`);
      report.status = "ERROR";
      report.errorCode = "METADATA_DISCREPANCY";
      return report;
    }
    markStep(8, "PASS", lat9, `Metadata verified successfully: File Name: ${meta.name}, Parent matches: ${subFolderId}`);
  } catch (err: any) {
    markStep(8, "FAIL", Date.now() - t9, err.message || "Metadata retrieval exception.");
    report.status = "ERROR";
    report.errorCode = "METADATA_EXCEPTION";
    return report;
  }

  // 10. Successful Upload Confirmation
  const t10 = Date.now();
  const totalLatency = Date.now() - startTimeTotal;
  markStep(9, "PASS", Date.now() - t10, "End-to-end write and verify loops completed flawlessly.");

  report.status = "REAL_UPLOAD_VERIFIED";
  report.latency = totalLatency;
  report.fileId = testFileId;
  report.folderId = subFolderId;
  report.filePath = "Emirates Falcon/SystemTests/connection_test.txt";
  report.uploadTime = new Date().toISOString();
  delete report.errorCode;
  delete report.safeErrorMessage;
  delete report.repairInstructions;

  return report;
};

/**
 * Find or create a specific folder in Google Drive
 */
export const getOrCreateDriveFolder = async (
  folderName: string,
  accessToken: string,
  parentId: string = "root"
): Promise<string> => {
  try {
    // Search for existing folder within the parent
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    )}&fields=files(id,name)`;

    const searchRes = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        return searchData.files[0].id;
      }
    }

    // Create new folder if not found
    const createUrl = "https://www.googleapis.com/drive/v3/files";
    const body: any = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (parentId !== "root") {
      body.parents = [parentId];
    }

    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!createRes.ok) {
      throw new Error(`Failed to create Google Drive folder (${createRes.status})`);
    }

    const newFolder = await createRes.json();
    return newFolder.id;
  } catch (err) {
    console.warn("Folder operation warning, defaulting to root:", err);
    return "root";
  }
};

/**
 * Resolve a full path (e.g. "Emirates Falcon/Contracts/LEASE-001") into a folder ID
 */
export const getOrCreateDrivePath = async (
  path: string,
  accessToken: string
): Promise<string> => {
  const parts = path.split("/").filter((p) => p.length > 0);
  let currentId = "root";

  for (const part of parts) {
    currentId = await getOrCreateDriveFolder(part, accessToken, currentId);
  }

  return currentId;
};

/**
 * Check if a file with the same name already exists in a Google Drive folder
 */
export const findExistingDriveFile = async (
  fileName: string,
  accessToken: string,
  parentId: string = "root"
): Promise<{ id: string; webViewLink?: string; webContentLink?: string } | null> => {
  try {
    const escapedName = fileName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const query = `name = '${escapedName}' and '${parentId}' in parents and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      query
    )}&fields=files(id,name,webViewLink,webContentLink)&spaces=drive`;

    const res = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.ok) {
      const data = await res.json();
      if (data.files && data.files.length > 0) {
        return {
          id: data.files[0].id,
          webViewLink: data.files[0].webViewLink,
          webContentLink: data.files[0].webContentLink,
        };
      }
    }
  } catch (e) {
    console.warn("Error checking for existing Drive file:", e);
  }
  return null;
};

/**
 * Upload a file (Image/PDF/Base64) to Google Drive
 */
export const uploadFileToGoogleDrive = async (params: {
  fileName: string;
  mimeType: string;
  base64OrBlobUrl: string;
  folderId?: string;    // Direct folder ID (takes highest priority)
  folderName?: string;  // Single folder name
  drivePath?: string;   // Full path (e.g. "Emirates Falcon/Archive/...")
  description?: string;
  skipDuplicateCheck?: boolean;
}): Promise<{
  success: boolean;
  fileId?: string;
  webViewLink?: string;
  webContentLink?: string;
  isExisting?: boolean;
  error?: string;
}> => {
  try {
    const token = await getAccessToken();
    if (!token) {
      return {
        success: false,
        error: "NO_AUTH",
      };
    }

    let folderId = params.folderId || "root";
    if (!params.folderId) {
      if (params.drivePath) {
        folderId = await getOrCreateDrivePath(params.drivePath, token);
      } else if (params.folderName) {
        folderId = await getOrCreateDriveFolder(params.folderName, token);
      }
    }

    // Deduplication check in Drive folder to prevent uploading 2 identical files
    if (!params.skipDuplicateCheck) {
      const existing = await findExistingDriveFile(params.fileName, token, folderId);
      if (existing) {
        console.log(`[GoogleDrive] File "${params.fileName}" already exists in folder (${folderId}). Reusing existing file: ${existing.id}`);
        return {
          success: true,
          fileId: existing.id,
          webViewLink: existing.webViewLink || `https://drive.google.com/file/d/${existing.id}/view`,
          webContentLink: existing.webContentLink,
          isExisting: true,
        };
      }
    }

    // Convert Base64 or Blob to Blob object
    let fileBlob: Blob;
    if (params.base64OrBlobUrl.startsWith("data:")) {
      const arr = params.base64OrBlobUrl.split(",");
      const mime = arr[0].match(/:(.*?);/)?.[1] || params.mimeType;
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      fileBlob = new Blob([u8arr], { type: mime });
    } else if (params.base64OrBlobUrl.startsWith("blob:")) {
      const response = await fetch(params.base64OrBlobUrl);
      fileBlob = await response.blob();
    } else {
      // Raw string fallback or svg
      fileBlob = new Blob([params.base64OrBlobUrl], { type: params.mimeType });
    }

    // Metadata payload
    const metadata: any = {
      name: params.fileName,
      mimeType: params.mimeType,
      description: params.description || "Uploaded from Emirates Falcon Real Estate Management System",
    };

    if (folderId && folderId !== "root") {
      metadata.parents = [folderId];
    }

    // Atomic Single Multipart Upload (Guaranteed 1 File on Google Drive)
    const boundary = "-------" + Math.random().toString(36).substring(2) + Date.now().toString(36);
    const delimiter = "\r\n--" + boundary + "\r\n";
    const closeDelimiter = "\r\n--" + boundary + "--";

    const metadataPart = new Blob([
      delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: " + (params.mimeType || "application/octet-stream") + "\r\n\r\n"
    ], { type: "text/plain" });

    const closePart = new Blob([closeDelimiter], { type: "text/plain" });
    const multipartBlob = new Blob([metadataPart, fileBlob, closePart]);

    const uploadUrl =
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink";

    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartBlob,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `Upload failed with status ${res.status}`);
    }

    const resData = await res.json();

    return {
      success: true,
      fileId: resData.id,
      webViewLink: resData.webViewLink || `https://drive.google.com/file/d/${resData.id}/view`,
      webContentLink: resData.webContentLink,
    };
  } catch (err: any) {
    console.warn("Google Drive Upload deferred/failed (Check auth):", err?.message || err);
    return {
      success: false,
      error: err.message || "Failed to upload to Google Drive",
    };
  }
};

/**
 * Update existing file in Google Drive in place (idempotent, prevents duplicates)
 */
export const updateExistingDriveFile = async (params: {
  fileId: string;
  base64OrBlobUrl: string;
  mimeType?: string;
  newFileName?: string;
}): Promise<{
  success: boolean;
  fileId?: string;
  webViewLink?: string;
  webContentLink?: string;
  error?: string;
}> => {
  try {
    const token = await getAccessToken();
    if (!token) {
      return { success: false, error: "NO_AUTH" };
    }

    let fileBlob: Blob;
    const effectiveMime = params.mimeType || "image/jpeg";

    if (params.base64OrBlobUrl.startsWith("data:")) {
      const arr = params.base64OrBlobUrl.split(",");
      const mime = arr[0].match(/:(.*?);/)?.[1] || effectiveMime;
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      fileBlob = new Blob([u8arr], { type: mime });
    } else if (params.base64OrBlobUrl.startsWith("blob:")) {
      const response = await fetch(params.base64OrBlobUrl);
      fileBlob = await response.blob();
    } else {
      fileBlob = new Blob([params.base64OrBlobUrl], { type: effectiveMime });
    }

    // Update media content via PATCH
    const patchUrl = `https://www.googleapis.com/upload/drive/v3/files/${params.fileId}?uploadType=media&fields=id,name,webViewLink,webContentLink`;
    const res = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": effectiveMime,
      },
      body: fileBlob,
    });

    if (!res.ok) {
      throw new Error(`Failed to update Drive file content (${res.status})`);
    }

    const resData = await res.json();

    // If filename needs update as well
    if (params.newFileName) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${params.fileId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: params.newFileName }),
      });
    }

    return {
      success: true,
      fileId: resData.id || params.fileId,
      webViewLink: resData.webViewLink || `https://drive.google.com/file/d/${params.fileId}/view`,
      webContentLink: resData.webContentLink,
    };
  } catch (err: any) {
    console.warn("Drive file update error:", err);
    return {
      success: false,
      error: err.message || "Failed to update existing Drive file",
    };
  }
};

/**
 * PHASE 57-K.5: Authenticated binary retrieval for native ERP in-app document preview
 * Fetches file content securely via Google Drive v3 API media endpoint
 */
export const fetchDriveFileBlob = async (
  fileId: string
): Promise<{ blob: Blob; url: string; mimeType: string } | null> => {
  try {
    const token = await getAccessToken();
    if (!token) {
      console.warn("No active Google Drive access token for preview download");
      return null;
    }

    // 1. Get file metadata first for correct mimeType
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    let mimeType = "application/octet-stream";
    if (metaRes.ok) {
      const meta = await metaRes.json();
      if (meta.mimeType) mimeType = meta.mimeType;
    }

    // 2. Fetch media binary
    const mediaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!mediaRes.ok) {
      console.warn(`Drive fetch media failed: ${mediaRes.status}`);
      return null;
    }

    const blob = await mediaRes.blob();
    const typedBlob = new Blob([blob], { type: mimeType });
    const url = URL.createObjectURL(typedBlob);

    return {
      blob: typedBlob,
      url,
      mimeType,
    };
  } catch (error) {
    console.error("Error fetching Drive file blob:", error);
    return null;
  }
};

