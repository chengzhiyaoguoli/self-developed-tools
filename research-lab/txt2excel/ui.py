"""
GUI 界面 — 基于 tkinter + tkinterdnd2 的拖拽式 TXT 转 Excel 工具。

支持:
    - 拖拽 TXT 文件到窗口 / 通过按钮选择
    - 文件列表显示（文件名、行数、通道数、解析状态）
    - 输出模式选择（合并为单文件 / 独立生成）
    - 转换进度和状态反馈
"""

import os
import re
import sys
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from parser import parse_txt_file
from writer import write_single_workbook, write_individual_files

# ── 尝试导入 tkinterdnd2 ──────────────────────────────
try:
    from tkinterdnd2 import TkinterDnD, DND_FILES
    _DND_AVAILABLE = True
except ImportError:
    TkinterDnD = None
    DND_FILES = None
    _DND_AVAILABLE = False


class AppWindow:
    """主应用程序窗口"""

    # ── 窗口配置 ──────────────────────────────────────────
    TITLE = "TXT to Excel 转换工具"
    DEFAULT_WIDTH = 720
    DEFAULT_HEIGHT = 550
    MIN_WIDTH = 550
    MIN_HEIGHT = 420

    def __init__(self, root=None):
        # 如果提供了 root（TkinterDnD.Tk 实例），直接使用；否则创建普通 tk.Tk
        if root is not None:
            self.root = root
        elif _DND_AVAILABLE:
            self.root = TkinterDnD.Tk()
        else:
            self.root = tk.Tk()

        self.root.title(self.TITLE)
        self.root.geometry(f"{self.DEFAULT_WIDTH}x{self.DEFAULT_HEIGHT}")
        self.root.minsize(self.MIN_WIDTH, self.MIN_HEIGHT)

        # 数据存储
        self._file_data = {}  # {filepath: parsed_result_dict}
        self._file_order = []  # 保持文件添加顺序

        # ========== 构建界面 ==========
        self._build_menu()
        self._build_drop_zone()
        self._build_file_list()
        self._build_output_options()
        self._build_buttons()
        self._build_status_bar()

        # ========== 配置拖拽 ==========
        self._setup_drag_drop()

        # ========== 窗口关闭事件 ==========
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ═══════════════════════════════════════════════════════════
    #  构建 UI 组件
    # ═══════════════════════════════════════════════════════════

    def _build_menu(self):
        """构建菜单栏"""
        menubar = tk.Menu(self.root)
        self.root.config(menu=menubar)

        file_menu = tk.Menu(menubar, tearoff=0)
        file_menu.add_command(label="添加文件...", command=self._add_files_dialog)
        file_menu.add_separator()
        file_menu.add_command(label="退出", command=self._on_close)
        menubar.add_cascade(label="文件", menu=file_menu)

        help_menu = tk.Menu(menubar, tearoff=0)
        help_menu.add_command(label="关于", command=self._show_about)
        menubar.add_cascade(label="帮助", menu=help_menu)

    def _build_drop_zone(self):
        """构建拖拽区域"""
        frame = ttk.LabelFrame(self.root, text="拖拽区域", padding=2)
        frame.pack(fill=tk.X, padx=12, pady=(12, 4))

        self.drop_label = tk.Label(
            frame,
            text="拖拽 TXT 文件到此处\n或点击下方 \"添加文件\" 按钮",
            font=("Microsoft YaHei UI", 11),
            bg="#f0f5ff",
            fg="#444444",
            relief=tk.GROOVE,
            bd=2,
            height=4,
            cursor="hand2",
        )
        self.drop_label.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)

        # 拖拽悬停效果
        self._drop_normal_bg = "#f0f5ff"
        self._drop_hover_bg = "#d9e8ff"

    def _build_file_list(self):
        """构建文件列表（Treeview）"""
        frame = ttk.LabelFrame(self.root, text="文件列表", padding=2)
        frame.pack(fill=tk.BOTH, expand=True, padx=12, pady=4)

        # Treeview
        columns = ("filename", "lines", "data_rows", "channels", "status")
        self.tree = ttk.Treeview(
            frame,
            columns=columns,
            show="headings",
            selectmode="extended",
            height=8,
        )

        self.tree.heading("filename", text="文件名", anchor=tk.W)
        self.tree.heading("lines", text="总行数", anchor=tk.CENTER)
        self.tree.heading("data_rows", text="数据行", anchor=tk.CENTER)
        self.tree.heading("channels", text="通道数", anchor=tk.CENTER)
        self.tree.heading("status", text="状态", anchor=tk.CENTER)

        self.tree.column("filename", width=280, minwidth=120)
        self.tree.column("lines", width=70, minwidth=60, anchor=tk.CENTER)
        self.tree.column("data_rows", width=70, minwidth=60, anchor=tk.CENTER)
        self.tree.column("channels", width=70, minwidth=60, anchor=tk.CENTER)
        self.tree.column("status", width=80, minwidth=60, anchor=tk.CENTER)

        # 滚动条
        scrollbar = ttk.Scrollbar(frame, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)

        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # 右键菜单
        self._tree_menu = tk.Menu(self.tree, tearoff=0)
        self._tree_menu.add_command(label="移除选中", command=self._remove_selected)
        self._tree_menu.add_command(label="清空全部", command=self._clear_all)
        self.tree.bind("<Button-3>", self._on_tree_right_click)
        # 双击打开文件所在文件夹
        self.tree.bind("<Double-1>", self._on_tree_double_click)

    def _build_output_options(self):
        """构建输出模式选择"""
        frame = ttk.LabelFrame(self.root, text="输出模式", padding=6)
        frame.pack(fill=tk.X, padx=12, pady=4)

        self.output_mode = tk.StringVar(value="single")

        rb1 = ttk.Radiobutton(
            frame,
            text="合并为一个 Excel 文件（每个 TXT → 一个 Sheet）",
            variable=self.output_mode,
            value="single",
        )
        rb1.pack(anchor=tk.W, pady=1)

        rb2 = ttk.Radiobutton(
            frame,
            text="分别生成独立的 Excel 文件（每个 TXT → 一个 .xlsx）",
            variable=self.output_mode,
            value="individual",
        )
        rb2.pack(anchor=tk.W, pady=1)

    def _build_buttons(self):
        """构建按钮栏"""
        frame = ttk.Frame(self.root)
        frame.pack(fill=tk.X, padx=12, pady=(6, 4))

        self.btn_add = ttk.Button(frame, text="＋ 添加文件", command=self._add_files_dialog)
        self.btn_add.pack(side=tk.LEFT, padx=(0, 6))

        self.btn_remove = ttk.Button(frame, text="✕ 移除选中", command=self._remove_selected)
        self.btn_remove.pack(side=tk.LEFT, padx=6)

        self.btn_clear = ttk.Button(frame, text="清空全部", command=self._clear_all)
        self.btn_clear.pack(side=tk.LEFT, padx=6)

        # 转换按钮（右侧，加粗样式）
        self.btn_convert = ttk.Button(
            frame,
            text="➤  转换为 Excel",
            command=self._convert,
        )
        self.btn_convert.pack(side=tk.RIGHT, padx=(6, 0))

    def _build_status_bar(self):
        """构建状态栏"""
        frame = ttk.Frame(self.root, relief=tk.SUNKEN, borderwidth=1)
        frame.pack(side=tk.BOTTOM, fill=tk.X)

        self.status_var = tk.StringVar(value="就绪 — 请添加 TXT 文件")
        status_label = ttk.Label(frame, textvariable=self.status_var, padding=(8, 3))
        status_label.pack(side=tk.LEFT, fill=tk.X, expand=True)

        self.progress = ttk.Progressbar(frame, mode="indeterminate", length=100)
        # 初始隐藏，转换时显示

    # ═══════════════════════════════════════════════════════════
    #  拖拽支持
    # ═══════════════════════════════════════════════════════════

    def _setup_drag_drop(self):
        """配置 tkinterdnd2 拖拽支持"""
        if not _DND_AVAILABLE:
            # tkinterdnd2 未安装，拖拽不可用但仍可通过按钮添加文件
            self._drag_available = False
            self.drop_label.config(
                text="拖拽功能未启用（需要安装 tkinterdnd2）\n请点击下方 \"添加文件\" 按钮选择 TXT 文件",
                bg="#fff3f0",
                cursor="",
            )
            return

        self._drag_available = True

        # 如果 root 不是 TkinterDnD.Tk 实例，尝试转换
        # 注意：由于窗口已在 __init__ 中创建，这里只能注册 drop target

        self.drop_label.drop_target_register(DND_FILES)
        self.drop_label.dnd_bind("<<DropEnter>>", self._on_drop_enter)
        self.drop_label.dnd_bind("<<DropLeave>>", self._on_drop_leave)
        self.drop_label.dnd_bind("<<Drop>>", self._on_drop)

        # 也允许拖到 Treeview
        self.tree.drop_target_register(DND_FILES)
        self.tree.dnd_bind("<<Drop>>", self._on_drop)

    def _on_drop_enter(self, event):
        """拖拽进入时的视觉反馈"""
        self.drop_label.config(bg=self._drop_hover_bg)

    def _on_drop_leave(self, event):
        """拖拽离开时恢复"""
        self.drop_label.config(bg=self._drop_normal_bg)

    def _on_drop(self, event):
        """处理拖拽释放"""
        self.drop_label.config(bg=self._drop_normal_bg)

        data = event.data
        # Windows Explorer 拖拽格式: {path1} {path2} 或 path1 path2
        # 用正则提取路径
        paths = []
        # 匹配 {path} 形式（含空格路径）
        paths += re.findall(r'\{([^}]+)\}', data)
        # 去掉已匹配的 {...} 部分，剩余为无空格路径
        remaining = re.sub(r'\{[^}]+\}', '', data)
        paths += [p for p in remaining.split() if p]

        # 过滤：只保留 .txt 文件
        txt_files = [p for p in paths if p.lower().endswith(".txt")]
        non_txt = [p for p in paths if not p.lower().endswith(".txt")]

        if non_txt:
            self._set_status(f"已忽略 {len(non_txt)} 个非 TXT 文件")

        if txt_files:
            self._add_files(txt_files)
        else:
            self._set_status("未找到有效的 TXT 文件")

    # ═══════════════════════════════════════════════════════════
    #  文件管理
    # ═══════════════════════════════════════════════════════════

    def _add_files_dialog(self):
        """通过文件对话框添加文件"""
        filepaths = filedialog.askopenfilenames(
            title="选择 TXT 文件",
            filetypes=[("文本文件", "*.txt"), ("所有文件", "*.*")],
        )
        if filepaths:
            self._add_files(filepaths)

    def _add_files(self, filepaths):
        """
        添加文件到列表并解析。

        Args:
            filepaths: 文件路径列表
        """
        added = 0
        skipped = 0

        for fp in filepaths:
            # 规范化路径
            fp = os.path.normpath(os.path.abspath(fp))

            # 跳过已存在的文件
            if fp in self._file_data:
                skipped += 1
                continue

            # 检查文件是否存在
            if not os.path.isfile(fp):
                continue

            # 解析文件
            result = parse_txt_file(fp)
            self._file_data[fp] = result
            self._file_order.append(fp)
            added += 1

            # 插入 Treeview
            status_text = "✅ 就绪"
            if result["errors"]:
                status_text = f"⚠  {len(result['errors'])} 行异常"

            self.tree.insert(
                "",
                tk.END,
                iid=fp,  # 用路径作为唯一标识
                values=(
                    result["filename"],
                    result["line_count"],
                    result["data_count"],
                    len(result["channels"]),
                    status_text,
                ),
            )

        # 更新状态
        total = len(self._file_order)
        if added > 0:
            self._set_status(f"已添加 {added} 个文件，当前共 {total} 个文件")
        elif skipped > 0 and added == 0:
            self._set_status(f"所有文件已存在（跳过 {skipped} 个），当前共 {total} 个文件")

        if not self._file_order:
            self._set_status("就绪 — 请添加 TXT 文件")

    def _remove_selected(self):
        """移除选中的文件"""
        selections = self.tree.selection()
        if not selections:
            messagebox.showinfo("提示", "请先在文件列表中选择要移除的文件。")
            return

        for fp in selections:
            self.tree.delete(fp)
            if fp in self._file_data:
                del self._file_data[fp]
            if fp in self._file_order:
                self._file_order.remove(fp)

        total = len(self._file_order)
        self._set_status(f"已移除 {len(selections)} 个文件，当前共 {total} 个文件")

    def _clear_all(self):
        """清空全部文件"""
        if not self._file_order:
            return

        if messagebox.askyesno("确认清空", f"确定要清空全部 {len(self._file_order)} 个文件吗？"):
            for fp in list(self.tree.get_children()):
                self.tree.delete(fp)
            self._file_data.clear()
            self._file_order.clear()
            self._set_status("已清空 — 请添加 TXT 文件")

    # ═══════════════════════════════════════════════════════════
    #  转换
    # ═══════════════════════════════════════════════════════════

    def _convert(self):
        """执行转换"""
        if not self._file_order:
            messagebox.showwarning("无文件", "请先添加要转换的 TXT 文件。")
            return

        # 收集已解析的数据（按添加顺序）
        parsed_files = [self._file_data[fp] for fp in self._file_order]

        # 检查是否有解析错误
        total_errors = sum(len(pf["errors"]) for pf in parsed_files)
        if total_errors > 0:
            error_files = [pf for pf in parsed_files if pf["errors"]]
            msg_lines = ["以下文件存在解析异常:\n"]
            for pf in error_files:
                msg_lines.append(f"  • {pf['filename']}: {len(pf['errors'])} 行无法解析")
            msg_lines.append(f"\n共 {total_errors} 行异常，是否继续转换？")
            if not messagebox.askyesno("解析警告", "\n".join(msg_lines)):
                return

        mode = self.output_mode.get()

        if mode == "single":
            self._convert_single(parsed_files)
        else:
            self._convert_individual(parsed_files)

    def _convert_single(self, parsed_files):
        """合并为单一 Excel 文件"""
        # 选择保存位置
        default_name = "converted_data.xlsx"
        output_path = filedialog.asksaveasfilename(
            title="保存 Excel 文件",
            defaultextension=".xlsx",
            filetypes=[("Excel 文件", "*.xlsx")],
            initialfile=default_name,
        )
        if not output_path:
            self._set_status("已取消保存")
            return

        self._start_progress(f"正在生成 Excel（{len(parsed_files)} 个 Sheet）...")

        # 在后台线程执行写入
        def task():
            success, msg = write_single_workbook(parsed_files, output_path)
            self.root.after(0, lambda: self._finish_convert(success, msg))

        threading.Thread(target=task, daemon=True).start()

    def _convert_individual(self, parsed_files):
        """每个文件独立生成 Excel"""
        # 选择输出目录
        output_dir = filedialog.askdirectory(title="选择输出目录")
        if not output_dir:
            self._set_status("已取消输出")
            return

        self._start_progress(f"正在生成 {len(parsed_files)} 个 Excel 文件...")

        def task():
            results = write_individual_files(parsed_files, output_dir)
            success_count = sum(1 for _, ok, _ in results if ok)
            fail_count = len(results) - success_count

            def callback():
                self._stop_progress()
                if fail_count == 0:
                    self._set_status(f"✅ 全部完成！已生成 {success_count} 个 Excel 文件到: {output_dir}")
                    messagebox.showinfo("转换完成", f"成功生成 {success_count} 个 Excel 文件！\n\n输出目录:\n{output_dir}")
                else:
                    failed_files = [(fn, msg) for fn, ok, msg in results if not ok]
                    fail_msg = "\n".join([f"  • {fn}: {msg}" for fn, msg in failed_files])
                    self._set_status(f"⚠ 部分完成: {success_count} 成功, {fail_count} 失败")
                    messagebox.showwarning("转换完成（有错误）",
                                           f"成功: {success_count} 个\n失败: {fail_count} 个\n\n失败详情:\n{fail_msg}")

            self.root.after(0, callback)

        threading.Thread(target=task, daemon=True).start()

    def _finish_convert(self, success, msg):
        """转换完成后的回调（主线程）"""
        self._stop_progress()
        self._set_status(msg)

        if success:
            messagebox.showinfo("转换完成", msg)
        else:
            messagebox.showerror("转换失败", msg)

    # ═══════════════════════════════════════════════════════════
    #  辅助方法
    # ═══════════════════════════════════════════════════════════

    def _set_status(self, text):
        """更新状态栏文本"""
        self.status_var.set(text)

    def _start_progress(self, text):
        """显示进度条并更新状态"""
        self._set_status(text)
        self.progress.pack(side=tk.RIGHT, padx=4, pady=2)
        self.progress.start(15)
        self.btn_convert.config(state=tk.DISABLED)
        self.btn_add.config(state=tk.DISABLED)
        self.btn_remove.config(state=tk.DISABLED)
        self.btn_clear.config(state=tk.DISABLED)

    def _stop_progress(self):
        """隐藏进度条并恢复按钮"""
        self.progress.stop()
        self.progress.pack_forget()
        self.btn_convert.config(state=tk.NORMAL)
        self.btn_add.config(state=tk.NORMAL)
        self.btn_remove.config(state=tk.NORMAL)
        self.btn_clear.config(state=tk.NORMAL)

    # ═══════════════════════════════════════════════════════════
    #  事件处理
    # ═══════════════════════════════════════════════════════════

    def _on_tree_right_click(self, event):
        """右键菜单"""
        item = self.tree.identify_row(event.y)
        if item:
            self.tree.selection_set(item)
        self._tree_menu.tk_popup(event.x_root, event.y_root)

    def _on_tree_double_click(self, event):
        """双击：用资源管理器打开文件所在目录并选中文件"""
        item = self.tree.identify_row(event.y)
        if item and item in self._file_data:
            # 打开文件所在文件夹
            filepath = item
            if sys.platform == "win32":
                os.startfile(os.path.dirname(filepath))
            else:
                import subprocess
                subprocess.run(["xdg-open", os.path.dirname(filepath)])

    def _on_close(self):
        """关闭窗口"""
        self.root.destroy()

    def _show_about(self):
        """关于对话框"""
        messagebox.showinfo(
            "关于",
            "TXT to Excel 转换工具  V1.0\n\n"
            "作者：橙汁\n\n"
            "适用格式：\n"
            "  CHx = xxx, CHy = yyy, ...\n"
            "  即每行以逗号分隔的通道-值对，\n"
            "  行首可选带序号前缀（如 \"1\\tCH0 = ...\"）。\n"
            "  仅支持此格式，其他格式将无法解析。\n\n"
            "功能：\n"
            "  • 拖拽或选择 TXT 文件批量导入\n"
            "  • 自动检测通道，智能纠正常见笔误\n"
            "  • 支持合并为一个 Excel（多 Sheet）\n"
            "    或分别生成独立 Excel 文件\n"
            "  • 通道数、行数无限制",
        )

    # ═══════════════════════════════════════════════════════════
    #  启动
    # ═══════════════════════════════════════════════════════════

    def run(self):
        """启动主循环"""
        self.root.mainloop()
