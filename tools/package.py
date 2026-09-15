#!/usr/bin/env python3
"""Build a NapCat plugin ZIP from explicit code/document paths, using stdlib only."""
import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
FILES = ('package.json', 'index.mjs', 'README.md', 'LICENSE', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md')
DIRECTORIES = ('lib', 'webui', 'assets', 'docs')
ALLOWED = {'.mjs', '.cjs', '.js', '.css', '.html', '.md', '.json', '.txt', '.png', '.jpg', '.webp'}


def main():
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    version = package['version']
    if package['name'] != 'napcat-plugin-bili-recognizer' or not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', version):
        raise ValueError('Unexpected package name or version')
    selected = [ROOT / name for name in FILES]
    for name in DIRECTORIES:
        directory = ROOT / name
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError(f'Invalid source directory: {name}')
        for file in sorted(directory.rglob('*')):
            if file.is_symlink():
                raise ValueError(f'Symbolic links are not packaged: {file.relative_to(ROOT)}')
            if file.is_file() and file.suffix in ALLOWED:
                selected.append(file)
    for file in selected:
        if file.is_symlink() or not file.is_file():
            raise ValueError(f'Invalid source file: {file.relative_to(ROOT)}')
    output_dir = ROOT / 'dist'
    if output_dir.is_symlink():
        raise ValueError('dist must not be a symbolic link')
    output_dir.mkdir(exist_ok=True)
    output = output_dir / f"{package['name']}-{version}.zip"
    if output.is_symlink():
        raise ValueError('Output must not be a symbolic link')
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        for file in selected:
            archive.write(file, file.relative_to(ROOT).as_posix())
    print(f'Created {output.name}: {len(selected)} files, {output.stat().st_size} bytes')


if __name__ == '__main__':
    main()
