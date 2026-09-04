import React, { useState, useEffect } from "react";
import { Database, RefreshCw, CheckCircle2, AlertCircle, Wifi, WifiOff, Server, Activity, ShieldCheck, Zap } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { db } from "../../lib/firebase";
import { doc, getDocFromServer, enableNetwork, disableNetwork } from "firebase/firestore";
import firebaseConfig from "../../../firebase-applet-config.json";

export const FirebaseConnectionTester: React.FC = () => {
  const { language } = useLanguage();
  const [status, setStatus] = useState<"CONNECTED" | "DISCONNECTED" | "CHECKING">("CHECKING");
  const [latency, setLatency] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAutoReconnecting, setIsAutoReconnecting] = useState<boolean>(false);
  const [testLog, setTestLog] = useState<string[]>([]);

  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setTestLog(prev => [`[${timestamp}] ${msg}`, ...prev.slice(0, 19)]);
  };

  const testConnection = async (isAuto = false) => {
    setStatus("CHECKING");
    if (isAuto) {
      setIsAutoReconnecting(true);
      addLog(language === "ar" ? "محاولة إعادة الاتصال تلقائياً بخدمة Firebase..." : "Attempting automatic reconnection to Firebase...");
    } else {
      addLog(language === "ar" ? "بدء فحص اتصال قاعدة البيانات..." : "Starting database connection test...");
    }

    const startTime = performance.now();

    try {
      if (isAuto) {
        // Attempt to re-enable network if previously offline
        try {
          await enableNetwork(db);
          addLog(language === "ar" ? "تم إرسال أمر تفعيل الشبكة بنجاح." : "Network enabled successfully.");
        } catch (netErr) {
          console.warn("enableNetwork note:", netErr);
        }
      }

      // Perform a server fetch test to verify live connection
      const testRef = doc(db, "_system_health", "connection_probe");
      await getDocFromServer(testRef);

      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);
      
      setLatency(duration);
      setStatus("CONNECTED");
      setErrorMessage(null);
      setLastChecked(new Date().toLocaleString());
      addLog(language === "ar" ? `✅ نجح الاتصال بقاعدة البيانات بنجاح (${duration}ms)` : `✅ Database connection successful (${duration}ms)`);
    } catch (err: any) {
      const errText = err?.message || String(err);
      setLatency(null);
      setStatus("DISCONNECTED");
      setErrorMessage(errText);
      setLastChecked(new Date().toLocaleString());
      addLog(language === "ar" ? `❌ فشل الاتصال: ${errText}` : `❌ Connection failed: ${errText}`);
    } finally {
      setIsAutoReconnecting(false);
    }
  };

  useEffect(() => {
    testConnection();
  }, []);

  const handleAutoReconnect = async () => {
    await testConnection(true);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
              status === "CONNECTED" ? "bg-emerald-50 text-emerald-600" :
              status === "DISCONNECTED" ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600 animate-pulse"
            }`}>
              {status === "CONNECTED" ? <Wifi className="w-6 h-6" /> :
               status === "DISCONNECTED" ? <WifiOff className="w-6 h-6" /> :
               <Activity className="w-6 h-6 animate-spin" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {language === "ar" ? "لوحة فحص وإدارة اتصال قاعدة البيانات (Firebase)" : "Firebase Connection & Diagnostics Center"}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {language === "ar"
                  ? "مراقبة حالة الاتصال بالخادم السحابي وإعادة الاتصال التلقائي الفوري"
                  : "Monitor cloud database connectivity status and trigger instant auto-reconnect"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => testConnection(false)}
              disabled={status === "CHECKING"}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold inline-flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${status === "CHECKING" ? "animate-spin" : ""}`} />
              <span>{language === "ar" ? "فحص الاتصال الآن" : "Test Now"}</span>
            </button>

            <button
              onClick={handleAutoReconnect}
              disabled={isAutoReconnecting || status === "CHECKING"}
              className="px-4 py-2.5 bg-amber-700 hover:bg-amber-800 text-white rounded-xl text-xs font-bold inline-flex items-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50"
            >
              <Zap className={`w-4 h-4 ${isAutoReconnecting ? "animate-bounce" : ""}`} />
              <span>{language === "ar" ? "إعادة الاتصال تلقائياً" : "Auto-Reconnect"}</span>
            </button>
          </div>
        </div>

        {/* Status Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              {language === "ar" ? "حالة الاتصال الحالية" : "Connection Status"}
            </span>
            <div className="flex items-center gap-2 mt-2">
              <span className={`w-3 h-3 rounded-full ${
                status === "CONNECTED" ? "bg-emerald-500 animate-pulse" :
                status === "DISCONNECTED" ? "bg-rose-500" : "bg-amber-500 animate-ping"
              }`} />
              <span className={`text-sm font-black ${
                status === "CONNECTED" ? "text-emerald-700" :
                status === "DISCONNECTED" ? "text-rose-700" : "text-amber-700"
              }`}>
                {status === "CONNECTED" ? (language === "ar" ? "متصل بنجاح (Online)" : "Connected (Online)") :
                 status === "DISCONNECTED" ? (language === "ar" ? "منقطع / غير متصل" : "Disconnected / Offline") :
                 (language === "ar" ? "جاري الفحص..." : "Checking...")}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              {language === "ar" ? "سرعة الاستجابة (Latency)" : "Roundtrip Latency"}
            </span>
            <div className="text-sm font-black text-slate-800 mt-2">
              {latency !== null ? `${latency} ms` : (language === "ar" ? "غير متوفر" : "N/A")}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              {language === "ar" ? "آخر وقت فحص" : "Last Checked At"}
            </span>
            <div className="text-xs font-bold text-slate-700 mt-2 truncate">
              {lastChecked || (language === "ar" ? "لم يُفحص بعد" : "Not yet checked")}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              {language === "ar" ? "معرّف قاعدة البيانات" : "Database ID"}
            </span>
            <div className="text-[11px] font-mono text-slate-700 mt-2 truncate" title={firebaseConfig.firestoreDatabaseId}>
              {firebaseConfig.firestoreDatabaseId}
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="mt-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block mb-1">
                {language === "ar" ? "تفاصيل الخطأ في الاتصال:" : "Connection Error Details:"}
              </span>
              <span className="font-mono text-[11px] break-all">{errorMessage}</span>
            </div>
          </div>
        )}

        {/* Live Diagnostics Log */}
        <div className="mt-6">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
            {language === "ar" ? "سجل الفحص المباشر وإعادة الاتصال" : "Live Diagnostics & Reconnect Log"}
          </h4>
          <div className="bg-slate-900 text-slate-200 font-mono text-xs p-4 rounded-2xl max-h-48 overflow-y-auto space-y-1.5 shadow-inner">
            {testLog.length === 0 ? (
              <div className="text-slate-500 italic">
                {language === "ar" ? "لا توجد سجلات بعد..." : "No logs recorded yet..."}
              </div>
            ) : (
              testLog.map((log, idx) => (
                <div key={idx} className={log.includes("✅") ? "text-emerald-400 font-bold" : log.includes("❌") ? "text-rose-400 font-bold" : "text-slate-300"}>
                  {log}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Configuration Summary */}
        <div className="mt-6 pt-6 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
          <div>
            <span className="font-bold text-slate-800 block mb-1">
              {language === "ar" ? "مشروع Firebase المرتبط:" : "Linked Firebase Project:"}
            </span>
            <span className="font-mono text-slate-500">{firebaseConfig.projectId}</span>
          </div>
          <div>
            <span className="font-bold text-slate-800 block mb-1">
              {language === "ar" ? "نطاق المصادقة (Auth Domain):" : "Auth Domain:"}
            </span>
            <span className="font-mono text-slate-500">{firebaseConfig.authDomain}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
