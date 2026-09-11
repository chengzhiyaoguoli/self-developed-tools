@echo off
setlocal enabledelayedexpansion
rem ------------------------------------------------------------------
rem LabScope 启动器。本文件编码为 GBK(936) + CRLF，请勿另存为 UTF-8 或 LF。
rem 端口从 8080 起探测，被占用则递增，最多到 8090。
rem 若检测到已有 LabScope 在运行，直接打开它的地址（避免开出第二个窗口）。
rem ------------------------------------------------------------------
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 18 或更高版本: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

rem —— 已有实例在运行吗？（读采集锁里的端口，再确认该端口真的有 LabScope）——
set "LPORT="
if exist "data\collector.lock" (
  for /f "usebackq tokens=1,2 delims=:" %%a in ("data\collector.lock") do set "LPORT=%%b"
)
if defined LPORT (
  curl -s -o nul --max-time 2 "http://127.0.0.1:!LPORT!/api/status" >nul 2>nul
  if !errorlevel! equ 0 (
    echo LabScope 已在运行，端口 !LPORT! —— 直接打开页面。
    start "" "http://localhost:!LPORT!/"
    exit /b 0
  )
)

set "PORT=8080"
:probe
netstat -ano -p TCP | findstr /i "LISTENING" | findstr /c:":!PORT! " >nul 2>nul
if not errorlevel 1 (
  echo 端口 !PORT! 已被占用，尝试下一个端口 ...
  set /a PORT+=1
  if !PORT! gtr 8090 (
    echo [错误] 8080-8090 全部被占用，请手动指定端口后运行: set PORT=9000 ^& node server.js
    echo.
    pause
    exit /b 1
  )
  goto :probe
)

echo.
echo 正在启动 LabScope ...
echo 服务地址: http://localhost:!PORT!  （局域网设备可用本机 IP 加同一端口访问）
echo 浏览器将在约 2 秒后自动打开；关闭本窗口或按 Ctrl+C 停止服务。
echo.
start /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:!PORT!"
node server.js
echo.
echo 服务已停止，按任意键关闭窗口。
pause >nul
