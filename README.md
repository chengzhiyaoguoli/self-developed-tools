# self-developed-tools

这个仓库用于保存和同步个人自研小工具，包含可直接使用的网页工具、桌面/脚本工具，以及后续维护需要的源代码。

## 在线访问

如果仓库已经开启 GitHub Pages，并且发布源设置为 `main / root`，仓库里的静态 HTML 工具可以像网页一样访问。

- ResiScope：<https://chengzhiyaoguoli.github.io/self-developed-tools/research-lab/ResiScope/ResiScope.html>
- HEX 转图片：<https://chengzhiyaoguoli.github.io/self-developed-tools/internship/hex-to-image/hex-to-image.html>
- MCU 转 RGB 图片：<https://chengzhiyaoguoli.github.io/self-developed-tools/internship/mcu-to-rgb/mcu_to_rgb.html>

> GitHub Pages 只负责托管静态文件，不会自动列出目录；需要知道具体 HTML 路径才能访问。

## 当前内容

- `research-lab/ResiScope/ResiScope.html`：电阻曲线预览、编辑与导出工具，支持 Excel/CSV/TSV、多通道曲线、框选处理、滤波、基线响应、导出 Excel 等功能。
- `research-lab/txt2excel/`：TXT 转 Excel 工具，包含 Python 源码、运行脚本和已打包的 exe。
- `internship/hex-to-image/hex-to-image.html`：HEX 数据转图片的网页工具。
- `internship/mcu-to-rgb/mcu_to_rgb.html`：MCU 图像数据转 RGB 图片的网页工具。

## ResiScope

本地直接打开：

```text
research-lab/ResiScope/ResiScope.html
```

主要用途：

- 读取 `.xlsx / .csv / .tsv` 数据文件。
- 预览多通道电阻曲线。
- 框选局部数据后进行加减乘除、公式处理、滤波、删除、纵向移动和撤销。
- 设置通道基线，显示/导出响应值和响应百分比。
- 导出为新 Excel，或基于原 xlsx 导出添加修改 sheet 的副本。

## TXT 转 Excel

源码入口：

```powershell
cd "research-lab\txt2excel"
python app.py
```

安装依赖：

```powershell
pip install -r requirements.txt
```

也可以直接运行已打包文件：

```powershell
"research-lab\txt2excel\dist\TXT转Excel.exe"
```

## Git 管理说明

仓库会保留源码、HTML 工具、运行脚本、依赖文件和体积不大的可执行文件。

以下内容不会提交：

- `.vscode/`：本机 VS Code 配置。
- `.claude/`：本机助手配置和权限记录。
- `__pycache__/`、`build/`、`*.spec`：Python 缓存和打包临时文件。
- `*.log`、`*.tmp`、`*.bak` 等临时文件。

这样另一台电脑既可以直接使用工具，也可以重新配置开发环境继续维护。
