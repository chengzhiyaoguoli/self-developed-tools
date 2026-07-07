@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo    TXT to Excel 转换工具
echo ============================================
echo.

:: 检查 Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Python，请先安装 Python 3.11+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: 检查并安装依赖
echo [1/2] 检查依赖...
python -c "import openpyxl; import tkinterdnd2" >nul 2>&1
if %errorlevel% neq 0 (
    echo 正在安装依赖包...
    pip install openpyxl tkinterdnd2
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败，请手动运行: pip install openpyxl tkinterdnd2
        pause
        exit /b 1
    )
)
echo       依赖就绪。

:: 启动应用
echo [2/2] 启动 GUI...
echo.

:: 如果有拖拽的文件，传给 app.py
if "%~1"=="" (
    python "%~dp0app.py"
) else (
    python "%~dp0app.py" %*
)

pause
