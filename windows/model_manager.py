"""Import and select compatible ONNX models without overwriting existing files."""
import hashlib
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile


def parse_drop(value, windows=False):
    value = value.strip()
    if not value:
        return None
    # Finder quotes and shell-escapes paths. Windows Terminal commonly adds
    # double quotes but preserves backslashes literally.
    if windows:
        if len(value) >= 2 and value[0] == value[-1] == '"':
            value = value[1:-1]
    elif not Path(value).is_file():
        try:
            parts = shlex.split(value)
            if len(parts) != 1:
                return None
            value = parts[0]
        except ValueError:
            return None
    return Path(value).expanduser()


def validate_model(path, binary, environment):
    path = Path(path)
    if path.suffix.lower() != '.onnx' or not path.is_file():
        return False, 'Choose an existing .onnx file.'
    try:
        result = subprocess.run(
            [str(binary), '--self-test', '--model', str(path)],
            env=environment, capture_output=True, text=True, timeout=90,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)
    if result.returncode:
        return False, result.stderr.strip() or 'Model test failed.'
    return True, ''


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def import_model(source, model_dir, binary, environment):
    source = Path(source)
    ok, error = validate_model(source, binary, environment)
    if not ok:
        raise ValueError(error)
    imported = model_dir / 'imported'
    imported.mkdir(parents=True, exist_ok=True)
    filename = source.stem + '.onnx'
    target = imported / filename
    source_hash = digest(source)
    number = 2
    while target.exists():
        if target.is_file() and digest(target) == source_hash:
            return target
        target = imported / (source.stem + ' (' + str(number) + ').onnx')
        number += 1
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(dir=imported, prefix='.model-', suffix='.onnx', delete=False) as output:
            temp_name = output.name
            with source.open('rb') as input_stream:
                shutil.copyfileobj(input_stream, output)
        if digest(Path(temp_name)) != source_hash:
            raise ValueError('The source file changed during import. Please try again.')
        ok, error = validate_model(temp_name, binary, environment)
        if not ok:
            raise ValueError('Copied model failed its test: ' + error)
        Path(temp_name).replace(target)
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)
    return target


def choose_model(model_dir, binary, environment, settings, save_settings, windows=False):
    model_dir = Path(model_dir)
    while True:
        builtin = model_dir / 'model.onnx'
        models = [builtin] if builtin.is_file() else []
        models.extend(sorted((model_dir / 'imported').glob('*.onnx'), key=lambda p: p.name.lower()))
        print('\n  Choose an AI model / 選擇 AI 模型')
        for number, item in enumerate(models, 1):
            previous = ' (last used / 上次使用)' if settings.get('last_model') == item.relative_to(model_dir).as_posix() else ''
            print(f'  {number}. {item.name}{previous}')
        print('  A. Import an ONNX model / 匯入模型')
        print('  Q. Back / 返回')
        selected = input('  Choice / 選擇 (Enter = last used / 上次使用): ').strip()
        if not selected and models:
            last = settings.get('last_model')
            selected = str(next((index for index, item in enumerate(models, 1)
                                 if item.relative_to(model_dir).as_posix() == last), 1))
        if selected.lower() == 'q':
            return None
        if selected.lower() == 'a':
            source = parse_drop(input('  Drag the .onnx file here and press Enter / 拖入模型後按 Enter: '), windows)
            if source is None:
                print('  Invalid path / 路徑無效')
                continue
            try:
                item = import_model(source, model_dir, binary, environment)
            except (ValueError, OSError) as error:
                print(f'  Import failed / 匯入失敗: {error}')
                continue
            print(f'  Saved / 已保存: {item.name}')
        elif selected.isdigit() and 1 <= int(selected) <= len(models):
            item = models[int(selected) - 1]
        else:
            print('  Please choose a listed number, A or Q.')
            continue
        ok, error = validate_model(item, binary, environment)
        if not ok:
            print(f'  Model cannot be used / 模型無法使用: {error}')
            continue
        settings['last_model'] = item.relative_to(model_dir).as_posix()
        save_settings(settings)
        return item
