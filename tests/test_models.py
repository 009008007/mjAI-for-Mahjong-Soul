import pathlib
import tempfile
import unittest
from unittest.mock import patch
import model_manager


class ModelTests(unittest.TestCase):
    def test_drag_paths_mac_and_windows(self):
        self.assertEqual(str(model_manager.parse_drop("'/tmp/a b.onnx'")), '/tmp/a b.onnx')
        self.assertEqual(str(model_manager.parse_drop(r'/tmp/a\ b.onnx')), '/tmp/a b.onnx')
        self.assertEqual(str(model_manager.parse_drop(r'"C:\My Models\a.onnx"', windows=True)), r'C:\My Models\a.onnx')
        self.assertIsNone(model_manager.parse_drop('bad " path'))

    def test_import_is_validated_copied_and_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            source = root / 'a.onnx'
            source.write_bytes(b'first')
            models = root / 'models'
            with patch.object(model_manager, 'validate_model', return_value=(True, '')):
                first = model_manager.import_model(source, models, 'bridge', {})
                self.assertEqual(first.read_bytes(), b'first')
                self.assertEqual(model_manager.import_model(source, models, 'bridge', {}), first)
                source.write_bytes(b'second')
                second = model_manager.import_model(source, models, 'bridge', {})
                self.assertNotEqual(first, second)
                self.assertEqual(first.read_bytes(), b'first')
                self.assertEqual(second.read_bytes(), b'second')
            with patch.object(model_manager, 'validate_model', return_value=(False, 'bad model')):
                with self.assertRaisesRegex(ValueError, 'bad model'):
                    model_manager.import_model(source, models, 'bridge', {})

    def test_selection_remembers_model_and_validates(self):
        with tempfile.TemporaryDirectory() as tmp:
            models = pathlib.Path(tmp)
            model = models / 'model.onnx'
            model.touch()
            settings = {'extension_id': 'a' * 32}
            with patch('builtins.input', return_value='1'), patch.object(model_manager, 'validate_model', return_value=(True, '')) as validate:
                self.assertEqual(model_manager.choose_model(models, 'bridge', {}, settings, lambda _: True), model)
            validate.assert_called_once()
            self.assertEqual(settings['last_model'], 'model.onnx')
            self.assertEqual(settings['extension_id'], 'a' * 32)


if __name__ == '__main__':
    unittest.main()
