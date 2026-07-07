# 软件工具

这个仓库用于保存和同步个人常用小工具，包含可直接使用的工具文件，以及后续二次开发需要的源码。

## 当前内容

- `实习/HEX转图片/hex-to-image.html`：HEX 数据转图片的网页工具。
- `实习/MCU转图片/mcu_to_rgb.html`：MCU 图像数据转 RGB 图片的网页工具。
- `课题组/txt2excel/`：TXT 转 Excel 工具，包含 Python 源码、运行脚本和已打包的 exe。

## TXT 转 Excel

源码入口：

```powershell
cd "课题组\txt2excel"
python app.py
```

安装依赖：

```powershell
pip install -r requirements.txt
```

也可以直接运行已打包文件：

```powershell
"课题组\txt2excel\dist\TXT转Excel.exe"
```

## Git 管理说明

仓库会保留源码、HTML 工具、运行脚本、依赖文件和体积不大的可执行文件。

以下内容不会提交：

- `.vscode/`：本机 VS Code 配置。
- `.claude/`：本机助手配置和权限记录。
- `__pycache__/`、`build/`、`*.spec`：Python 缓存和打包临时文件。
- `*.log`、`*.tmp`、`*.bak` 等临时文件。

这样另一台电脑既可以直接使用工具，也可以重新配置自己的开发环境继续二次开发。