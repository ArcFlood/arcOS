import tempfile
import unittest
from pathlib import Path

from ingestion.obsidian_reader import parse_file


class ObsidianReaderTests(unittest.TestCase):
    def test_plain_obsidian_note_is_normalized(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            note_path = Path(temp_dir) / "Project Note.md"
            note_path.write_text("# Heading\n\nUseful content lives here.\n", encoding="utf-8")

            doc = parse_file(note_path)

            self.assertIsNotNone(doc)
            assert doc is not None
            self.assertEqual(doc.source_type, "obsidian")
            self.assertEqual(doc.title, "Project Note")
            self.assertEqual(doc.body, "# Heading\n\nUseful content lives here.")

    def test_unsupported_source_is_downgraded_to_obsidian(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            note_path = Path(temp_dir) / "Imported.md"
            note_path.write_text(
                "---\nsource: gwen\ntitle: Imported\ndate: 2026-04-04\n---\n\nBody text\n",
                encoding="utf-8",
            )

            doc = parse_file(note_path)

            self.assertIsNotNone(doc)
            assert doc is not None
            self.assertEqual(doc.source_type, "obsidian")
            self.assertEqual(doc.date, "2026-04-04")

    def test_empty_body_is_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            note_path = Path(temp_dir) / "Untitled.md"
            note_path.write_text("---\ntitle: Untitled\n---\n", encoding="utf-8")

            doc = parse_file(note_path)

            self.assertIsNone(doc)


if __name__ == "__main__":
    unittest.main()
