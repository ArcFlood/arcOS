import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from mcp_server.server import _chunk_to_citation, _dedupe_chunks_by_source_path, _is_meaningful_chunk


class ServerFilterTests(unittest.TestCase):
    def test_dedupe_prefers_best_scoring_chunk_per_path(self) -> None:
        low = SimpleNamespace(source_path="/vault/a.md", rerank_score=-2.0)
        high = SimpleNamespace(source_path="/vault/a.md", rerank_score=4.0)
        other = SimpleNamespace(source_path="/vault/b.md", rerank_score=1.0)

        deduped = _dedupe_chunks_by_source_path([low, other, high])

        self.assertEqual([chunk.source_path for chunk in deduped], ["/vault/a.md", "/vault/b.md"])
        self.assertEqual(deduped[0].rerank_score, 4.0)

    def test_meaningful_chunk_filters_empty_and_placeholder_titles(self) -> None:
        self.assertFalse(_is_meaningful_chunk(SimpleNamespace(title="Untitled", text="short text")))
        self.assertFalse(_is_meaningful_chunk(SimpleNamespace(title="Anything", text="   ")))
        self.assertTrue(_is_meaningful_chunk(SimpleNamespace(title="Project Note", text="This note has enough content to keep.")))

    def test_citation_uses_encoded_obsidian_uri(self) -> None:
        from mcp_server import server as server_module

        original_vault_path = server_module.VAULT_PATH
        try:
            with TemporaryDirectory(prefix="arc vault ") as vault_dir:
                vault_path = Path(vault_dir)
                note_path = vault_path / "nested" / "My Note.md"
                note_path.parent.mkdir(parents=True, exist_ok=True)
                note_path.write_text("Quoted content", encoding="utf-8")

                server_module.VAULT_PATH = vault_path
                chunk = SimpleNamespace(
                    source_path=str(note_path),
                    title="My Note",
                    date="2026-04-04",
                    source_type="obsidian",
                    text="Quoted content",
                    rerank_score=1.25,
                )

                citation = _chunk_to_citation(chunk)

                self.assertIn(f"vault={vault_path.name.replace(' ', '%20')}", citation["obsidian_uri"])
                self.assertIn("file=nested/My%20Note.md", citation["obsidian_uri"])
        finally:
            server_module.VAULT_PATH = original_vault_path


if __name__ == "__main__":
    unittest.main()
