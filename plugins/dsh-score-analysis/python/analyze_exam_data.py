from __future__ import annotations

import io
from itertools import combinations
import os
import re
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable

import pandas as pd
from openpyxl import Workbook
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side


BASE_COLUMNS = ["学号", "考号", "姓名", "班级", "学校", "全卷", "1卷", "2卷"]
TOTAL_COLUMNS = ["全卷", "1卷", "2卷", "信息", "通用"]
DISPLAY_TOTAL_COLUMNS = ["全卷", "信息", "通用"]
CLASS_ASSIGNMENT_FILE = ""  # Public release: supply a mapping file explicitly.
SUBJECT_INFO = "信息"
SUBJECT_GENERAL = "通用"
SUBJECT_UNKNOWN = "未分类"


@dataclass
class QuestionColumn:
    name: str
    column_index: int
    subject: str
    has_answer: bool = False


@dataclass
class ExamSchema:
    base_columns: list[str]
    question_columns: list[QuestionColumn]
    answer_columns: list[str] = field(default_factory=list)
    excluded_subtotal_columns: list[str] = field(default_factory=list)
    unclassified_columns: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    class_group_columns: list[str] = field(default_factory=list)
    unmatched_students: dict[str, list[str]] = field(default_factory=dict)


@dataclass
class AnalysisResult:
    data: pd.DataFrame
    schema: ExamSchema
    class_averages: pd.DataFrame
    info_analysis: pd.DataFrame
    general_analysis: pd.DataFrame
    info_teaching_analysis: pd.DataFrame = field(default_factory=pd.DataFrame)
    general_teaching_analysis: pd.DataFrame = field(default_factory=pd.DataFrame)

    @property
    def summary(self) -> dict:
        info_count = sum(1 for q in self.schema.question_columns if q.subject == SUBJECT_INFO)
        general_count = sum(1 for q in self.schema.question_columns if q.subject == SUBJECT_GENERAL)
        unknown_count = sum(1 for q in self.schema.question_columns if q.subject == SUBJECT_UNKNOWN)
        return {
            "question_count": len(self.schema.question_columns),
            "info_question_count": info_count,
            "general_question_count": general_count,
            "unclassified_question_count": unknown_count,
            "excluded_subtotal_columns": self.schema.excluded_subtotal_columns,
            "unclassified_columns": self.schema.unclassified_columns,
            "warnings": self.schema.warnings,
        }


def _clean_header(value) -> str:
    if pd.isna(value):
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def _make_unique(names: Iterable[str]) -> list[str]:
    seen: dict[str, int] = {}
    result = []
    for raw_name in names:
        name = raw_name or "未命名列"
        count = seen.get(name, 0)
        seen[name] = count + 1
        result.append(name if count == 0 else f"{name}_{count + 1}")
    return result


def _normalize_question_name(name: str) -> str:
    text = str(name).strip()
    text = text.replace("_", "-").replace("－", "-").replace("—", "-")
    text = re.sub(r"\s+", "", text)
    return text


def natural_sort_key(name: str) -> tuple:
    text = _normalize_question_name(name)
    if "草图" in text:
        tail = 999
    else:
        tail = 0
    subject_rank = 0 if text.startswith("信") else 1 if text.startswith("通") or text.startswith("T") else 2
    numbers = [int(n) for n in re.findall(r"\d+", text)]
    return (subject_rank, numbers, tail, text)


def infer_subject(question_name: str) -> str:
    text = _normalize_question_name(question_name)
    if text.startswith("信"):
        return SUBJECT_INFO
    if text.startswith("通") or text.startswith("T"):
        return SUBJECT_GENERAL

    first_number = re.search(r"\d+", text)
    if first_number:
        number = int(first_number.group(0))
        if 13 <= number <= 15:
            return SUBJECT_INFO
        if 28 <= number <= 30:
            return SUBJECT_GENERAL
    return SUBJECT_UNKNOWN


def read_exam_file(file_obj) -> pd.DataFrame:
    """Read the new two-row-header score workbook as raw cell data."""
    try:
        raw = pd.read_excel(file_obj, header=None, dtype=object)
    except ImportError as exc:
        raise ValueError("缺少读取 Excel 所需依赖，请安装 pandas、openpyxl 和 xlrd 后重试。") from exc
    except Exception as exc:
        raise ValueError(f"无法读取 Excel 文件：{exc}") from exc

    if raw.shape[0] < 3:
        raise ValueError("成绩表至少需要包含两行表头和一行学生数据。")
    if raw.shape[1] < len(BASE_COLUMNS):
        raise ValueError("成绩表列数不足，未找到完整的学生基础字段。")
    return raw


def detect_exam_schema(raw: pd.DataFrame, mapping_file: str = CLASS_ASSIGNMENT_FILE) -> tuple[pd.DataFrame, ExamSchema]:
    """Detect base fields, score columns, answer columns and subject grouping."""
    header_top = [_clean_header(v) for v in raw.iloc[0].tolist()]
    header_sub = [_clean_header(v) for v in raw.iloc[1].tolist()]

    base_headers = header_top[: len(BASE_COLUMNS)]
    missing_base = [name for name in BASE_COLUMNS if name not in base_headers]
    if missing_base:
        raise ValueError(f"缺少关键字段：{', '.join(missing_base)}。请确认使用新格式成绩表。")

    output_names: list[str] = []
    score_names: list[str] = []
    answer_names: list[str] = []
    raw_questions: list[QuestionColumn] = []
    last_question_name = ""

    for index, top_name in enumerate(header_top):
        sub_name = header_sub[index] if index < len(header_sub) else ""
        if index < len(BASE_COLUMNS):
            output_names.append(top_name)
            continue

        if top_name:
            last_question_name = top_name

        if sub_name == "答案":
            question_name = last_question_name or top_name or f"第{index + 1}列"
            col_name = f"{question_name}_答案"
            answer_names.append(col_name)
            output_names.append(col_name)
            continue

        if sub_name == "得分" or top_name:
            question_name = top_name or last_question_name or f"第{index + 1}列"
            subject = infer_subject(question_name)
            score_names.append(question_name)
            raw_questions.append(QuestionColumn(question_name, index, subject, has_answer=(sub_name == "得分")))
            output_names.append(question_name)
            continue

        output_names.append(f"未命名列{index + 1}")

    output_names = _make_unique(output_names)
    data = raw.iloc[2:].copy()
    data.columns = output_names
    data = data.dropna(subset=["学号"]).reset_index(drop=True)

    for col in BASE_COLUMNS:
        if col in data.columns:
            data[col] = data[col].astype(str).str.strip()
    data["班级"] = data["班级"].map(normalize_source_class)

    for col in ["全卷", "1卷", "2卷"] + score_names:
        if col in data.columns:
            data[col] = pd.to_numeric(data[col], errors="coerce")

    questions = _sync_question_names(raw_questions, output_names)
    excluded_subtotals = _detect_subtotal_columns(data, questions)
    questions = [q for q in questions if q.name not in excluded_subtotals]
    questions = sorted(questions, key=lambda q: natural_sort_key(q.name))

    unclassified = [q.name for q in questions if q.subject == SUBJECT_UNKNOWN]
    warnings = []
    if excluded_subtotals:
        warnings.append(f"已自动排除疑似汇总列：{', '.join(excluded_subtotals)}")
    if unclassified:
        warnings.append(f"以下题目未能判断信息/通用归属：{', '.join(unclassified)}")
    if not questions:
        raise ValueError("未识别到有效小题得分列。")

    data, class_group_columns, class_warnings, unmatched_students = attach_teaching_classes(data, mapping_file)
    warnings.extend(class_warnings)

    schema = ExamSchema(
        base_columns=BASE_COLUMNS.copy(),
        question_columns=questions,
        answer_columns=answer_names,
        excluded_subtotal_columns=excluded_subtotals,
        unclassified_columns=unclassified,
        warnings=warnings,
        class_group_columns=class_group_columns,
        unmatched_students=unmatched_students,
    )
    return data, schema


def attach_teaching_classes(
    data: pd.DataFrame, mapping_file: str = CLASS_ASSIGNMENT_FILE
) -> tuple[pd.DataFrame, list[str], list[str], dict[str, list[str]]]:
    warnings = []
    unmatched_students: dict[str, list[str]] = {}
    if not pd.io.common.file_exists(mapping_file):
        warnings.append(f"未找到分班表：{mapping_file}，只生成原始班级明细。")
        return data, [], warnings, unmatched_students

    mapping = pd.read_excel(mapping_file, dtype=object)
    required_columns = {"班级", "姓名"}
    if not required_columns.issubset(mapping.columns):
        warnings.append("分班表缺少“班级”或“姓名”字段，无法生成教学班明细。")
        return data, [], warnings, unmatched_students

    teaching_columns = [col for col in mapping.columns if str(col).startswith("教学班")]
    if not teaching_columns:
        warnings.append("分班表未找到“教学班”字段，无法生成教学班明细。")
        return data, [], warnings, unmatched_students

    mapping = mapping.copy()
    mapping["班级"] = mapping["班级"].astype(str).str.strip()
    mapping["姓名"] = mapping["姓名"].astype(str).str.strip()
    mapping["_匹配班级"] = mapping["班级"].map(_normalize_class_for_join)

    rename_map = {}
    for index, col in enumerate(teaching_columns, start=1):
        rename_map[col] = "信息教学班" if index == 1 else "通用教学班" if index == 2 else f"教学班{index}"
    mapping = mapping.rename(columns=rename_map)
    class_group_columns = list(rename_map.values())

    name_lookup: dict[str, dict[str, object]] = {}
    ambiguous_names: set[str] = set()
    lookup_source = mapping[["姓名"] + class_group_columns].copy()
    lookup_source[class_group_columns] = lookup_source[class_group_columns].fillna("")
    for name, group in lookup_source.groupby("姓名", dropna=False):
        name = str(name).strip()
        if not name:
            continue
        combos = group[class_group_columns].drop_duplicates()
        combos = combos[
            combos.apply(
                lambda row: any(str(value).strip() for value in row.values),
                axis=1,
            )
        ]
        if len(combos) == 1:
            name_lookup[name] = combos.iloc[0].to_dict()
        elif len(combos) > 1:
            ambiguous_names.add(name)

    merged = data.copy()
    merged["班级"] = merged["班级"].astype(str).str.strip()
    merged["姓名"] = merged["姓名"].astype(str).str.strip()
    merged["_匹配班级"] = merged["班级"].map(_normalize_class_for_join)
    merged = merged.merge(
        mapping[["_匹配班级", "姓名"] + class_group_columns],
        on=["_匹配班级", "姓名"],
        how="left",
    )
    merged = merged.drop(columns=["_匹配班级"])

    fallback_count = 0
    for row_index, row in merged.iterrows():
        if row["班级"] == "台州分校":
            continue
        lookup = name_lookup.get(str(row["姓名"]).strip())
        if not lookup:
            continue
        filled = False
        for col in class_group_columns:
            value = lookup.get(col)
            if (pd.isna(merged.at[row_index, col]) or str(merged.at[row_index, col]).strip() == "") and str(value).strip():
                merged.at[row_index, col] = value
                filled = True
        if filled:
            fallback_count += 1

    if fallback_count:
        warnings.append(f"已按姓名从数据库教学班映射中补充分班信息：{fallback_count} 名学生。")

    ambiguous_mask = (
        merged[class_group_columns].isna().all(axis=1)
        & merged["姓名"].isin(ambiguous_names)
        & (merged["班级"] != "台州分校")
    )
    if ambiguous_mask.any():
        students = [
            f"{row['班级']} {row['姓名']}"
            for _, row in merged.loc[ambiguous_mask, ["班级", "姓名"]].iterrows()
        ]
        warnings.append(f"以下学生姓名在数据库中对应多个教学班，无法仅凭姓名确定：{', '.join(students)}")

    for col in class_group_columns:
        missing_mask = merged[col].isna() & (merged["班级"] != "台州分校")
        missing_count = int(missing_mask.sum())
        if missing_count:
            students = [
                f"{row['班级']} {row['姓名']}"
                for _, row in merged.loc[missing_mask, ["班级", "姓名"]].iterrows()
            ]
            unmatched_students[col] = students
            warnings.append(f"{col} 有 {missing_count} 名学生未在分班表中匹配到：{', '.join(students)}")

    return merged, class_group_columns, warnings, unmatched_students


def _normalize_class_for_join(class_name: str) -> str:
    text = str(class_name).strip()
    match = re.fullmatch(r"一(\d+)", text)
    if match:
        return match.group(1)
    return text


def normalize_source_class(class_name: str) -> str:
    text = str(class_name).strip()
    if re.fullmatch(r"一\d+", text):
        return "台州分校"
    return text


def _sync_question_names(questions: list[QuestionColumn], output_names: list[str]) -> list[QuestionColumn]:
    synced = []
    for question in questions:
        col_name = output_names[question.column_index]
        synced.append(
            QuestionColumn(
                name=col_name,
                column_index=question.column_index,
                subject=question.subject,
                has_answer=question.has_answer,
            )
        )
    return synced


def _detect_subtotal_columns(data: pd.DataFrame, questions: list[QuestionColumn]) -> list[str]:
    score_names = [q.name for q in questions if q.name in data.columns]
    normalized = {name: _normalize_question_name(name) for name in score_names}
    excluded = []

    for candidate in score_names:
        candidate_norm = normalized[candidate]
        parts = [
            name
            for name in score_names
            if name != candidate and re.match(rf"^{re.escape(candidate_norm)}[-_]\d+$", normalized[name])
        ]
        if len(parts) < 2:
            continue

        candidate_values = pd.to_numeric(data[candidate], errors="coerce").fillna(0)
        matching_parts = _find_matching_subtotal_parts(data, candidate_values, parts)
        if matching_parts:
            excluded.append(candidate)

    return sorted(excluded, key=natural_sort_key)


def _find_matching_subtotal_parts(data: pd.DataFrame, candidate_values: pd.Series, parts: list[str]) -> tuple[str, ...]:
    numeric_parts = data[parts].apply(pd.to_numeric, errors="coerce").fillna(0)
    max_size = min(len(parts), 6)
    for size in range(2, max_size + 1):
        for selected in combinations(parts, size):
            selected_sum = numeric_parts[list(selected)].sum(axis=1)
            if (candidate_values - selected_sum).abs().max() <= 0.001:
                return selected
    return ()


def _normalize_answer_value(value) -> str:
    if pd.isna(value):
        return ""

    text = str(value).strip().upper()
    if not text or text in {"NAN", "NONE", "NULL"}:
        return ""

    text = text.translate(str.maketrans("ＡＢＣＤＥＦＧＨ", "ABCDEFGH"))
    text = re.sub(r"\s+", "", text)
    if re.fullmatch(r"[A-H]+", text):
        return text

    letters = re.findall(r"[A-H]", text)
    if letters:
        return "".join(dict.fromkeys(letters))

    return text[:12]


def _find_answer_column(data: pd.DataFrame, schema: ExamSchema, question_name: str) -> str | None:
    expected = f"{question_name}_答案"
    if expected in data.columns:
        return expected

    normalized_question = _normalize_question_name(question_name)
    for column in schema.answer_columns:
        if column not in data.columns:
            continue
        answer_base = column[:-3] if column.endswith("_答案") else column
        if _normalize_question_name(answer_base) == normalized_question:
            return column
    return None


def _build_choice_distribution_for_data(
    data: pd.DataFrame,
    question: QuestionColumn,
    answer_column: str,
) -> dict | None:
    choice_order = ["A", "B", "C", "D"]
    answers = data[answer_column].map(_normalize_answer_value)
    total = int(len(answers))
    if total == 0:
        return None

    non_blank = answers[answers != ""]
    if non_blank.empty:
        return None

    raw_counts = non_blank.value_counts().to_dict()
    extra_options = sorted(
        [option for option in raw_counts if option not in choice_order],
        key=lambda option: (-int(raw_counts[option]), option),
    )
    ordered_options = choice_order + extra_options
    options = []
    for option in ordered_options:
        count = int(raw_counts.get(option, 0))
        options.append(
            {
                "option": option,
                "count": count,
                "percent": round(count / total * 100, 1) if total else 0,
            }
        )

    blank_count = total - int(non_blank.count())
    if blank_count:
        options.append(
            {
                "option": "空白",
                "count": int(blank_count),
                "percent": round(blank_count / total * 100, 1) if total else 0,
            }
        )

    score_values = (
        pd.to_numeric(data[question.name], errors="coerce")
        if question.name in data.columns
        else pd.Series(dtype="float64")
    )
    valid_scores = score_values.dropna()
    average_score = float(valid_scores.mean()) if not valid_scores.empty else None
    max_score = float(valid_scores.max()) if not valid_scores.empty else None
    error_rate = None
    if max_score is not None and max_score > 0 and average_score is not None:
        error_rate = max(0, min(1, 1 - average_score / max_score))

    return {
        "question": question.name,
        "subject": question.subject,
        "answerColumn": answer_column,
        "total": total,
        "answered": int(non_blank.count()),
        "averageScore": round(average_score, 2) if average_score is not None else None,
        "maxScore": round(max_score, 2) if max_score is not None else None,
        "errorRate": round(error_rate, 4) if error_rate is not None else None,
        "options": options,
    }


def build_choice_distributions(result: AnalysisResult) -> dict:
    distributions = {}
    for question in result.schema.question_columns:
        answer_column = _find_answer_column(result.data, result.schema, question.name)
        if not answer_column:
            continue

        distribution = _build_choice_distribution_for_data(result.data, question, answer_column)
        if distribution:
            distributions[question.name] = distribution

    return distributions


def build_choice_distributions_by_group(result: AnalysisResult) -> dict:
    distributions: dict[str, dict[str, dict[str, dict]]] = {
        "信息教学班": {},
        "通用教学班": {},
    }
    group_by_subject = {
        SUBJECT_INFO: "信息教学班",
        SUBJECT_GENERAL: "通用教学班",
    }

    for question in result.schema.question_columns:
        group_column = group_by_subject.get(question.subject)
        if not group_column or group_column not in result.data.columns:
            continue

        answer_column = _find_answer_column(result.data, result.schema, question.name)
        if not answer_column:
            continue

        grouped_data = result.data[result.data[group_column].notna()].copy()
        grouped_data[group_column] = grouped_data[group_column].astype(str).str.strip()
        grouped_data = grouped_data[grouped_data[group_column] != ""]
        if grouped_data.empty:
            continue

        for class_name, class_data in grouped_data.groupby(group_column, sort=True):
            distribution = _build_choice_distribution_for_data(class_data, question, answer_column)
            if not distribution:
                continue
            distributions.setdefault(group_column, {}).setdefault(str(class_name), {})[question.name] = distribution

    return distributions


def analyze_exam_scores(data: pd.DataFrame, schema: ExamSchema) -> AnalysisResult:
    score_columns = [q.name for q in schema.question_columns]
    info_cols = [q.name for q in schema.question_columns if q.subject == SUBJECT_INFO]
    general_cols = _sort_general_detail_columns(
        [q.name for q in schema.question_columns if q.subject == SUBJECT_GENERAL]
    )

    prepared = data.copy()
    prepared["信息"] = prepared[info_cols].sum(axis=1).round(2) if info_cols else 0
    prepared["通用"] = prepared[general_cols].sum(axis=1).round(2) if general_cols else 0

    class_averages = _build_group_average(prepared, DISPLAY_TOTAL_COLUMNS + score_columns)
    info_analysis = _build_group_average(prepared, ["信息"] + info_cols)
    general_analysis = _build_group_average(prepared, ["通用"] + general_cols)
    info_teaching_analysis = _build_group_average(prepared, ["信息"] + info_cols, group_column="信息教学班")
    general_teaching_analysis = _build_group_average(prepared, ["通用"] + general_cols, group_column="通用教学班")

    return AnalysisResult(
        data=prepared,
        schema=schema,
        class_averages=class_averages,
        info_analysis=info_analysis,
        general_analysis=general_analysis,
        info_teaching_analysis=info_teaching_analysis,
        general_teaching_analysis=general_teaching_analysis,
    )


def _build_group_average(data: pd.DataFrame, columns: list[str], group_column: str = "班级") -> pd.DataFrame:
    available = [col for col in columns if col in data.columns]
    if not available or group_column not in data.columns:
        return pd.DataFrame()

    grouped_data = data[data[group_column].notna()].copy()
    grouped_data[group_column] = grouped_data[group_column].astype(str).str.strip()
    grouped_data = grouped_data[grouped_data[group_column] != ""]
    if grouped_data.empty:
        return pd.DataFrame()

    class_avg = grouped_data.groupby(group_column)[available].mean(numeric_only=True).round(2)
    class_avg.index = class_avg.index.astype(str)
    class_avg = class_avg.sort_index()

    total_avg = grouped_data[available].mean(numeric_only=True).round(2)
    total_avg = pd.DataFrame([total_avg], index=["总平均值"])
    return pd.concat([total_avg, class_avg])


def process_exam_file(file_obj, mapping_file: str = CLASS_ASSIGNMENT_FILE) -> AnalysisResult:
    raw = read_exam_file(file_obj)
    data, schema = detect_exam_schema(raw, mapping_file)
    return analyze_exam_scores(data, schema)


def read_excel_file(file_obj):
    """Compatibility wrapper for existing callers."""
    raw = read_exam_file(file_obj)
    data, _schema = detect_exam_schema(raw)
    return data


def classify_by_subject(data):
    info_cols = [col for col in data.columns if infer_subject(col) == SUBJECT_INFO and col not in BASE_COLUMNS + TOTAL_COLUMNS]
    general_cols = [col for col in data.columns if infer_subject(col) == SUBJECT_GENERAL and col not in BASE_COLUMNS + TOTAL_COLUMNS]
    return sorted(info_cols, key=natural_sort_key), sorted(general_cols, key=natural_sort_key)


def calculate_class_averages(data):
    info_cols, general_cols = classify_by_subject(data)
    score_cols = sorted(set(info_cols + general_cols), key=natural_sort_key)
    prepared = data.copy()
    if "信息" not in prepared:
        prepared["信息"] = prepared[info_cols].sum(axis=1).round(2) if info_cols else 0
    if "通用" not in prepared:
        prepared["通用"] = prepared[general_cols].sum(axis=1).round(2) if general_cols else 0
    return _build_group_average(prepared, DISPLAY_TOTAL_COLUMNS + score_cols)


def generate_info_analysis(data, info_cols):
    prepared = data.copy()
    if "信息" not in prepared:
        prepared["信息"] = prepared[info_cols].sum(axis=1).round(2) if info_cols else 0
    return _build_group_average(prepared, ["信息"] + list(info_cols))


def generate_general_analysis(data, general_cols):
    prepared = data.copy()
    if "通用" not in prepared:
        prepared["通用"] = prepared[general_cols].sum(axis=1).round(2) if general_cols else 0
    return _build_group_average(prepared, ["通用"] + list(general_cols))


def add_color_scale(ws, start_col, end_col, start_row, end_row):
    if end_row < start_row:
        return
    rule = ColorScaleRule(
        start_type="min",
        start_color="FFF16B61",
        mid_type="percentile",
        mid_value=50,
        mid_color="FFF7E98F",
        end_type="max",
        end_color="FF64BC7B",
    )
    ws.conditional_formatting.add(f"{start_col}{start_row}:{end_col}{end_row}", rule)


def save_results_to_excel(all_avg, info_analysis, general_analysis, output_file, data, schema=None):
    wb = build_excel_report(
        AnalysisResult(
            data=data,
            schema=schema or _schema_from_data(data),
            class_averages=all_avg,
            info_analysis=info_analysis,
            general_analysis=general_analysis,
        )
    )
    wb.save(output_file)


def save_results_to_excel_bytes(all_avg, info_analysis, general_analysis, data, schema=None):
    wb = build_excel_report(
        AnalysisResult(
            data=data,
            schema=schema or _schema_from_data(data),
            class_averages=all_avg,
            info_analysis=info_analysis,
            general_analysis=general_analysis,
        )
    )
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output


def save_analysis_to_excel(result: AnalysisResult, output_file):
    wb = build_excel_report(result)
    wb.save(output_file)


def save_analysis_to_excel_bytes(result: AnalysisResult):
    output = io.BytesIO()
    build_excel_report(result).save(output)
    output.seek(0)
    return output


def save_report_cards_zip(result: AnalysisResult, output_file: str, sketch_threshold: float | None = None):
    specs = _build_report_card_specs(result, sketch_threshold=sketch_threshold)
    if not specs:
        raise ValueError("未找到可导出的教学班成绩单，请先确认数据库教学班匹配已成功。")

    os.makedirs(os.path.dirname(os.path.abspath(output_file)), exist_ok=True)
    used_names: set[str] = set()
    with zipfile.ZipFile(output_file, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for spec in specs:
            pdf_bytes = _render_report_card_pdf_bytes(spec["columns"], spec["rows"], spec["highlight_cells"])
            filename = _unique_report_card_filename(spec["title"], used_names)
            archive.writestr(filename, pdf_bytes.getvalue())
    return len(specs)


def _build_report_card_specs(result: AnalysisResult, sketch_threshold: float | None = None) -> list[dict]:
    specs: list[dict] = []
    data = result.data.copy()

    group_specs = [
        ("信息教学班", "", SUBJECT_INFO, ["信息", "全卷"]),
        ("通用教学班", "", SUBJECT_GENERAL, ["通用", "全卷"]),
    ]

    for group_column, prefix, subject, sort_columns in group_specs:
        if group_column not in data.columns:
            continue

        question_columns = _report_question_columns(result, subject)
        score_columns = [col for col in ["全卷", "信息", "通用"] if col in data.columns]
        source_columns = [*score_columns, *question_columns]

        grouped_data = data[data[group_column].notna()].copy()
        grouped_data[group_column] = grouped_data[group_column].astype(str).str.strip()
        grouped_data = grouped_data[grouped_data[group_column] != ""]
        if grouped_data.empty:
            continue

        for class_name in _iter_group_names(grouped_data, group_column):
            class_data = grouped_data[grouped_data[group_column] == class_name]
            title = _teaching_sheet_title(prefix, class_name)
            display_columns, rows, highlight_cells = _build_report_card_table(
                _sort_detail_data(class_data, sort_columns),
                group_column,
                title,
                source_columns,
                sketch_threshold=sketch_threshold,
            )
            specs.append({
                "title": title,
                "columns": display_columns,
                "rows": rows,
                "highlight_cells": highlight_cells,
            })

    return specs


def _report_question_columns(result: AnalysisResult, subject: str) -> list[str]:
    columns = [q.name for q in result.schema.question_columns if q.subject == subject]
    if subject == SUBJECT_GENERAL:
        return _sort_general_detail_columns(columns)
    return sorted(columns, key=natural_sort_key)


def _build_report_card_table(
    class_data: pd.DataFrame,
    group_column: str,
    teaching_label: str,
    source_columns: list[str],
    sketch_threshold: float | None = None,
) -> tuple[list[str], list[list[str]], list[tuple[int, int]]]:
    display_columns = ["教学班", "行政班", "学号", *source_columns]
    rows: list[list[str]] = []
    highlight_cells: list[tuple[int, int]] = []

    for row_index, (_, row) in enumerate(class_data.iterrows(), start=1):
        cells: list[str] = []
        for col_index, column_name in enumerate(display_columns):
            if column_name == "教学班":
                value = teaching_label
            elif column_name == "行政班":
                value = row.get("班级", "")
            elif column_name in ("考号", "学号"):
                value = _student_exam_number(row)
            elif column_name == group_column:
                value = row.get(group_column, "")
            else:
                value = row.get(column_name, "")

            if col_index >= 6 and _should_highlight_report_score(column_name, value, sketch_threshold):
                highlight_cells.append((col_index, row_index))
            cells.append(_format_report_card_value(value))
        rows.append(cells)

    return display_columns, rows, highlight_cells


def _student_exam_number(row) -> object:
    for column_name in ["考号", "学号"]:
        value = row.get(column_name, "")
        if pd.isna(value):
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _format_report_card_value(value) -> str:
    if pd.isna(value):
        return ""
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return f"{value:.2f}".rstrip("0").rstrip(".")
    return str(value).strip()


def _is_zero_score(value) -> bool:
    if value is None or pd.isna(value):
        return False
    try:
        return float(value) == 0
    except (TypeError, ValueError):
        return False


def _is_sketch_column(column_name: str) -> bool:
    return "草图" in str(column_name)


def _should_highlight_report_score(column_name: str, value, sketch_threshold: float | None = None) -> bool:
    if value is None or pd.isna(value):
        return False
    if _is_zero_score(value):
        return True
    if sketch_threshold is None or not _is_sketch_column(column_name):
        return False
    try:
        return float(value) < sketch_threshold
    except (TypeError, ValueError):
        return False


def _unique_report_card_filename(title: str, used_names: set[str]) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1F]+', "_", str(title)).strip() or "成绩单"
    base = cleaned[:80].rstrip(" .") or "成绩单"
    candidate = f"{base}.pdf"
    counter = 2
    while candidate in used_names:
        suffix = f"_{counter}"
        candidate = f"{base[:80 - len(suffix)]}{suffix}.pdf"
        counter += 1
    used_names.add(candidate)
    return candidate


def _reportlab_font_name() -> str:
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
    except ImportError as exc:
        raise ValueError("服务器缺少成绩单 PDF 生成依赖 reportlab，请为成绩分析 Python 环境安装 reportlab。") from exc

    registered = set(pdfmetrics.getRegisteredFontNames())
    preferred_name = "CrCheckInCJK"
    if preferred_name in registered:
        return preferred_name

    font_candidates = [
        "C:/Windows/Fonts/simsun.ttc",
        "C:/Windows/Fonts/simsun.ttf",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyh.ttf",
        "C:/Windows/Fonts/simhei.ttf",
        "/System/Library/Fonts/PingFang.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    ]
    for font_path in font_candidates:
        if not os.path.exists(font_path):
            continue
        try:
            pdfmetrics.registerFont(TTFont(preferred_name, font_path))
            return preferred_name
        except Exception:
            continue

    try:
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont

        if "STSong-Light" not in registered:
            pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        return "STSong-Light"
    except Exception as exc:
        raise ValueError("未找到可用于成绩单 PDF 的中文字体，请在服务器安装微软雅黑、黑体或 Noto Sans CJK。") from exc


def _report_card_header_font_name(fallback_font: str) -> str:
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
    except ImportError:
        return fallback_font

    preferred_name = "CrCheckInHeaderCJK"
    if preferred_name in set(pdfmetrics.getRegisteredFontNames()):
        return preferred_name

    for font_path in ["C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/msyhbd.ttc"]:
        if not os.path.exists(font_path):
            continue
        try:
            pdfmetrics.registerFont(TTFont(preferred_name, font_path))
            return preferred_name
        except Exception:
            continue
    return fallback_font


def _text_units(value) -> float:
    text = str(value or "")
    total = 0.0
    for char in text:
        total += 1.8 if ord(char) > 127 else 1.0
    return total


def _report_card_col_widths(columns: list[str], rows: list[list[str]]) -> list[float]:
    widths: list[float] = []
    for col_index, column_name in enumerate(columns):
        if column_name == "教学班":
            max_units = max([_text_units(column_name), *[_text_units(row[col_index]) for row in rows]], default=4)
            widths.append(max(42, min(52, max_units * 3.8 + 6)))
        elif column_name == "行政班":
            max_units = max([_text_units(column_name), *[_text_units(row[col_index]) for row in rows]], default=4)
            widths.append(max(32, min(40, max_units * 3.5 + 5)))
        elif column_name in ("考号", "学号"):
            max_units = max([_text_units(column_name), *[_text_units(row[col_index]) for row in rows]], default=8)
            widths.append(max(54, min(62, max_units * 3.4 + 6)))
        elif column_name in {"全卷", "信息", "通用"}:
            widths.append(34)
        else:
            widths.append(max(32, min(52, _text_units(column_name) * 3.9 + 6)))
    return widths


def _report_card_font_size(column_count: int) -> float:
    if column_count > 34:
        return 7.2
    elif column_count > 28:
        return 7.6
    return 8.0


def _render_report_card_pdf_bytes(columns: list[str], rows: list[list[str]], highlight_cells: list[tuple[int, int]]) -> io.BytesIO:
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.pdfgen import canvas
        from reportlab.platypus import Table, TableStyle
    except ImportError as exc:
        raise ValueError("服务器缺少成绩单 PDF 生成依赖 reportlab，请为成绩分析 Python 环境安装 reportlab。") from exc

    output = io.BytesIO()
    page_size = landscape(A4)
    left_margin = 28
    right_margin = 28
    top_margin = 40
    bottom_margin = 28
    available_width = page_size[0] - left_margin - right_margin
    available_height = page_size[1] - top_margin - bottom_margin
    font_name = _reportlab_font_name()
    header_font_name = _report_card_header_font_name(font_name)
    table_data = [columns, *rows]
    row_count = len(table_data)
    font_size = _report_card_font_size(len(columns))
    row_height = 14.6

    header_fill = colors.HexColor("#d8d8d8")
    highlight_fill = colors.HexColor("#f7c5cd")
    grid_color = colors.black
    text_color = colors.black
    highlight_text_color = colors.HexColor("#9b1c31")
    col_widths = _report_card_col_widths(columns, rows)
    row_heights = [row_height] * row_count
    style_commands = [
        ("FONTNAME", (0, 0), (-1, -1), font_name),
        ("FONTNAME", (0, 0), (-1, 0), header_font_name),
        ("FONTSIZE", (0, 0), (-1, -1), font_size),
        ("LEADING", (0, 0), (-1, -1), font_size + 1),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.75, grid_color),
        ("BOX", (0, 0), (-1, -1), 1.0, grid_color),
        ("BACKGROUND", (0, 0), (-1, 0), header_fill),
        ("TEXTCOLOR", (0, 0), (-1, -1), text_color),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0.6),
        ("TOPPADDING", (0, 0), (-1, -1), 0.6),
        ("LEFTPADDING", (0, 0), (-1, -1), 0.8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0.8),
    ]
    for col_index, row_index in highlight_cells:
        style_commands.append(("BACKGROUND", (col_index, row_index), (col_index, row_index), highlight_fill))
        style_commands.append(("TEXTCOLOR", (col_index, row_index), (col_index, row_index), highlight_text_color))

    table = Table(table_data, colWidths=col_widths, rowHeights=row_heights, repeatRows=1)
    table.setStyle(TableStyle(style_commands))
    natural_width, natural_height = table.wrapOn(None, 0, 0)
    scale = min(available_width / natural_width, available_height / natural_height)
    scale = min(scale, 1.1)
    drawn_width = natural_width * scale
    drawn_height = natural_height * scale
    x = left_margin
    y = page_size[1] - top_margin - drawn_height

    pdf = canvas.Canvas(output, pagesize=page_size)
    pdf.saveState()
    pdf.translate(x, y)
    pdf.scale(scale, scale)
    table.drawOn(pdf, 0, 0)
    pdf.restoreState()
    pdf.showPage()
    pdf.save()
    output.seek(0)
    return output


def _schema_from_data(data: pd.DataFrame) -> ExamSchema:
    question_columns = []
    for col in data.columns:
        if col in BASE_COLUMNS + TOTAL_COLUMNS or col.endswith("_答案"):
            continue
        subject = infer_subject(col)
        if subject != SUBJECT_UNKNOWN:
            question_columns.append(QuestionColumn(col, -1, subject))
    return ExamSchema(BASE_COLUMNS.copy(), sorted(question_columns, key=lambda q: natural_sort_key(q.name)))


def build_excel_report(result: AnalysisResult) -> Workbook:
    wb = Workbook()
    border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )

    ws = wb.active
    ws.title = "班级平均分"
    next_class_row = _write_dataframe_sheet(ws, result.class_averages, "班级", border, with_color_scale=True)
    _write_class_average_teaching_sections(ws, result, border, next_class_row + 2)

    info_ws = wb.create_sheet("信息学科分析")
    next_info_row = _write_dataframe_sheet(info_ws, result.info_analysis, "班级", border, with_color_scale=True)
    if not result.info_teaching_analysis.empty:
        _write_dataframe_sheet(
            info_ws,
            result.info_teaching_analysis,
            "教学班",
            border,
            with_color_scale=True,
            start_row=next_info_row + 2,
            title="按教学班分类平均分分析",
        )

    general_ws = wb.create_sheet("通用学科分析")
    next_general_row = _write_dataframe_sheet(general_ws, result.general_analysis, "班级", border, with_color_scale=True)
    if not result.general_teaching_analysis.empty:
        _write_dataframe_sheet(
            general_ws,
            result.general_teaching_analysis,
            "教学班",
            border,
            with_color_scale=True,
            start_row=next_general_row + 2,
            title="按教学班分类平均分分析",
        )

    _write_warning_sheet(wb, result, border)
    _write_total_scores_sheet(wb, result, border)
    for group_column in result.schema.class_group_columns:
        subject = SUBJECT_INFO if group_column == "信息教学班" else SUBJECT_GENERAL if group_column == "通用教学班" else None
        prefix = ""
        _write_class_detail_sheets(wb, result, border, group_column, prefix, subject=subject)
    _write_class_detail_sheets(wb, result, border, "班级", "")
    return wb


def _write_class_average_teaching_sections(
    ws,
    result: AnalysisResult,
    border: Border,
    start_row: int,
) -> int:
    info_cols = [q.name for q in result.schema.question_columns if q.subject == SUBJECT_INFO]
    general_cols = _sort_general_detail_columns(
        [q.name for q in result.schema.question_columns if q.subject == SUBJECT_GENERAL]
    )
    all_score_columns = DISPLAY_TOTAL_COLUMNS + info_cols + general_cols
    sections = [
        ("按信息教学班分类平均分分析", "信息教学班", all_score_columns),
        ("按通用教学班分类平均分分析", "通用教学班", all_score_columns),
    ]
    next_row = start_row
    for title, group_column, columns in sections:
        if group_column not in result.data.columns:
            continue
        df = _build_group_average(result.data, columns, group_column=group_column)
        if df.empty:
            continue
        next_row = _write_dataframe_sheet(
            ws,
            df,
            "教学班",
            border,
            with_color_scale=True,
            start_row=next_row,
            title=title,
        ) + 2
    return next_row


def _write_dataframe_sheet(
    ws,
    df: pd.DataFrame,
    index_name: str,
    border: Border,
    with_color_scale=False,
    start_row: int = 1,
    title: str | None = None,
) -> int:
    column_count = max(1, len(df.columns) + 1)
    row_cursor = start_row
    header_rows = set()

    if title:
        title_row = row_cursor
        header_rows.add(title_row)
        for col_idx in range(1, column_count + 1):
            ws.cell(row=title_row, column=col_idx, value=title if col_idx == 1 else None)
        row_cursor += 1

    header_row = row_cursor
    header_rows.add(header_row)
    for col_idx, value in enumerate([index_name] + list(df.columns), start=1):
        ws.cell(row=header_row, column=col_idx, value=value)

    for row_offset, (idx, row) in enumerate(df.iterrows(), start=1):
        excel_row = header_row + row_offset
        ws.cell(row=excel_row, column=1, value=idx)
        for col_idx, value in enumerate(row.values, start=2):
            ws.cell(row=excel_row, column=col_idx, value=_excel_value(value))

    end_row = header_row + len(df)
    _style_table_range(ws, border, start_row, end_row, column_count, header_rows)

    if with_color_scale and df.shape[0] > 0 and df.shape[1] > 0:
        for col_idx in range(2, df.shape[1] + 2):
            col_letter = ws.cell(row=header_row, column=col_idx).column_letter
            add_color_scale(ws, col_letter, col_letter, header_row + 1, end_row)

    _fit_sheet(ws)
    return end_row + 1


def _write_warning_sheet(wb: Workbook, result: AnalysisResult, border: Border):
    ws = wb.create_sheet("识别摘要")
    summary_rows = [
        ["识别项目", "结果"],
        ["有效小题数", result.summary["question_count"]],
        ["信息题数", result.summary["info_question_count"]],
        ["通用题数", result.summary["general_question_count"]],
        ["未分类题数", result.summary["unclassified_question_count"]],
        ["排除汇总列", "、".join(result.schema.excluded_subtotal_columns) or "无"],
        ["未分类题目", "、".join(result.schema.unclassified_columns) or "无"],
    ]
    for row in summary_rows:
        ws.append(row)

    ws.append([])
    ws.append(["提示"])
    for warning in result.schema.warnings or ["无"]:
        ws.append([warning])

    ws.append([])
    ws.append(["自动排除的汇总列"])
    ws.append(["列名"])
    for column_name in result.schema.excluded_subtotal_columns or ["无"]:
        ws.append([column_name])

    ws.append([])
    ws.append(["未匹配分班表学生"])
    ws.append(["教学班类型", "学生"])
    if result.schema.unmatched_students:
        for group_column, students in result.schema.unmatched_students.items():
            for student in students:
                ws.append([group_column, student])
    else:
        ws.append(["无", "无"])
    _style_used_range(ws, border)
    ws.column_dimensions["A"].width = 18
    ws.column_dimensions["B"].width = 80


def _write_total_scores_sheet(wb: Workbook, result: AnalysisResult, border: Border):
    ws = wb.create_sheet("总成绩")
    data = result.data.copy()

    info_cols = [q.name for q in result.schema.question_columns if q.subject == SUBJECT_INFO]
    general_cols = _sort_general_detail_columns(
        [q.name for q in result.schema.question_columns if q.subject == SUBJECT_GENERAL]
    )
    unknown_cols = [q.name for q in result.schema.question_columns if q.subject == SUBJECT_UNKNOWN]
    teaching_columns = [col for col in ["信息教学班", "通用教学班"] if col in data.columns]
    extra_teaching_columns = [
        col
        for col in result.schema.class_group_columns
        if col in data.columns and col not in teaching_columns
    ]
    columns = [
        "姓名",
        "班级",
        *teaching_columns,
        *extra_teaching_columns,
        "全卷",
        "信息",
        "通用",
        *info_cols,
        *general_cols,
        *unknown_cols,
    ]
    columns = [col for col in columns if col in data.columns]

    sort_columns = [
        col
        for col in ["信息教学班", "通用教学班", *extra_teaching_columns, "班级", "姓名"]
        if col in data.columns
    ]
    if sort_columns:
        helper_columns = []
        for index, col in enumerate(sort_columns):
            blank_col = f"__sort_blank_{index}"
            text_col = f"__sort_text_{index}"
            data[blank_col] = data[col].map(lambda value: 1 if pd.isna(value) or str(value).strip() == "" else 0)
            data[text_col] = data[col].map(lambda value: "" if pd.isna(value) else str(value).strip())
            helper_columns.extend([blank_col, text_col])
        data = data.sort_values(helper_columns, ascending=True, na_position="last", kind="stable")
        data = data.drop(columns=helper_columns)

    _write_detail_table(ws, data, columns, start_row=1, border=border)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    _fit_sheet(ws)


def _write_class_detail_sheets(
    wb: Workbook,
    result: AnalysisResult,
    border: Border,
    group_column: str,
    sheet_prefix: str,
    subject: str | None = None,
):
    data = result.data.copy()
    if group_column not in data.columns:
        return

    info_cols = [q.name for q in result.schema.question_columns if q.subject == SUBJECT_INFO]
    general_cols = _sort_general_detail_columns(
        [q.name for q in result.schema.question_columns if q.subject == SUBJECT_GENERAL]
    )
    unknown_cols = [q.name for q in result.schema.question_columns if q.subject == SUBJECT_UNKNOWN]
    if subject == SUBJECT_INFO:
        general_cols = []
        unknown_cols = []
        base_columns = ["姓名", "班级", group_column, "全卷", "信息", "通用"]
    elif subject == SUBJECT_GENERAL:
        info_cols = []
        unknown_cols = []
        base_columns = ["姓名", "班级", group_column, "全卷", "信息", "通用"]
    else:
        base_columns = ["姓名", "班级", "全卷", "信息", "通用"]
    if group_column != "班级":
        if group_column not in base_columns:
            base_columns.insert(2, group_column)

    for class_name in _iter_group_names(data, group_column):
        class_data = data[data[group_column].astype(str).str.strip() == class_name]
        title = _teaching_sheet_title(sheet_prefix, class_name) if sheet_prefix else class_name
        ws = wb.create_sheet(_safe_sheet_title(title, wb.sheetnames))
        info_columns = base_columns + info_cols + unknown_cols
        general_columns = base_columns + general_cols

        if subject == SUBJECT_INFO:
            _write_detail_table(
                ws,
                _sort_detail_data(class_data, ["信息", "全卷"]),
                info_columns,
                start_row=1,
                border=border,
            )
        elif subject == SUBJECT_GENERAL:
            _write_detail_table(
                ws,
                _sort_detail_data(class_data, ["通用", "全卷"]),
                general_columns,
                start_row=1,
                border=border,
            )
        else:
            next_row = _write_detail_table(
                ws,
                _sort_detail_data(class_data, ["信息"]),
                info_columns,
                start_row=1,
                border=border,
            )
            _write_detail_table(
                ws,
                _sort_detail_data(class_data, ["通用"]),
                general_columns,
                start_row=next_row + 2,
                border=border,
            )
        _fit_sheet(ws)


def _sort_detail_data(data: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    sort_columns = [col for col in columns if col in data.columns]
    if not sort_columns:
        return data
    return data.sort_values(sort_columns, ascending=[False] * len(sort_columns), na_position="last")


def _sort_general_detail_columns(columns: list[str]) -> list[str]:
    normal = [col for col in columns if "补线" not in col and "草图" not in col]
    repair = [col for col in columns if "补线" in col]
    sketch = [col for col in columns if "草图" in col]
    return (
        sorted(normal, key=natural_sort_key)
        + sorted(repair, key=natural_sort_key)
        + sorted(sketch, key=natural_sort_key)
    )


def _write_detail_table(ws, class_data: pd.DataFrame, columns: list[str], start_row: int, border: Border) -> int:
    header_fill = PatternFill(start_color="FFCCCCCC", end_color="FFCCCCCC", fill_type="solid")
    zero_fill = PatternFill(start_color="FFFFC7CE", end_color="FFFFC7CE", fill_type="solid")

    for col_index, column_name in enumerate(columns, start=1):
        cell = ws.cell(row=start_row, column=col_index, value=column_name)
        cell.fill = header_fill
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border

    for row_offset, (_, row) in enumerate(class_data.iterrows(), start=1):
        excel_row = start_row + row_offset
        for col_index, column_name in enumerate(columns, start=1):
            value = _excel_value(row.get(column_name, ""))
            cell = ws.cell(row=excel_row, column=col_index, value=value)
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = border
            if col_index > 5 and value == 0:
                cell.fill = zero_fill

    return start_row + len(class_data) + 1


def _style_table_range(ws, border: Border, start_row: int, end_row: int, end_col: int, header_rows: set[int]):
    header_fill = PatternFill(start_color="FFCCCCCC", end_color="FFCCCCCC", fill_type="solid")
    for row in ws.iter_rows(min_row=start_row, max_row=end_row, min_col=1, max_col=end_col):
        for cell in row:
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = border
            if cell.row in header_rows:
                cell.fill = header_fill
                cell.font = Font(bold=True)
        ws.row_dimensions[row[0].row].height = 16


def _style_used_range(ws, border: Border):
    _style_table_range(ws, border, 1, ws.max_row, ws.max_column, {1})

    for column in ws.columns:
        column_letter = column[0].column_letter
        max_len = max(len(str(cell.value)) if cell.value is not None else 0 for cell in column)
        ws.column_dimensions[column_letter].width = max(8, min(max_len + 2, 24))

def _fit_sheet(ws):
    for row in ws.iter_rows():
        ws.row_dimensions[row[0].row].height = 16

    for column in ws.columns:
        column_letter = column[0].column_letter
        max_len = max(len(str(cell.value)) if cell.value is not None else 0 for cell in column)
        ws.column_dimensions[column_letter].width = max(8, min(max_len + 2, 24))


def _safe_sheet_title(title: str, existing: list[str]) -> str:
    cleaned = re.sub(r"[\[\]\*:/\\?]", "_", str(title)).strip() or "班级"
    cleaned = cleaned[:31]
    candidate = cleaned
    counter = 2
    while candidate in existing:
        suffix = f"_{counter}"
        candidate = f"{cleaned[:31 - len(suffix)]}{suffix}"
        counter += 1
    return candidate


def _iter_group_names(data: pd.DataFrame, group_column: str) -> list[str]:
    if group_column not in data.columns:
        return []
    values = data[group_column].dropna().astype(str).map(str.strip)
    values = values[values != ""].unique()
    return sorted(values, key=natural_sort_key)


def _teaching_sheet_title(prefix: str, class_name: str) -> str:
    text = str(class_name).strip()
    if prefix and re.fullmatch(r"[AB]\d+", text):
        return f"{prefix}{text}"
    return f"{prefix}{text}"


def _excel_value(value):
    if pd.isna(value):
        return None
    return value


def main():
    result = process_exam_file("data/小题分(技术选).xls")
    output_file = f"分析结果_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    save_analysis_to_excel(result, output_file)
    print(f"分析结果已保存到 {output_file}")


if __name__ == "__main__":
    main()
