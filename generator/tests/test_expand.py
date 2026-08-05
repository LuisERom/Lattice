"""Tests for prerequisite-expansion growth."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ["LATTICE_FAKE_LLM"] = "1"

from pipeline.connectivity import degree_by_ref, unlinked_refs
from pipeline.expand import run_expand
from pipeline.seeds import run_seeds


class ExpandTests(unittest.TestCase):
    def test_fake_expand_builds_prereq_spine(self):
        scope = {
            "scope": {
                "name": "Fake",
                "scope_level": "working",
                "scope_description": "test",
            }
        }
        seeds = {
            "seeds": [
                {
                    "name": "Goal A",
                    "description": "capstone",
                    "tentative_type": "concept",
                    "section_ref": "s1",
                    "is_seed": True,
                },
                {
                    "name": "Workflow B",
                    "description": "procedure",
                    "tentative_type": "procedure",
                    "section_ref": "s1",
                    "is_seed": True,
                },
            ]
        }
        out = run_expand(scope, seeds, model="fake", max_depth=3, max_nodes=40)
        nodes = out["nodes"]
        edges = out["edges"]
        self.assertGreaterEqual(len(nodes), 2)
        self.assertTrue(all(e["type"] == "prerequisite_of" for e in edges))
        # Every non-seed should appear as a source or target of a prereq edge.
        seed_refs = {n["ref"] for n in nodes if n.get("is_seed")}
        touched = set()
        for e in edges:
            touched.add(e["source_ref"])
            touched.add(e["target_ref"])
        for n in nodes:
            if n["ref"] not in seed_refs:
                self.assertIn(n["ref"], touched)

    def test_fake_seeds_then_expand_no_mass_isolates(self):
        scope = {
            "scope": {
                "name": "Fake",
                "scope_level": "working",
                "scope_description": "test",
            }
        }
        scaffold = {
            "sections": [
                {"ref": "s1", "name": "Foundations", "in": "core", "out": "history"},
                {"ref": "s2", "name": "Workflows", "in": "flows", "out": "edge"},
            ]
        }
        seeds = run_seeds(scope, scaffold, model="fake", concurrency=2)
        self.assertTrue(seeds["seeds"])
        self.assertLessEqual(len(seeds["seeds"]), 10)  # small, not a dump
        out = run_expand(scope, seeds, model="fake", max_depth=3, max_nodes=40)
        isolates = unlinked_refs(out["nodes"], out["edges"])
        # Roots with no prereqs can be temporarily isolate until later phases;
        # expansion should still connect most of the grown set.
        deg = degree_by_ref(out["nodes"], out["edges"])
        connected = sum(1 for d in deg.values() if d > 0)
        self.assertGreaterEqual(connected, len(out["nodes"]) - len(seeds["seeds"]))
        self.assertLessEqual(len(isolates), len(seeds["seeds"]))


if __name__ == "__main__":
    unittest.main()
