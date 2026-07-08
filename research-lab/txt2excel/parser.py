"""
TXT 文件解析器 — 自动检测通道，提取测量数据。

支持格式:
    CH0 = 6833364, CH1 = 142708897, ..., CH6 = 32893443
行首可能带有可选的序号前缀（如 "1\tCH0 = ..."）。
"""

import re
import os


def parse_txt_file(filepath):
    """
    解析单个 TXT 文件，返回结构化数据。

    Args:
        filepath: TXT 文件的绝对路径

    Returns:
        dict: {
            "filename": str,           # 文件名（不含路径）
            "channels": [str, ...],    # 有序通道名列表，如 ["CH0", "CH1", ...]
            "rows": [[int|None, ...], ...],  # 数据行，每个元素对应 channels 中的一个通道
            "errors": [(line_num, preview, reason), ...],
            "line_count": int,
            "data_count": int,
        }
    """
    channels = []           # 有序通道名列表（从第一个有效数据行检测）
    channel_set = set()     # 用于快速查找和合并超集
    rows = []
    errors = []
    filename = os.path.basename(filepath)

    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except (IOError, OSError) as e:
        return {
            "filename": filename,
            "channels": [],
            "rows": [],
            "errors": [(0, "", f"无法读取文件: {e}")],
            "line_count": 0,
            "data_count": 0,
        }

    line_count = len(lines)

    for line_num, raw_line in enumerate(lines, 1):
        # 1. 去除 NUL 字节（替换为空格，避免拼接出虚假通道号）和首尾空白
        clean = raw_line.replace("\x00", " ").strip()
        if not clean:
            continue  # 跳过空行

        # 2. 去除可选的行号前缀（格式: "数字\t"）
        clean = re.sub(r"^\d+\t", "", clean)

        # 3. 提取所有通道-值对: CH<数字> = <整数>
        pairs = re.findall(r"CH(\d+)\s*=\s*(-?\d+)", clean)

        if not pairs:
            # 行中有内容但没有匹配到任何通道数据
            if len(clean) > 0:
                errors.append((line_num, clean[:80], "未找到有效的通道-值对"))
            continue

        # 3b. 自动纠正重复数字的笔误通道号（如 CH33→CH3, CH55→CH5）
        corrected_pairs = []
        for ch_num, val in pairs:
            if len(ch_num) == 2 and ch_num[0] == ch_num[1]:
                corrected_pairs.append((ch_num[0], val))
            else:
                corrected_pairs.append((ch_num, val))
        pairs = corrected_pairs

        # 4. 按通道号排序
        pairs.sort(key=lambda x: int(x[0]))

        # 5. 从第一个有效数据行自动检测通道
        if not channels:
            channels = [f"CH{p[0]}" for p in pairs]
            channel_set = set(channels)

        # 6. 检查是否有新出现的通道（当前行有但 channels 中没有的）
        row_ch_names = [f"CH{p[0]}" for p in pairs]
        new_channels = [ch for ch in row_ch_names if ch not in channel_set]
        if new_channels:
            # 记录旧的通道顺序（用于重排已有行）
            old_channels = list(channels)
            # 将新通道添加到末尾，然后按编号排序
            channels.extend(new_channels)
            channels.sort(key=lambda x: int(x[2:]))
            channel_set.update(new_channels)
            # 重排已有行：按新通道顺序重新对齐，缺失通道填 None
            old_index = {ch: i for i, ch in enumerate(old_channels)}
            for i in range(len(rows)):
                old_row = rows[i]
                rows[i] = [old_row[old_index[ch]] if ch in old_index else None for ch in channels]

        # 7. 构建数据行，按 channels 顺序对齐
        row_dict = {f"CH{p[0]}": int(p[1]) for p in pairs}
        row = [row_dict.get(ch, None) for ch in channels]
        rows.append(row)

    return {
        "filename": filename,
        "channels": channels,
        "rows": rows,
        "errors": errors,
        "line_count": line_count,
        "data_count": len(rows),
    }


def merge_channel_sets(parsed_files):
    """
    合并多个文件的通道集合为超集。

    当不同文件的通道数不一致时，将所有文件的数据对齐到统一的通道集合。
    缺失的通道值用 None 填充。

    Args:
        parsed_files: parse_txt_file() 返回结果组成的列表

    Returns:
        list[str]: 统一的、排好序的通道名列表
    """
    all_channels = set()
    for pf in parsed_files:
        all_channels.update(pf["channels"])
    # 按通道编号排序
    unified = sorted(all_channels, key=lambda x: int(x[2:]))
    return unified


def align_rows(rows, source_channels, target_channels):
    """
    将数据行从源通道集合对齐到目标通道集合。

    Args:
        rows: 原始数据行列表
        source_channels: 原始通道名列表
        target_channels: 目标通道名列表（超集）

    Returns:
        list[list[int|None]]: 对齐后的数据行
    """
    if source_channels == target_channels:
        return rows

    # 建立源通道到列索引的映射
    source_index = {ch: i for i, ch in enumerate(source_channels)}

    aligned = []
    for row in rows:
        new_row = []
        for ch in target_channels:
            idx = source_index.get(ch)
            if idx is not None and idx < len(row):
                new_row.append(row[idx])
            else:
                new_row.append(None)
        aligned.append(new_row)

    return aligned
