"""小题成绩分析命令行包装。

插件通过 stdio 与本脚本交互：输入原始小题分 Excel 与教学班映射表，
输出分析工作簿、可选的成绩单 PDF 压缩包与一份 JSON 结果摘要。

用法：
    python run_analysis.py --input in.xls --output out.xlsx \
        [--mapping map.xlsx] [--report-cards cards.zip] [--sketch-threshold 5]

成功时向 stdout 打印一行 JSON（ok=true），失败时打印一行 JSON（ok=false, error, traceback），
并以非零退出码结束。所有人类可读提示都使用中文。
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path


TOOL_DIR = Path(__file__).resolve().parent
VENDOR_XLRD = TOOL_DIR / "vendor_xlrd"

sys.path.insert(0, str(TOOL_DIR))
if VENDOR_XLRD.exists():
    sys.path.insert(0, str(VENDOR_XLRD))


def dataframe_to_json(df, index_name: str = "班级") -> dict:
    """把 DataFrame 转成前端易消费的 { columns, data } 结构。"""
    rows = []
    for idx, row in df.iterrows():
        row_data = {index_name: str(idx)}
        for col in df.columns:
            value = row[col]
            if _is_na(value):
                row_data[str(col)] = None
            elif isinstance(value, (int, float, str, bool)):
                row_data[str(col)] = value
            else:
                row_data[str(col)] = str(value)
        rows.append(row_data)
    return {"columns": [index_name] + [str(col) for col in df.columns], "data": rows}


def _is_na(value) -> bool:
    # 避免在模块顶层 import pandas，让缺少依赖时的报错更清晰。
    try:
        import pandas as pd

        return bool(pd.isna(value))
    except Exception:
        return value is None


def build_payload(result) -> dict:
    import analyze_exam_data as core

    return {
        "ok": True,
        "summary": result.summary,
        "warnings": result.schema.warnings,
        "class_averages": dataframe_to_json(result.class_averages),
        "info_analysis": dataframe_to_json(result.info_analysis),
        "general_analysis": dataframe_to_json(result.general_analysis),
        "info_teaching_analysis": dataframe_to_json(result.info_teaching_analysis, "教学班"),
        "general_teaching_analysis": dataframe_to_json(result.general_teaching_analysis, "教学班"),
        "question_choice_distributions": core.build_choice_distributions(result),
        "question_choice_distributions_by_group": core.build_choice_distributions_by_group(result),
        "report_cards_count": 0,
    }


def fail(message: str) -> int:
    print(
        json.dumps(
            {"ok": False, "error": message, "traceback": traceback.format_exc()},
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="运行小题成绩分析。")
    parser.add_argument("--input", required=True, help="原始小题分 Excel 路径。")
    parser.add_argument("--output", required=True, help="输出分析工作簿路径。")
    parser.add_argument("--mapping", help="教学班映射工作簿路径。")
    parser.add_argument("--report-cards", help="成绩单 PDF 压缩包输出路径。")
    parser.add_argument("--sketch-threshold", type=float, help="草图得分低于该值时标红。")
    args = parser.parse_args()

    try:
        import pandas as pd
    except ImportError:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "缺少 pandas，请为成绩分析 Python 环境安装 pandas、openpyxl。",
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
        return 1

    try:
        import analyze_exam_data as core
    except Exception:
        return fail("无法载入小题成绩分析模块。")

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    mapping_path = Path(args.mapping).resolve() if args.mapping else None
    report_cards_path = Path(args.report_cards).resolve() if args.report_cards else None

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if report_cards_path:
            report_cards_path.parent.mkdir(parents=True, exist_ok=True)

        result = core.process_exam_file(
            str(input_path),
            str(mapping_path) if mapping_path else core.CLASS_ASSIGNMENT_FILE,
        )
        core.save_analysis_to_excel(result, str(output_path))

        payload = build_payload(result)
        if report_cards_path:
            # 成绩单是可选产物：没有教学班映射、缺 reportlab 等情况下
            # 只记录原因，不让整次分析失败。
            try:
                payload["report_cards_count"] = core.save_report_cards_zip(
                    result,
                    str(report_cards_path),
                    sketch_threshold=args.sketch_threshold,
                )
            except Exception as exc:  # noqa: BLE001
                payload["report_cards_count"] = 0
                payload["reportCardsError"] = str(exc)
                report_cards_path.unlink(missing_ok=True)

        print(json.dumps(payload, ensure_ascii=False), flush=True)
        return 0
    except Exception as exc:  # noqa: BLE001 - 统一转成一行 JSON 交给 Host
        return fail(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
