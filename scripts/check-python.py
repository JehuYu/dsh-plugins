"""Parse bundled Python sources without executing them or writing bytecode."""
import ast
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sources = sorted((root / 'plugins' / 'dsh-score-analysis' / 'python').rglob('*.py'))
for source in sources:
    ast.parse(source.read_text(encoding='utf-8-sig'), filename=str(source))
print(f'Python sources parsed: {len(sources)}')
