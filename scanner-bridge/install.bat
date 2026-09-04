@echo off
echo ========================================================
echo Emirates Falcon ERP - Local Scanner Bridge Installer
echo ========================================================
echo.
echo Installing Node.js dependencies...
call npm install

echo.
echo Registering Windows Startup Task for WIA Scanner Bridge...
echo This will run the Bridge in your active Windows Session (Required for WIA)

set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set VBS_FILE=%STARTUP_DIR%\EmiratesFalconScanner.vbs

echo Set WshShell = CreateObject("WScript.Shell") > "%VBS_FILE%"
echo WshShell.Run "node """ ^& "%~dp0server.js" ^& """", 0, False >> "%VBS_FILE%"

echo.
echo Starting the Scanner Bridge Service now...
start /B cscript "%VBS_FILE%"

echo.
echo ========================================================
echo Installation Complete!
echo The Bridge is now running silently in the background and 
echo will auto-start whenever you log into Windows.
echo WIA interface active on http://127.0.0.1:18622
echo ========================================================
pause

