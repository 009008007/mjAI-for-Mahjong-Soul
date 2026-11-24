#!/usr/bin/env python3
"""Interactive launcher for the self-contained macOS Mahjong Soul HUD."""
from __future__ import annotations

import argparse
import glob
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent
EXTENSION = ROOT / 'extension'
BRIDGE = ROOT / 'bridge'
MODEL = ROOT / 'model' / 'model.onnx'
RUNTIME = ROOT / 'runtime' / 'onnxruntime-osx-arm64' / 'lib' / 'libonnxruntime.dylib'
PYTHON_HOME = ROOT / 'runtime' / 'python'
BIN = ROOT / 'bin' / 'majsoul-bridge-server'
SETTINGS = ROOT / '.mjai-settings.json'
EXTENSION_ID = re.compile(r'^[a-p]{32}$')


def say_status(ok, title, detail=''):
    print(('  [OK] ' if ok else '  [!]  ') + title + (f' — {detail}' if detail else ''))


def ask_yes(prompt, default=False):
    suffix = ' [Y/n] ' if default else ' [y/N] '
    answer = input(prompt + suffix).strip().lower()
    return (answer in ('y', 'yes')) if answer else default


def load_settings():
    try:
        obj = json.loads(SETTINGS.read_text(encoding='utf-8'))
        return obj if isinstance(obj, dict) else {}
    except (OSError, ValueError):
        return {}


def save_settings(settings):
    # Write atomically so an interrupted save cannot leave invalid JSON.
    tmp = None
    try:
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=ROOT, prefix='.mjai-', delete=False) as f:
            tmp = Path(f.name)
            json.dump(settings, f, indent=2)
            f.write('\n')
        tmp.replace(SETTINGS)
        return True
    except OSError as e:
        print(f'Could not save settings: {e}')
        if tmp:
            try: tmp.unlink()
            except OSError: pass
        return False


def command_path(name):
    found = shutil.which(name)
    if found: return found
    candidate = Path.home() / '.cargo' / 'bin' / name
    return str(candidate) if candidate.is_file() and os.access(candidate, os.X_OK) else None


def runtime_env(prebuilt=True):
    env = os.environ.copy()
    env['ORT_DYLIB_PATH'] = str(RUNTIME)
    env.pop('PYTHONPATH', None)
    env.pop('PYTHONUSERBASE', None)
    if prebuilt and PYTHON_HOME.is_dir():
        env['PYTHONHOME'] = str(PYTHON_HOME)
        env['PYTHONNOUSERSITE'] = '1'
    else:
        # A locally-built executable links the developer's own Python.
        env.pop('PYTHONHOME', None)
    return env


def platform_problem():
    if sys.platform != 'darwin':
        return 'This bundle supports macOS on Apple silicon only.'
    if platform.machine() not in ('arm64', 'aarch64'):
        return 'This bundle supports Apple silicon Macs only; Intel and Windows versions need different binaries.'
    version = platform.mac_ver()[0]
    try:
        major = int(version.split('.')[0])
    except (ValueError, IndexError):
        return 'Could not determine macOS version; macOS 14 or newer is required.'
    if major < 14:
        return f'macOS {version} is not supported; macOS 14 or newer is required.'
    return None


def path_check():
    problem = platform_problem()
    print('\n1. Environment check')
    say_status(problem is None, 'Computer', problem or 'Apple silicon, macOS 14 or newer')
    if not problem:
        chrome_paths = (Path('/Applications/Google Chrome.app'), Path.home() / 'Applications/Google Chrome.app')
        chrome_found = any(path.is_dir() for path in chrome_paths)
        say_status(chrome_found, 'Google Chrome', 'found' if chrome_found else 'not found in the usual Applications folders')
        if not chrome_found:
            print('  If you need Chrome, get it from https://www.google.com/chrome/.')
            print('  If it is installed elsewhere, you can still continue and open it yourself.')
    files = [
        (EXTENSION / 'manifest.json', 'Chrome extension files'),
        (MODEL, 'AI model'),
        (RUNTIME, 'ONNX Runtime'),
        (BIN, 'Bridge program'),
    ]
    ok = not problem
    for path, name in files:
        present = path.is_file() and (path != BIN or os.access(path, os.X_OK))
        say_status(present, name, 'found' if present else 'missing or not executable')
        ok = ok and present
    if BIN.is_file() and os.access(BIN, os.X_OK) and not problem:
        try:
            check = subprocess.run([str(BIN), '--help'], env=runtime_env(), capture_output=True, text=True, timeout=15)
            good = check.returncode == 0 and 'majsoul-bridge-server' in check.stdout
            say_status(good, 'Bridge starts', 'ready' if good else (check.stderr.strip().split('\n')[0] or 'could not start'))
            ok = ok and good
        except (OSError, subprocess.TimeoutExpired) as e:
            say_status(False, 'Bridge starts', str(e))
            ok = False
    if ok:
        try:
            print('  Checking AI model…', flush=True)
            result = subprocess.run([str(BIN), '--self-test', '--model', str(MODEL)], env=runtime_env(), capture_output=True, text=True, timeout=90)
            good = result.returncode == 0
            detail = 'loaded successfully' if good else (result.stderr.strip().split('\n')[0] or 'model test failed')
            say_status(good, 'AI inference', detail)
            ok = ok and good
        except (OSError, subprocess.TimeoutExpired) as e:
            say_status(False, 'AI inference', str(e))
            ok = False
    if not ok:
        print('\nSome bundled files are missing or the bridge could not start. Keep the folder together and copy the complete portable package again.')
    return ok


def chrome_profiles():
    root = Path.home() / 'Library' / 'Application Support' / 'Google' / 'Chrome'
    # Only the extension entry and source path are used; no other profile data is printed or saved.
    files = []
    if (root / 'Default').is_dir(): files.extend([root / 'Default' / 'Secure Preferences', root / 'Default' / 'Preferences'])
    for folder in sorted(root.glob('Profile *')):
        if folder.is_dir(): files.extend([folder / 'Secure Preferences', folder / 'Preferences'])
    return files


def find_extension():
    """Find this exact unpacked extension, not an older copy with the same name."""
    matches = {}
    for path in chrome_profiles():
        try:
            if path.stat().st_size > 32 * 1024 * 1024: continue
            data = json.loads(path.read_text(encoding='utf-8'))
            entries = data.get('extensions', {}).get('settings', {})
            if not isinstance(entries, dict): continue
            for ident, entry in entries.items():
                if not EXTENSION_ID.fullmatch(ident) or not isinstance(entry, dict): continue
                source = entry.get('path')
                if not isinstance(source, str): continue
                try: same = Path(source).expanduser().resolve() == EXTENSION.resolve()
                except (OSError, RuntimeError): continue
                if not same: continue
                disabled = entry.get('state') == 0 or bool(entry.get('disable_reasons'))
                matches[ident] = matches.get(ident, False) or not disabled
        except (OSError, ValueError, AttributeError, TypeError):
            continue
    return matches


def clipboard():
    tool = shutil.which('pbpaste')
    if not tool: return ''
    try: return subprocess.run([tool], capture_output=True, text=True, timeout=3).stdout.strip()
    except (OSError, subprocess.TimeoutExpired): return ''


def open_extensions():
    try:
        # Chrome opens the extension management page in the user's current profile.
        subprocess.run(['open', '-a', 'Google Chrome', 'chrome://extensions/'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


def choose_extension(settings, force_prompt=False):
    print('\n2. Chrome extension check')
    matches = find_extension()
    saved = settings.get('extension_id', '')
    if not isinstance(saved, str) or not EXTENSION_ID.fullmatch(saved): saved = ''
    active = [ident for ident, enabled in matches.items() if enabled]
    if not force_prompt and saved and saved in active:
        say_status(True, 'Matching extension found in a Chrome profile', saved)
        print('  It will be confirmed when the game connects; use the same Chrome profile.')
        return saved
    if not force_prompt and len(active) == 1:
        ident = active[0]
        say_status(True, 'Matching extension found in a Chrome profile', ident)
        print('  It will be confirmed when the game connects; use the same Chrome profile.')
        settings['extension_id'] = ident
        save_settings(settings)
        return ident
    if not force_prompt and saved and not matches:
        print('  Saved ID:', saved)
        print('  Chrome installation could not be verified in this profile.')
        print('  If you moved the folder, load this copy into Chrome again.')
        if ask_yes('  Use the saved ID anyway?', default=False): return saved
    elif saved and saved in matches and not matches[saved]:
        print('  The saved extension appears disabled in Chrome.')
    elif len(active) > 1:
        print('  More than one matching installation was found; choose the ID from your Chrome profile.')
    else:
        print('  This portable copy has not been detected in Chrome.')
    print('\n  Install or enable it once:')
    print('  1. Open Chrome → Extensions → Manage extensions.')
    print('  2. Turn on Developer mode, then choose Load unpacked.')
    print('  3. Choose this folder:')
    print('     ' + str(EXTENSION))
    print('  4. Enable mjai HUD and copy its 32-letter ID.')
    if ask_yes('\n  Open the Chrome extensions page now?', default=True):
        if not open_extensions(): print('  Please open chrome://extensions in Google Chrome.')
    print('\n  Once installed, press Return to detect it automatically.')
    print('  You can also paste the ID here or copy it in Chrome before pressing Return.')
    while True:
        ident = input('  Extension ID (or Return): ').strip()
        if not ident:
            detected = [key for key, enabled in find_extension().items() if enabled]
            if len(detected) == 1: ident = detected[0]
            else: ident = clipboard()
        if not ident:
            print('  Extension setup is not complete.')
            return None
        if EXTENSION_ID.fullmatch(ident):
            matches = find_extension()
            if ident in matches and not matches[ident]:
                print('  This extension appears disabled; enable it in Chrome before continuing.')
                continue
            if ident not in matches:
                print('  Could not verify this ID belongs to the portable folder in Chrome.')
                if not ask_yes('  Continue with this ID anyway?'): continue
            settings['extension_id'] = ident
            if save_settings(settings): print('  Saved. You will not need to type it next time.')
            else: print('  Continuing for this session; settings could not be saved.')
            return ident
        print('  An extension ID is exactly 32 lowercase letters from a to p. Try again.')


def port_in_use():
    try:
        with socket.create_connection(('127.0.0.1', 23410), timeout=0.3): return True
    except OSError: return False


def start_bridge(ident):
    if port_in_use():
        print('\nAnother program is already using the bridge port (23410).')
        print('Stop the other bridge first; this launcher will not interrupt it.')
        return False
    print('\nBridge starting. Keep this window open while you play.')
    print('In Chrome, open or refresh the Mahjong Soul page, then start a four-player game.')
    print('The HUD will appear in the game. Press Control-C here when you are finished.\n')
    cmd = [str(BIN), '--model', str(MODEL), '--allow-origin', 'chrome-extension://' + ident]
    try:
        proc = subprocess.Popen(cmd, cwd=str(ROOT), env=runtime_env())
    except OSError as e:
        print('Could not start the bridge:', e)
        return False
    try:
        code = proc.wait()
    except KeyboardInterrupt:
        print('\nStopping the bridge…')
        # Ctrl-C reaches the child in the same foreground process group.
        try: code = proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            print('The bridge is still stopping. Please leave this window open briefly.')
            code = proc.wait()
    if code != 0:
        print(f'Bridge stopped (code {code}). Check the messages above.')
        return False
    print('Bridge stopped.')
    return True


def main():
    parser = argparse.ArgumentParser(description='Set up and start mjai')
    parser.add_argument('--check', action='store_true', help='check bundled components and exit')
    args = parser.parse_args()
    print('\n  mjai')
    print('  ==========================')
    ready = path_check()
    if args.check: return 0 if ready else 1
    if not ready:
        input('\nPress Return to close…')
        return 1
    settings = load_settings()
    while True:
        print('\n  1  Check Chrome and start')
        print('  2  Change extension ID')
        print('  3  Check the environment again')
        print('  4  Quit')
        choice = input('\nChoose [1]: ').strip() or '1'
        if choice == '1':
            ident = choose_extension(settings)
            if ident: start_bridge(ident)
        elif choice == '2':
            choose_extension(settings, force_prompt=True)
        elif choice == '3':
            if not path_check(): return 1
        elif choice in ('4', 'q', 'quit', 'exit'):
            return 0
        else: print('Please choose 1, 2, 3 or 4.')


if __name__ == '__main__':
    try: sys.exit(main())
    except (EOFError, KeyboardInterrupt):
        print('\nGoodbye.')
        sys.exit(0)
