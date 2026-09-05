const fs = require('fs');

let code = fs.readFileSync('src/services/googleDriveService.ts', 'utf-8');

// The `sed` command previously removed `if` but left its body and the `catch` block structure broken.
// Specifically, there are extra `}` at the end of catch blocks or before catch blocks.

// Replace the broken block 2
code = code.replace(/      markStep\(1, "PASS", lat2, \`Token validated successfully\. Expires in \$\{tokenInfo\.expires_in\}s\.\`\);\n    \}\n  \} catch \(err: any\) \{/, '      markStep(1, "PASS", lat2, `Token validated successfully. Expires in ${tokenInfo.expires_in}s.`);\n  } catch (err: any) {');

// Replace end of block 2
code = code.replace(/      return report;\n    \}\n  \}\n\n  \/\/ 3\. Scope Verification/g, '      return report;\n  }\n\n  // 3. Scope Verification');

// Replace end of block 4
code = code.replace(/      return report;\n    \}\n  \}\n\n  \/\/ 5\. Root Folder Access/g, '      return report;\n  }\n\n  // 5. Root Folder Access');

// Replace end of block 9
code = code.replace(/      return report;\n    \}\n  \}\n\n  \/\/ 10\. Successful Upload Confirmation/g, '      return report;\n  }\n\n  // 10. Successful Upload Confirmation');

// Also, the getOrCreateDriveFolder and uploadFileToGoogleDrive have similar broken try-catches.
// Let's just fix the rest using a regex to remove dangling `}` before `\n  // `
code = code.replace(/    \}\n  \}\n\n  \/\//g, '  }\n\n  //');

// And fix any other `    }\n  }` at the end of functions
code = code.replace(/    \}\n  \}\n\n\/\*\*/g, '  }\n\n/**');

// Let's look for `uploadFileToGoogleDrive` broken try-catch
// In uploadFileToGoogleDrive there is:
// ```
//    if (token.startsWith("ya29.falcon-direct-auth")) {
// ```
// Wait, I ran sed globally, so it deleted all `if (token.startsWith...` blocks in the file!
// This means it deleted:
// 1. In getOrCreateDriveFolder
// 2. In uploadFileToGoogleDrive
// 3. In updateExistingDriveFile

// Let's see what is broken in `uploadFileToGoogleDrive`
// Wait, `getOrCreateDriveFolder` starts with:
// ```
// export const getOrCreateDriveFolder = async (
//   folderName: string,
//   accessToken: string,
//   parentId: string = "root"
// ): Promise<string> => {
//   if (accessToken && accessToken.startsWith("ya29.falcon-direct-auth")) {
//     return `folder_mock_${folderName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
//   }
// ```
// The sed regex was `/if (token\.startsWith("ya29\.falcon-direct-auth")) {/,/}/d`
// So it didn't match `accessToken.startsWith`! It only matched `token.startsWith`.
// So `uploadFileToGoogleDrive` had:
// ```
//     if (token.startsWith("ya29.falcon-direct-auth")) {
//       return {
//         success: true,
//         fileId: `file_mock_${Date.now()}`,
//         webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
//         webContentLink: "https://drive.google.com/uc?id=mock-file-id&export=download",
//       };
//     }
// ```
// That was deleted cleanly because it didn't have an `else`.

// Wait, the typescript errors showed:
// src/services/googleDriveService.ts(509,5): error TS1005: 'try' expected.
// src/services/googleDriveService.ts(513,2): error TS1472: 'catch' or 'finally' expected.
// src/services/googleDriveService.ts(545,23): error TS1005: ';' expected.

fs.writeFileSync('src/services/googleDriveService.ts', code);
