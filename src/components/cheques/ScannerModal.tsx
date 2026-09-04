import React, { useState, useEffect, useRef } from "react";
import {
  Camera,
  RefreshCw,
  Check,
  AlertCircle,
  Settings,
  Shield,
  Sliders,
  Maximize2,
  RotateCw,
  Upload,
  Download,
  Printer,
  Copy,
  CheckCircle2,
  HelpCircle,
  ExternalLink,
  Zap,
} from "lucide-react";
import { Modal } from "../common/Modal";
import { scannerService, ScannerDevice } from "../../services/scannerService";
import {
  downloadHPBridgeBatchLauncher,
  downloadHPBridgePs1Script,
  getPowerShellOneLiner,
} from "../../services/hpScannerBridgeGenerator";
import { useLanguage } from "../../context/LanguageContext";

export interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanComplete: (imageBase64: string, mimeType: string) => void;
  documentType?: string;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  onScanComplete,
  documentType,
}) => {
  const { language } = useLanguage();
  const isAr = language === "ar";
  
  const [devices, setDevices] = useState<ScannerDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  
  // Settings
  const [resolutionDpi, setResolutionDpi] = useState<number>(300);
  const [colorMode, setColorMode] = useState<"COLOR" | "GRAYSCALE" | "MONO">("COLOR");
  const [paperSource, setPaperSource] = useState<"auto" | "flatbed" | "feeder">("auto");
  const [autoCrop, setAutoCrop] = useState<boolean>(true);
  const [paperSize, setPaperSize] = useState<string>("A4");
  
  // State
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatusMsg, setScanStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showBridgeHelp, setShowBridgeHelp] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  
  // Webcam fallback for visual feedback before scan
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraActive, setCameraActive] = useState(false);

  // Result
  const [scanResult, setScanResult] = useState<{ imageBase64: string; mimeType: string } | null>(null);
  const [rotation, setRotation] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{
    erpService: boolean;
    localBridge: boolean;
    scannerDevice: boolean;
    protocol: string;
    deviceName: string;
    isHP: boolean;
  }>({
    erpService: true,
    localBridge: false,
    scannerDevice: false,
    protocol: "—",
    deviceName: "—",
    isHP: false,
  });

  useEffect(() => {
    if (isOpen) {
      loadDevices();
      startCamera();
      setScanResult(null);
      setRotation(0);
      setIsFullscreen(false);
      setShowBridgeHelp(false);
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen]);

  const loadDevices = async () => {
    const list = await scannerService.getAvailableScanners();
    setDevices(list);
    if (list.length > 0) {
      // Prefer HP or WIA devices first
      const hpDev = list.find((d) => d.isHP || d.type === "TWAIN_WIA_BRIDGE");
      setSelectedDeviceId(hpDev ? hpDev.id : list[0].id);
    }

    // Diagnostics check
    const status = await scannerService.checkBridgeStatus();
    const isHP = status.hpDetected || (status.hpDeviceName || "").toLowerCase().includes("hp");
    
    setDiagnostics({
      erpService: true,
      localBridge: status.running,
      scannerDevice: status.scanners.length > 0,
      protocol: status.running ? "WIA / TWAIN / eSCL" : "—",
      deviceName: status.hpDeviceName || (status.scanners.length > 0 ? status.scanners[0].name : "HP Color LaserJet Pro MFP M282nw"),
      isHP,
    });
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (err) {
      console.warn("Camera not available for preview:", err);
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const handleExecuteScan = async () => {
    setIsScanning(true);
    setErrorMsg(null);
    setScanResult(null);
    setRotation(0);
    setScanStatusMsg(
      isAr
        ? "جاري إرسال أمر السحب الميكانيكي إلى ماسح HP M282nw..."
        : "Sending scan command to HP M282nw Scanner..."
    );

    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      setScanStatusMsg(
        isAr
          ? "جاري سحب ومسح المستند ضوئياً بدقة عالية..."
          : "Scanning document in high resolution..."
      );
      
      const scanRes = await scannerService.acquireScan({
        deviceId: selectedDeviceId,
        resolutionDpi,
        colorMode,
        autoCrop,
        paperSource,
      });

      if (scanRes.success && scanRes.imageBase64) {
        setScanResult({ imageBase64: scanRes.imageBase64, mimeType: scanRes.mimeType });
      } else {
        throw new Error(
          scanRes.error ||
            (isAr
              ? "تعذر الاتصال بالماسح الضوئي. يرجى تشغيل أداة Start-HP-Scanner.bat."
              : "Could not connect to scanner. Please launch Start-HP-Scanner.bat.")
        );
      }
    } catch (err: any) {
      setErrorMsg(
        err?.message ||
          (isAr
            ? "تعذر الاتصال بالماسح الضوئي."
            : "Could not connect to scanner.")
      );
      // Auto expand bridge help if not running
      if (!diagnostics.localBridge) {
        setShowBridgeHelp(true);
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleConfirm = () => {
    if (scanResult) {
      onScanComplete(scanResult.imageBase64, scanResult.mimeType);
      onClose();
    }
  };

  const handleRescan = () => {
    setScanResult(null);
    setRotation(0);
    setErrorMsg(null);
  };

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(getPowerShellOneLiner());
    setCopiedCommand(true);
    setTimeout(() => setCopiedCommand(false), 3000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isAr ? "ماسح المستندات المباشر (HP LaserJet MFP Scanner)" : "Direct Document Scanner (HP LaserJet MFP)"}
    >
      <div className={`flex flex-col text-slate-800 ${isFullscreen ? "fixed inset-4 z-50 bg-white dark:bg-slate-900 rounded-xl shadow-2xl p-4 overflow-auto" : "space-y-4"}`}>
        {isFullscreen && (
           <div className="flex justify-between items-center mb-4">
             <h2 className="text-xl font-bold dark:text-white">{isAr ? "ماسح المستندات" : "Document Scanner"}</h2>
             <button onClick={() => setIsFullscreen(false)} className="px-4 py-2 bg-slate-200 dark:bg-slate-700 rounded-lg text-sm">{isAr ? "إغلاق وضع ملء الشاشة" : "Close Fullscreen"}</button>
           </div>
        )}
        
        {/* Header & Subtitle */}
        {!isFullscreen && (
          <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 text-white p-3.5 rounded-xl flex items-center justify-between text-xs border border-slate-700/60 shadow-md">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                <Printer className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-slate-100">
                    {isAr ? "ماسح HP Color LaserJet Pro MFP M282nw" : "HP Color LaserJet Pro MFP M282nw"}
                  </span>
                  <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded text-[10px] font-mono font-semibold">
                    WIA / USB / Network
                  </span>
                </div>
                <span className="text-slate-400 text-[11px] mt-0.5">
                  {isAr
                    ? "مسح الشيكات والمستندات وعقود الإيجار مباشرة من درج السحب أو السطح المسطح"
                    : "Direct hardware scanning from feeder (ADF) or flatbed glass"}
                </span>
              </div>
            </div>
            
            <div className="flex flex-col items-end text-right">
              {diagnostics.localBridge ? (
                <>
                  <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 rounded-lg flex items-center gap-1.5 font-mono font-bold text-xs border border-emerald-500/30 mb-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    {isAr ? "الماسح متصل وجاهز" : "HP Scanner Connected"}
                  </span>
                  <span className="text-[10px] text-slate-400 max-w-[180px] truncate font-mono">
                    {diagnostics.deviceName}
                  </span>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setShowBridgeHelp(!showBridgeHelp)}
                    className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg flex items-center gap-1.5 font-bold text-[11px] border border-amber-500/30 mb-1 transition-all"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                    {isAr ? "تشغيل جسر HP المحلي" : "Launch HP Bridge"}
                  </button>
                  <button onClick={loadDevices} className="text-[10px] text-blue-400 hover:underline flex items-center gap-1">
                    <RefreshCw className="w-2.5 h-2.5" />
                    {isAr ? "إعادة فحص الاتصال" : "Refresh"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Bridge Helper & Download Drawer */}
        {showBridgeHelp && !scanResult && (
          <div className="bg-slate-900 border border-blue-500/40 rounded-xl p-4 text-xs text-slate-200 space-y-3 animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-400" />
                <span className="font-bold text-sm text-white">
                  {isAr ? "دليل ربط طابعة HP M282nw بنقرة واحدة" : "HP M282nw 1-Click Quick Connect Guide"}
                </span>
              </div>
              <button
                onClick={() => setShowBridgeHelp(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-0.5 rounded bg-slate-800"
              >
                {isAr ? "إخفاء" : "Hide"}
              </button>
            </div>

            <p className="text-slate-300 text-xs leading-relaxed">
              {isAr
                ? "لإرسال أوامر المسح الضوئي المباشرة من المتصفح إلى طابعتك HP Color LaserJet Pro MFP M282nw، قمنا بإنشاء أداة تشغيل خفيفة وآمنة (Zero-Install Bridge) تعمل في خلفية نظام التشغيل:"
                : "To send direct hardware scan commands from the browser to your HP M282nw printer, use our lightweight zero-install background bridge:"}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col justify-between">
                <div>
                  <div className="font-bold text-emerald-400 mb-1 flex items-center gap-1.5">
                    <Download className="w-4 h-4" />
                    {isAr ? "الخيار 1: تنزيل ملف التشغيل المحدث (.bat)" : "Option 1: Download Self-Contained (.bat)"}
                  </div>
                  <p className="text-slate-400 text-[11px] mb-2">
                    {isAr
                      ? "ملف تنفيذي مدمج بالكامل وبدون إغلاق فوري. نزّله وافتحه بنقرة واحدة."
                      : "Self-contained hybrid launcher with error guard & auto-pause."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={downloadHPBridgeBatchLauncher}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex items-center justify-center gap-2 text-xs shadow transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{isAr ? "تنزيل Start-HP-Scanner.bat" : "Download Start-HP-Scanner.bat"}</span>
                </button>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col justify-between">
                <div>
                  <div className="font-bold text-blue-400 mb-1 flex items-center gap-1.5">
                    <Download className="w-4 h-4" />
                    {isAr ? "الخيار 2: ملف PowerShell (.ps1)" : "Option 2: PowerShell Script (.ps1)"}
                  </div>
                  <p className="text-slate-400 text-[11px] mb-2">
                    {isAr
                      ? "ملف سكريبت مباشر، انقر عليه بزر الفأرة الأيمن واختر (Run with PowerShell)."
                      : "Direct script: Right-click -> Run with PowerShell."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={downloadHPBridgePs1Script}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg font-bold flex items-center justify-center gap-2 text-xs shadow transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{isAr ? "تنزيل HP-Scanner-Bridge.ps1" : "Download .ps1"}</span>
                </button>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col justify-between">
                <div>
                  <div className="font-bold text-amber-400 mb-1 flex items-center gap-1.5">
                    <RefreshCw className="w-4 h-4" />
                    {isAr ? "الخيار 3: فحص حالة المنفذ" : "Option 3: Test Bridge Port"}
                  </div>
                  <p className="text-slate-400 text-[11px] mb-2 font-mono">
                    http://127.0.0.1:18622
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={loadDevices}
                    className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-bold flex items-center justify-center gap-1.5 text-xs transition-all cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{isAr ? "فحص الاتصال" : "Check Status"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCommand}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-bold flex items-center justify-center gap-1 text-xs cursor-pointer"
                    title={isAr ? "نسخ رابط التشخيص" : "Copy Diagnostics URL"}
                  >
                    {copiedCommand ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Diagnostics Box */}
        {!scanResult && (
          <div className="bg-slate-100 dark:bg-slate-800/80 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] grid grid-cols-2 md:grid-cols-5 gap-3">
             <div className="flex flex-col">
               <span className="text-slate-500">{isAr ? "خدمة ERP Scanner" : "ERP Scanner"}</span>
               <span className="font-mono font-bold text-emerald-600">✓ Ready</span>
             </div>
             <div className="flex flex-col">
               <span className="text-slate-500">{isAr ? "جسر HP المحلي" : "HP Bridge"}</span>
               <span className={`font-mono font-bold ${diagnostics.localBridge ? 'text-emerald-600' : 'text-amber-600'}`}>
                 {diagnostics.localBridge ? '✓ Active (18622)' : '⚠️ Offline'}
               </span>
             </div>
             <div className="flex flex-col">
               <span className="text-slate-500">{isAr ? "حالة الطابعة / الماسح" : "HP Scanner State"}</span>
               <span className={`font-mono font-bold ${diagnostics.scannerDevice || diagnostics.localBridge ? 'text-emerald-600' : 'text-slate-400'}`}>
                 {diagnostics.scannerDevice || diagnostics.localBridge ? '✓ Connected' : '—'}
               </span>
             </div>
             <div className="flex flex-col">
               <span className="text-slate-500">{isAr ? "مصدر الورق" : "Paper Source"}</span>
               <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                 {paperSource === "auto" ? (isAr ? "تلقائي" : "Auto") : paperSource === "feeder" ? (isAr ? "درج ADF" : "ADF Feeder") : (isAr ? "سطح زجاجي" : "Flatbed")}
               </span>
             </div>
             <div className="flex flex-col">
               <span className="text-slate-500">{isAr ? "الجهاز المستهدف" : "Target Device"}</span>
               <span className="font-mono font-bold text-slate-700 dark:text-slate-300 truncate" title={diagnostics.deviceName}>
                 {diagnostics.deviceName}
               </span>
             </div>
          </div>
        )}

        {/* Settings Controls */}
        {!scanResult && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
            <div className="col-span-2 md:col-span-2">
              <label className="block text-slate-600 dark:text-slate-400 font-bold mb-1">
                {isAr ? "الماسح / الطابعة المحددة" : "Selected Scanner"}
              </label>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                disabled={isScanning}
                className="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 font-medium dark:text-white text-xs"
              >
                {devices.map((dev) => (
                  <option key={dev.id} value={dev.id}>
                    {dev.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-600 dark:text-slate-400 font-bold mb-1">
                {isAr ? "مسار السحب" : "Paper Source"}
              </label>
              <select
                value={paperSource}
                onChange={(e) => setPaperSource(e.target.value as any)}
                disabled={isScanning}
                className="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 font-medium dark:text-white"
              >
                <option value="auto">{isAr ? "تلقائي (Auto)" : "Auto"}</option>
                <option value="feeder">{isAr ? "درج السحب (ADF)" : "ADF Feeder"}</option>
                <option value="flatbed">{isAr ? "السطح الزجاجي" : "Flatbed"}</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-600 dark:text-slate-400 font-bold mb-1">
                {isAr ? "حجم المستند" : "Doc Size"}
              </label>
              <select
                value={paperSize}
                onChange={(e) => setPaperSize(e.target.value)}
                disabled={isScanning}
                className="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 font-medium dark:text-white"
              >
                <option value="A4">A4 (عقد/مستند)</option>
                <option value="CHEQUE">{isAr ? "شيك بنكي (Cheque)" : "Cheque"}</option>
                <option value="ID">{isAr ? "بطاقة هوية (ID)" : "ID Card"}</option>
                <option value="AUTO">{isAr ? "تلقائي (Auto)" : "Auto"}</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-600 dark:text-slate-400 font-bold mb-1">
                {isAr ? "دقة المسح" : "DPI"}
              </label>
              <select
                value={resolutionDpi}
                onChange={(e) => setResolutionDpi(Number(e.target.value))}
                disabled={isScanning}
                className="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 font-medium dark:text-white"
              >
                <option value={200}>200 DPI (سريع)</option>
                <option value={300}>300 DPI (عالي / قياسي)</option>
                <option value={600}>600 DPI (فائق الدقة)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-600 dark:text-slate-400 font-bold mb-1">
                {isAr ? "نمط الألوان" : "Color"}
              </label>
              <select
                value={colorMode}
                onChange={(e) => setColorMode(e.target.value as any)}
                disabled={isScanning}
                className="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg p-1.5 font-medium dark:text-white"
              >
                <option value="COLOR">{isAr ? "ألوان (Color)" : "Color"}</option>
                <option value="GRAYSCALE">{isAr ? "تدرج رمادي" : "Grayscale"}</option>
                <option value="MONO">{isAr ? "أبيض وأسود" : "B&W"}</option>
              </select>
            </div>
          </div>
        )}

        {/* Live Framing & Scanning Viewport */}
        <div className={`relative w-full ${isFullscreen ? "flex-1 min-h-[60vh]" : "h-[58vh] max-h-[480px] min-h-[280px]"} bg-slate-950 rounded-2xl overflow-hidden border-2 border-slate-800 flex items-center justify-center transition-all shadow-inner`}>
          
          {/* Controls Overlay */}
          {scanResult && (
             <div className="absolute top-4 right-4 flex gap-2 z-30">
               <button onClick={() => setRotation(r => r - 90)} className="bg-black/60 p-2 rounded-lg text-white hover:bg-black/80 backdrop-blur" title={isAr ? "تدوير يسار" : "Rotate Left"}><RotateCw className="w-5 h-5 -scale-x-100" /></button>
               <button onClick={() => setRotation(r => r + 90)} className="bg-black/60 p-2 rounded-lg text-white hover:bg-black/80 backdrop-blur" title={isAr ? "تدوير يمين" : "Rotate Right"}><RotateCw className="w-5 h-5" /></button>
               {!isFullscreen && (
                  <button onClick={() => setIsFullscreen(true)} className="bg-black/60 p-2 rounded-lg text-white hover:bg-black/80 backdrop-blur" title={isAr ? "ملء الشاشة" : "Fullscreen"}><Maximize2 className="w-5 h-5" /></button>
               )}
             </div>
          )}

          {!scanResult ? (
            cameraActive ? (
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover opacity-60"
              />
            ) : (
              <div className="text-center p-6 text-slate-400 space-y-3">
                <Printer className="w-14 h-14 mx-auto text-blue-500 animate-pulse" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-200">
                    {isAr
                      ? "الماسح الضوئي HP Color LaserJet Pro جاهز للاستخدام"
                      : "HP Color LaserJet Pro MFP Scanner Ready"}
                  </p>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    {isAr
                      ? "ضع الشيك أو المستند في درج السحب العلوي (ADF) أو على الزجاج واضغط على [بدء المسح المباشر]."
                      : "Place document in feeder or glass and click [Start Direct Scan]."}
                  </p>
                </div>
              </div>
            )
          ) : (
            <img 
               src={scanResult.imageBase64} 
               alt="Scanned Document" 
               className="w-full h-full object-contain transition-transform duration-300" 
               style={{ transform: `rotate(${rotation}deg)` }}
            />
          )}

          {/* Dynamic Framing Guide Box based on Paper Size */}
          {!scanResult && !isScanning && (
            <div className={`absolute ${paperSize === 'A4' ? 'inset-y-4 inset-x-12' : paperSize === 'ID' ? 'inset-y-24 inset-x-20' : 'inset-y-16 inset-x-8'} border-2 border-dashed border-blue-400/70 rounded-xl pointer-events-none flex flex-col justify-between p-3 transition-all duration-500`}>
              <div className="flex justify-between items-center text-[10px] text-blue-300 font-mono bg-slate-950/70 px-2 py-0.5 rounded backdrop-blur">
                <span>HP M282nw • {paperSize} BOUNDARY</span>
                <span>{resolutionDpi} DPI • {paperSource.toUpperCase()}</span>
              </div>
              <div className="text-center text-[11px] text-blue-200 font-bold bg-slate-950/70 px-3 py-1 rounded backdrop-blur self-center">
                {isAr ? "منطقة المسح الضوئي المباشر" : "Direct Hardware Scan Framing"}
              </div>
              <div className="text-right text-[10px] text-blue-300 font-mono bg-slate-950/70 px-2 py-0.5 rounded backdrop-blur self-end">
                HP LASERJET ENGINE
              </div>
            </div>
          )}

          {/* Scanning Overlay State */}
          {isScanning && (
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center text-white z-20 space-y-4">
              <div className="relative">
                <Printer className="w-12 h-12 text-blue-400 animate-bounce" />
                <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin absolute -bottom-1 -right-1" />
              </div>
              <p className="font-bold text-sm text-blue-300">{scanStatusMsg}</p>
              <div className="w-56 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500 animate-pulse w-full"></div>
              </div>
            </div>
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" />

        {/* Quality indicator / Info */}
        {scanResult && !errorMsg && (
          <div className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 p-2.5 rounded-xl text-xs flex justify-between items-center px-4 border border-emerald-200 dark:border-emerald-800">
             <div className="flex items-center gap-2">
               <CheckCircle2 className="w-4 h-4 text-emerald-600" />
               <span className="font-bold">{isAr ? "تم مسح المستند بنجاح وبدقة عالية" : "Document scanned successfully in high quality"}</span>
             </div>
             <span className="font-mono text-[10px] opacity-80">HP M282nw • {resolutionDpi} DPI • {colorMode}</span>
          </div>
        )}

        {/* Error Notification */}
        {errorMsg && (
          <div className="p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-300 rounded-xl text-xs flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold mb-0.5">
                  {isAr ? "تنبيه اتصال الماسح الضوئي" : "Scanner Connection Notice"}
                </p>
                <p>{errorMsg}</p>
              </div>
            </div>
            {!showBridgeHelp && (
              <button
                type="button"
                onClick={() => setShowBridgeHelp(true)}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shrink-0"
              >
                {isAr ? "طريقة الحل" : "Troubleshoot"}
              </button>
            )}
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isScanning}
              className="px-4 py-2.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-xs font-bold transition-all"
            >
              {isAr ? "إلغاء" : "Cancel"}
            </button>
            
            <button
              type="button"
              onClick={() => setShowBridgeHelp(!showBridgeHelp)}
              className="px-3 py-2.5 text-slate-600 dark:text-slate-400 hover:text-blue-600 text-xs font-bold flex items-center gap-1.5 transition-all"
            >
              <HelpCircle className="w-4 h-4" />
              <span>{isAr ? "أداة HP Bridge" : "HP Bridge Tool"}</span>
            </button>
          </div>
          
          <div className="flex gap-2">
             {!scanResult ? (
                <div className="flex gap-2">
                  <input 
                    type="file" 
                    accept="image/*,application/pdf" 
                    className="hidden" 
                    id="scanner-upload-fallback"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          setScanResult({ 
                            imageBase64: event.target?.result as string, 
                            mimeType: file.type 
                          });
                          setErrorMsg(null);
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                  <label
                    htmlFor="scanner-upload-fallback"
                    className="px-4 py-2.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{isAr ? "رفع ملف يدوي" : "Upload File"}</span>
                  </label>

                  <button
                    type="button"
                    onClick={handleExecuteScan}
                    disabled={isScanning}
                    className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-blue-600/20 transition-all disabled:opacity-50"
                  >
                    {isScanning ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>{isAr ? "جاري سحب المستند..." : "Scanning HP Hardware..."}</span>
                      </>
                    ) : (
                      <>
                        <Printer className="w-4 h-4" />
                        <span>{isAr ? "بدء المسح المباشر من HP" : "Start Direct HP Scan"}</span>
                      </>
                    )}
                  </button>
                </div>
             ) : (
                <>
                  <button
                    type="button"
                    onClick={handleRescan}
                    className="px-4 py-2.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 transition-all"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>{isAr ? "إعادة المسح" : "Rescan"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
                  >
                    <Check className="w-4 h-4" />
                    <span>{isAr ? "اعتماد المستند الممسوح" : "Confirm Document"}</span>
                  </button>
                </>
             )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export const DocumentScannerModal = ScannerModal;

