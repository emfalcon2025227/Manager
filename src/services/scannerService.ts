/**
 * Emirates Falcon ERP - Scanner Service Abstraction
 * Handles TWAIN/WIA desktop bridge integration, WebRTC document camera scanning,
 * network scanner adapters, and OCR image preprocessing.
 */

export interface ScannerDevice {
  id: string;
  name: string;
  type: "TWAIN_WIA_BRIDGE" | "WEBCAM_DOC" | "NETWORK_SCANNER" | "VIRTUAL_SCANNER";
  status: "ONLINE" | "OFFLINE";
  resolutionDpi: number;
  isHP?: boolean;
}

export interface ScanOptions {
  deviceId?: string;
  resolutionDpi?: number;
  colorMode?: "COLOR" | "GRAYSCALE" | "MONO";
  autoCrop?: boolean;
  deskew?: boolean;
  contrastEnhance?: boolean;
  paperSource?: "auto" | "flatbed" | "feeder";
  printerIp?: string;
}

export interface ScanResult {
  success: boolean;
  imageBase64: string;
  mimeType: string;
  deviceUsed: string;
  timestamp: string;
  error?: string;
}

export class ScannerService {
  private static instance: ScannerService;
  private bridgeUrl = "http://127.0.0.1:18622/scan"; // Default TWAIN/WIA local bridge port
  private diagnosticsUrl = "http://127.0.0.1:18622/diagnostics";

  public static getInstance(): ScannerService {
    if (!ScannerService.instance) {
      ScannerService.instance = new ScannerService();
    }
    return ScannerService.instance;
  }

  /**
   * Check local bridge health and status
   */
  public async checkBridgeStatus(): Promise<{
    running: boolean;
    scanners: any[];
    hpDetected: boolean;
    hpDeviceName?: string;
    details?: any;
  }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(this.diagnosticsUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const scanners = data.scanners || [];
        const hpScanner = scanners.find((s: any) =>
          (s.name || "").match(/HP|LaserJet|M282|M283|M280/i)
        );
        return {
          running: true,
          scanners,
          hpDetected: !!hpScanner,
          hpDeviceName: hpScanner?.name || (scanners.length > 0 ? scanners[0].name : undefined),
          details: data,
        };
      }
    } catch (e) {
      // Bridge not reachable
    }

    return {
      running: false,
      scanners: [],
      hpDetected: false,
    };
  }

  /**
   * Detect available scanner hardware and virtual bridges
   */
  public async getAvailableScanners(): Promise<ScannerDevice[]> {
    const devices: ScannerDevice[] = [];

    // 1. Attempt contacting local WIA bridge endpoint first
    try {
      const bridgeStatus = await this.checkBridgeStatus();
      if (bridgeStatus.running && bridgeStatus.scanners.length > 0) {
        bridgeStatus.scanners.forEach((s: any) => {
          const isHP = !!(s.name || "").match(/HP|LaserJet|M282|M283|M280/i);
          devices.push({
            id: `wia_${s.id || s.name}`,
            name: `${s.name}${isHP ? " ⭐ [HP Color LaserJet Pro MFP M282nw]" : " (WIA/TWAIN)"}`,
            type: "TWAIN_WIA_BRIDGE",
            status: "ONLINE",
            resolutionDpi: 300,
            isHP,
          });
        });
      } else if (bridgeStatus.running) {
        // Bridge is up but no hardware detected yet
        devices.push({
          id: "wia_default",
          name: "ماسح HP M282nw عبر الجسر المحلي (Local Bridge Online)",
          type: "TWAIN_WIA_BRIDGE",
          status: "ONLINE",
          resolutionDpi: 300,
          isHP: true,
        });
      }
    } catch (e) {
      // Local native driver bridge not active
    }

    // Default HP Preset Device
    if (!devices.some(d => d.type === "TWAIN_WIA_BRIDGE")) {
      devices.push({
        id: "wia_hp_m282nw",
        name: "HP Color LaserJet Pro MFP M282nw (WIA / USB / Network)",
        type: "TWAIN_WIA_BRIDGE",
        status: "OFFLINE",
        resolutionDpi: 300,
        isHP: true,
      });
    }

    // Network eSCL Scanner Preset
    devices.push({
      id: "hp-network-escl",
      name: "ماسح HP الشبكي المباشر (HP Webscan / eSCL Wi-Fi Direct)",
      type: "NETWORK_SCANNER",
      status: "ONLINE",
      resolutionDpi: 300,
      isHP: true,
    });

    // Camera Fallback
    devices.push({
      id: "doc-cam-hd",
      name: "كاميرا كاشف المستندات عالي الدقة (HD Document Scanner Camera)",
      type: "WEBCAM_DOC",
      status: "ONLINE",
      resolutionDpi: 300,
    });

    return devices;
  }

  /**
   * Conduct a scanner acquisition from specified device
   */
  public async acquireScan(options: ScanOptions = {}): Promise<ScanResult> {
    const deviceId = options.deviceId || "wia_default";
    const dpi = options.resolutionDpi || 300;
    const colorMode = options.colorMode || "COLOR";
    const paperSource = options.paperSource || "auto";

    // 1. Try Native TWAIN/WIA bridge
    if (
      deviceId.startsWith("wia_") ||
      deviceId === "native-twain" ||
      deviceId === "twain-wia-local" ||
      deviceId === "wia_hp_m282nw"
    ) {
      try {
        const scannerId = deviceId.startsWith("wia_")
          ? deviceId.replace(/^wia_/, "")
          : "";

        const res = await fetch(this.bridgeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scannerId: scannerId === "hp_m282nw" || scannerId === "default" ? "" : scannerId,
            dpi,
            colorMode,
            source: paperSource,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.imageBase64) {
            return {
              success: true,
              imageBase64: data.imageBase64.startsWith("data:")
                ? data.imageBase64
                : `data:image/jpeg;base64,${data.imageBase64}`,
              mimeType: data.mimeType || "image/jpeg",
              deviceUsed: data.deviceUsed || "HP Color LaserJet Pro MFP M282nw (WIA Bridge)",
              timestamp: new Date().toISOString(),
            };
          } else {
            throw new Error(data.error || "استجابة غير صحيحة من الماسح الضوئي.");
          }
        } else {
          let errorMsg = "فشل الاتصال بالماسح.";
          try {
            const errData = await res.json();
            if (errData.error) errorMsg = errData.error;
          } catch (e) {}
          throw new Error(errorMsg);
        }
      } catch (e: any) {
        return {
          success: false,
          imageBase64: "",
          mimeType: "",
          deviceUsed: "HP Color LaserJet Pro MFP M282nw (WIA Bridge)",
          timestamp: new Date().toISOString(),
          error:
            e.message ||
            "تعذر الاتصال ببرنامج الماسح الضوئي المحلي. يرجى التأكد من تشغيل أداة Start-HP-Scanner.bat على جهاز الكمبيوتر.",
        };
      }
    }

    // 2. Network HP Scanner via eSCL
    if (deviceId === "hp-network-escl") {
      // Direct eSCL needs local bridge or direct IP
      const bridgeStatus = await this.checkBridgeStatus();
      if (bridgeStatus.running) {
        return this.acquireScan({
          ...options,
          deviceId: "wia_default",
        });
      }
      return {
        success: false,
        imageBase64: "",
        mimeType: "",
        deviceUsed: "HP Network Scanner (eSCL)",
        timestamp: new Date().toISOString(),
        error:
          "للمسح المباشر من طابعة HP M282nw عبر الشبكة أو كابل USB، يرجى تشغيل أداة الجسر المحلي [Start-HP-Scanner.bat].",
      };
    }

    return {
      success: false,
      imageBase64: "",
      mimeType: "",
      deviceUsed: deviceId,
      timestamp: new Date().toISOString(),
      error: "تعذر الاتصال بالماسح الضوئي. يرجى اختيار جهاز ماسح صالح أو استخدام الكاميرا.",
    };
  }

  /**
   * Acquire multi-page scan from ADF (Auto Document Feeder) or continuous batch
   */
  public async acquireBatchScan(options: ScanOptions & { maxPages?: number } = {}): Promise<{
    success: boolean;
    scans: ScanResult[];
    totalAcquired: number;
    error?: string;
  }> {
    const maxPages = options.maxPages || 20;
    const scans: ScanResult[] = [];
    const paperSource = options.paperSource || "feeder";

    try {
      // First attempt with feeder
      const firstScan = await this.acquireScan({
        ...options,
        paperSource,
      });

      if (!firstScan.success) {
        return {
          success: false,
          scans: [],
          totalAcquired: 0,
          error: firstScan.error,
        };
      }

      scans.push(firstScan);

      // If feeder mode, poll subsequent pages if bridge supports continuous scanning
      let consecutiveFails = 0;
      while (scans.length < maxPages && consecutiveFails < 1) {
        try {
          const nextScan = await this.acquireScan({
            ...options,
            paperSource: "feeder",
          });
          if (nextScan.success && nextScan.imageBase64 && nextScan.imageBase64 !== scans[scans.length - 1].imageBase64) {
            scans.push(nextScan);
            consecutiveFails = 0;
          } else {
            consecutiveFails++;
          }
        } catch {
          consecutiveFails++;
        }
      }

      return {
        success: true,
        scans,
        totalAcquired: scans.length,
      };
    } catch (err: any) {
      return {
        success: scans.length > 0,
        scans,
        totalAcquired: scans.length,
        error: scans.length === 0 ? (err.message || "Failed to acquire batch scan") : undefined,
      };
    }
  }
}

export const scannerService = ScannerService.getInstance();
