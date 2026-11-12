"""Run the Excel analysis CLI with entirely synthetic students and scores.

Requires pandas and openpyxl in the selected Python environment. Does not generate PDFs.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from openpyxl import Workbook, load_workbook

root = Path(__file__).resolve().parent.parent
cli = root / 'plugins/dsh-score-analysis/python/run_analysis.py'
with tempfile.TemporaryDirectory(prefix='dsh-score-synthetic-') as temp:
    source = Path(temp) / 'synthetic-scores.xlsx'
    output = Path(temp) / 'synthetic-analysis.xlsx'
    book = Workbook()
    sheet = book.active
    sheet.append(['学号', '考号', '姓名', '班级', '学校', '全卷', '1卷', '2卷', '信13', '通28', '通29'])
    sheet.append(['', '', '', '', '', '', '', '', '得分', '得分', '得分'])
    for i, scores in enumerate([(5, 7, 3), (9, 4, 2), (6, 5, 4), (8, 8, 1)], 1):
        sheet.append([f'SYNTH-{i}', f'EXAMPLE-{i}', f'虚构学生{i}', f'示例{i % 2 + 1}班', '示例学校', sum(scores), 0, sum(scores), *scores])
    book.save(source)
    result = subprocess.run([sys.executable, str(cli), '--input', str(source), '--output', str(output)], capture_output=True, text=True, encoding='utf-8', env={**os.environ, 'PYTHONUTF8': '1', 'PYTHONDONTWRITEBYTECODE': '1'})
    if result.returncode:
        raise RuntimeError(result.stdout + '\n' + result.stderr)
    payload = json.loads(result.stdout.strip().splitlines()[-1])
    assert payload.get('ok') is True, payload
    assert output.is_file()
    generated = load_workbook(output, read_only=True, data_only=True)
    assert len(generated.sheetnames) >= 3, generated.sheetnames
    print('PASS: synthetic Excel -> Python CLI -> analysis workbook; sheets:', len(generated.sheetnames))
    generated.close()
