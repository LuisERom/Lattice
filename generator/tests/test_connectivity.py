"""Unit tests for orphan detection and unlinked-concept pruning."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.connectivity import prune_contract, prune_unlinked_concepts, unlinked_refs
from pipeline.validate import find_orphan_nodes, validate_contract


def _doc(**overrides):
    base = {
        "topic": {
            "name": "T",
            "scope_description": "d",
            "scope_level": "working",
        },
        "nodes": [
            {"ref": "a", "type": "concept", "name": "A", "description": "a"},
            {"ref": "b", "type": "concept", "name": "B", "description": "b"},
            {"ref": "p", "type": "procedure", "name": "P", "description": "p"},
            {"ref": "orphan", "type": "concept", "name": "Orphan", "description": "o"},
        ],
        "edges": [
            {"ref": "e1", "source_ref": "a", "target_ref": "b", "type": "prerequisite_of"},
            {
                "ref": "e2",
                "source_ref": "a",
                "target_ref": "p",
                "type": "part_of",
                "order_index": 1,
            },
            {
                "ref": "e3",
                "source_ref": "b",
                "target_ref": "p",
                "type": "part_of",
                "order_index": 2,
            },
        ],
        "items": [
            {
                "ref": "i_a",
                "kind": "atomic",
                "member_node_refs": ["a"],
                "questions": [
                    {"method": "cloze", "prompt": "x", "expected_answer": "y"},
                    {"method": "free_recall", "prompt": "x", "expected_answer": "y"},
                ],
            },
            {
                "ref": "i_orphan",
                "kind": "atomic",
                "member_node_refs": ["orphan"],
                "questions": [
                    {"method": "cloze", "prompt": "x", "expected_answer": "y"},
                    {"method": "free_recall", "prompt": "x", "expected_answer": "y"},
                ],
            },
            {
                "ref": "i_b",
                "kind": "atomic",
                "member_node_refs": ["b"],
                "questions": [
                    {"method": "cloze", "prompt": "x", "expected_answer": "y"},
                    {"method": "application", "prompt": "x", "expected_answer": "y"},
                ],
            },
            {
                "ref": "i_conn",
                "kind": "connection",
                "member_node_refs": ["a", "b"],
                "edge_ref": "e1",
                "questions": [
                    {"method": "relational", "prompt": "x", "expected_answer": "y"},
                    {"method": "free_recall", "prompt": "x", "expected_answer": "y"},
                ],
            },
            {
                "ref": "i_comp",
                "kind": "composition",
                "member_node_refs": ["p", "a", "b"],
                "ordering": ["a", "b"],
                "questions": [
                    {"method": "relational", "prompt": "x", "expected_answer": "y"},
                    {"method": "free_recall", "prompt": "x", "expected_answer": "y"},
                ],
            },
        ],
    }
    base.update(overrides)
    return base


class ConnectivityTests(unittest.TestCase):
    def test_orphan_ignores_atomic_items(self):
        errs = find_orphan_nodes(_doc())
        self.assertEqual(len(errs), 1)
        self.assertIn("orphan", errs[0])
        self.assertIn("no edges", errs[0])

    def test_unlinked_refs(self):
        doc = _doc()
        self.assertEqual(unlinked_refs(doc["nodes"], doc["edges"]), ["orphan"])

    def test_prune_removes_concept_and_items(self):
        doc, removed = prune_contract(_doc())
        self.assertEqual(removed, ["orphan"])
        refs = {n["ref"] for n in doc["nodes"]}
        self.assertNotIn("orphan", refs)
        self.assertIn("a", refs)
        item_refs = {i["ref"] for i in doc["items"]}
        self.assertNotIn("i_orphan", item_refs)
        self.assertIn("i_a", item_refs)
        # No orphans remain.
        self.assertEqual(find_orphan_nodes(doc), [])

    def test_prune_keeps_unlinked_procedures(self):
        nodes = [
            {"ref": "a", "type": "concept", "name": "A"},
            {"ref": "b", "type": "concept", "name": "B"},
            {"ref": "lonely_p", "type": "procedure", "name": "Lonely"},
        ]
        edges = [
            {
                "ref": "e1",
                "source_ref": "a",
                "target_ref": "b",
                "type": "prerequisite_of",
            }
        ]
        out = prune_unlinked_concepts(nodes, edges, {})
        self.assertEqual(out["removed"], [])
        self.assertTrue(any(n["ref"] == "lonely_p" for n in out["nodes"]))

    def test_prune_preserves_edge_refs(self):
        doc, _ = prune_contract(_doc())
        edge_refs = {e["ref"] for e in doc["edges"]}
        self.assertIn("e1", edge_refs)
        conn = next(i for i in doc["items"] if i["ref"] == "i_conn")
        self.assertEqual(conn["edge_ref"], "e1")

    def test_validate_flags_orphan_even_with_item(self):
        errors = validate_contract(_doc())
        self.assertTrue(any("orphan nodes with no edges" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
