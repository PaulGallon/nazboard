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
        self.assertIn('class="summary usage-pill error"', page)
        self.assertIn("<strong>storage01</strong> 96% used", page)
        self.assertNotIn("progressbar", page)

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

    def test_root_dataset_usage_only_includes_root_level_datasets(self):
        app = load_app()
        result = app.CommandResult(
            title="zfs list",
            command=("zfs", "list", "-o", "name,used,avail,refer,mountpoint"),
            returncode=0,
            stdout=(
                "NAME USED AVAIL REFER MOUNTPOINT\n"
                "tank 50G 50G 10G /tank\n"
                "tank/home 90G 10G 90G /tank/home\n"
                "backup 1T 3T 1T /backup\n"
            ),
            stderr="",
        )

        datasets = app.root_dataset_usage([result])

        self.assertEqual([dataset.name for dataset in datasets], ["tank", "backup"])
        self.assertEqual(datasets[0].used_percent, 50.0)
        self.assertEqual(datasets[1].used_percent, 25.0)

    def test_dataset_usage_threshold_classes(self):
        app = load_app()

        self.assertEqual(app.classify_dataset_usage(74.9), "ok")
        self.assertEqual(app.classify_dataset_usage(75.0), "warn")
        self.assertEqual(app.classify_dataset_usage(84.9), "warn")
        self.assertEqual(app.classify_dataset_usage(85.0), "error")


if __name__ == "__main__":
    main()
