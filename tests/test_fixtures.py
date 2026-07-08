import importlib.util
import os
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "app" / "nazboard.py"


def load_app():
    spec = importlib.util.spec_from_file_location("nazboard", APP_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FixtureModeTests(TestCase):
    def test_render_page_uses_redacted_command_output(self):
        app = load_app()

        with patch.dict(os.environ, {app.FIXTURE_DIR_ENV: str(ROOT / "tests")}):
            page = app.render_page().decode("utf-8")

        self.assertIn("All pools are healthy", page)
        self.assertIn("storage01", page)
        self.assertIn("scsi-SATA_WDC_WD30EFRX-68A_WD-XXXXXXXXXXXX", page)
        self.assertIn("$ zpool status -x", page)

    def test_render_command_escapes_output(self):
        app = load_app()
        result = app.CommandResult(
            title="unsafe",
            command=("zpool", "status"),
            returncode=0,
            stdout="<script>alert(1)</script>",
            stderr="",
        )

        rendered = app.render_command(result)

        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", rendered)
        self.assertNotIn("<script>", rendered)


if __name__ == "__main__":
    main()
