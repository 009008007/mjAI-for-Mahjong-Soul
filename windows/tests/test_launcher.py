import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

path = pathlib.Path(__file__).resolve().parents[1] / 'launcher.py'
spec = importlib.util.spec_from_file_location('launcher', path)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class LauncherTests(unittest.TestCase):
    def test_windows_x64_required(self):
        with patch.object(launcher.sys, 'platform', 'win32'), patch.object(launcher.platform, 'machine', return_value='AMD64'):
            self.assertIsNone(launcher.platform_problem())
        with patch.object(launcher.sys, 'platform', 'win32'), patch.object(launcher.platform, 'machine', return_value='ARM64'):
            self.assertIsNotNone(launcher.platform_problem())
        with patch.object(launcher.sys, 'platform', 'darwin'):
            self.assertIsNotNone(launcher.platform_problem())

    def test_detects_extension_from_windows_localappdata(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            ext = root / 'package' / 'extension'; ext.mkdir(parents=True)
            profile = root / 'Google' / 'Chrome' / 'User Data' / 'Default'; profile.mkdir(parents=True)
            (profile / 'Preferences').write_text(json.dumps({'extensions': {'settings': {'c'*32: {'path': str(ext), 'state': 1}}}}))
            with patch.dict(launcher.os.environ, {'LOCALAPPDATA':tmp}), patch.object(launcher, 'EXTENSION', ext):
                self.assertEqual(launcher.find_extension(), {'c'*32:True})

    def test_runtime_environment_includes_bundled_windows_dlls(self):
        env = launcher.runtime_env()
        self.assertEqual(env['ORT_DYLIB_PATH'], str(launcher.RUNTIME))
        self.assertIn(str(launcher.PYTHON_HOME), env['PATH'].split(launcher.os.pathsep))
        self.assertIn(str(launcher.RUNTIME.parent), env['PATH'].split(launcher.os.pathsep))
    def test_saves_and_loads_settings(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(launcher, 'ROOT', pathlib.Path(tmp)), patch.object(launcher, 'SETTINGS', pathlib.Path(tmp) / '.settings'):
            self.assertTrue(launcher.save_settings({'extension_id':'a'*32}))
            self.assertEqual(launcher.load_settings()['extension_id'], 'a'*32)

    def test_automatically_remembers_detected_extension(self):
        settings = {}
        with patch.object(launcher, 'find_extension', return_value={'b'*32: True}), patch.object(launcher, 'save_settings', return_value=True):
            self.assertEqual(launcher.choose_extension(settings), 'b'*32)
        self.assertEqual(settings['extension_id'], 'b'*32)

    def test_change_id_prompts_even_if_a_copy_is_detected(self):
        settings = {'extension_id': 'a'*32}
        with patch.object(launcher, 'find_extension', return_value={'a'*32: True, 'b'*32: True}), patch.object(launcher, 'save_settings', return_value=True), patch('builtins.input', side_effect=['n','b'*32]):
            self.assertEqual(launcher.choose_extension(settings, force_prompt=True), 'b'*32)
        self.assertEqual(settings['extension_id'], 'b'*32)

    def test_detects_extension_after_install_without_typing_id(self):
        settings = {}
        with patch.object(launcher, 'find_extension', side_effect=[{}, {'c'*32: True}, {'c'*32: True}]), patch.object(launcher, 'save_settings', return_value=True), patch('builtins.input', side_effect=['n','']):
            self.assertEqual(launcher.choose_extension(settings), 'c'*32)
        self.assertEqual(settings['extension_id'], 'c'*32)

    def test_bad_id_then_cancel_does_not_overwrite_old_id(self):
        settings = {'extension_id':'a'*32}
        with patch.object(launcher, 'find_extension', return_value={}), patch.object(launcher, 'clipboard', return_value=''), patch('builtins.input', side_effect=['n','invalid','']):
            self.assertIsNone(launcher.choose_extension(settings, force_prompt=True))
        self.assertEqual(settings['extension_id'],'a'*32)

    def test_runtime_environment_ignores_pythonpath(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(launcher, 'PYTHON_HOME', pathlib.Path(tmp)), patch.dict(launcher.os.environ, {'PYTHONPATH':'/unexpected','PYTHONUSERBASE':'/unexpected'}):
            env = launcher.runtime_env()
            self.assertEqual(env['PYTHONHOME'],str(launcher.PYTHON_HOME))
        self.assertNotIn('PYTHONPATH', env)
        self.assertNotIn('PYTHONUSERBASE', env)

    def test_environment_check_invokes_model_self_test(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            extension = root/'extension'; extension.mkdir(); (extension/'manifest.json').write_text('{}')
            model = root/'model.onnx'; model.touch()
            runtime = root/'runtime.dylib'; runtime.touch()
            binary = root/'server'; binary.touch(); binary.chmod(0o755)
            results = [SimpleNamespace(returncode=0, stdout='majsoul-bridge-server', stderr=''), SimpleNamespace(returncode=0, stdout='OK', stderr='')]
            with patch.object(launcher,'EXTENSION',extension), patch.object(launcher,'MODEL',model), patch.object(launcher,'RUNTIME',runtime), patch.object(launcher,'BIN',binary), patch.object(launcher,'platform_problem',return_value=None), patch.object(launcher.subprocess,'run',side_effect=results) as run:
                self.assertTrue(launcher.path_check())
                self.assertIn('--self-test',run.call_args_list[1].args[0])

    def test_refuses_to_disturb_existing_bridge(self):
        with patch.object(launcher,'port_in_use',return_value=True), patch.object(launcher.subprocess,'Popen') as popen:
            self.assertFalse(launcher.start_bridge('a'*32))
            popen.assert_not_called()

if __name__ == '__main__':
    unittest.main()
