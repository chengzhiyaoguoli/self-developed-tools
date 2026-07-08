"""
TXT to Excel 转换工具 — 入口脚本。

用法:
    python app.py              # 启动 GUI
    python app.py file1.txt    # 启动 GUI 并自动加载指定文件

将 TXT 测量数据文件转换为 Excel 格式 (.xlsx)。
支持拖拽添加文件、通道自动检测、批量处理。
"""

import os
import sys

# 确保能从当前目录导入模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ui import AppWindow, _DND_AVAILABLE, TkinterDnD


def main():
    # 创建主窗口（优先使用 TkinterDnD 以支持拖拽）
    if _DND_AVAILABLE:
        root = TkinterDnD.Tk()
    else:
        import tkinter as tk
        root = tk.Tk()

    app = AppWindow(root=root)

    # 支持命令行参数：拖拽或传参进来的 TXT 文件
    if len(sys.argv) > 1:
        files = []
        for arg in sys.argv[1:]:
            path = os.path.abspath(arg)
            if os.path.isfile(path) and path.lower().endswith(".txt"):
                files.append(path)
        if files:
            app._add_files(files)

    app.run()


if __name__ == "__main__":
    main()
