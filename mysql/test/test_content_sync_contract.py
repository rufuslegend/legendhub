import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))

from content_sync.contract import Manifest, PUBLIC_TABLES


EXPECTED_TABLES = (
    "Areas", "Categories", "ChangelogVersions",
    "ChangelogVersions_AuditTrail", "Eras", "ItemMobMap",
    "ItemStatCategories", "ItemStatInfo", "Items", "Items_AuditTrail",
    "Mobs", "Mobs_AuditTrail", "Quests", "Quests_AuditTrail",
    "SubCategories", "WikiPages", "WikiPages_AuditTrail",
)


class ContractTests(unittest.TestCase):
    def test_allowlist_is_exact_and_ordered(self):
        self.assertEqual(PUBLIC_TABLES, EXPECTED_TABLES)

    def test_manifest_round_trip_is_canonical(self):
        manifest = Manifest(
            version=1,
            content_sha256="a" * 64,
            artifact_sha256="b" * 64,
            artifact_bytes=123,
            schema_sha256="c" * 64,
            created_at="2026-08-17T14:00:00Z",
            row_counts={table: index for index, table in enumerate(PUBLIC_TABLES)},
        )
        serialized = manifest.serialize()
        self.assertEqual(Manifest.parse(serialized), manifest)
        self.assertEqual(serialized, json.dumps(
            json.loads(serialized), sort_keys=True, separators=(",", ":")) + "\n")

    def test_manifest_rejects_missing_extra_or_malformed_tables(self):
        base = {
            "version": 1,
            "content_sha256": "a" * 64,
            "artifact_sha256": "b" * 64,
            "artifact_bytes": 123,
            "schema_sha256": "c" * 64,
            "created_at": "2026-08-17T14:00:00Z",
            "row_counts": {table: 0 for table in PUBLIC_TABLES},
        }
        for mutation in ("missing", "extra", "bad_digest", "negative_count",
                         "bad_timestamp", "zero_bytes", "extra_field"):
            candidate = json.loads(json.dumps(base))
            if mutation == "missing":
                candidate["row_counts"].pop("Areas")
            elif mutation == "extra":
                candidate["row_counts"]["Members"] = 1
            elif mutation == "bad_digest":
                candidate["content_sha256"] = "not-a-digest"
            elif mutation == "negative_count":
                candidate["row_counts"]["Areas"] = -1
            elif mutation == "bad_timestamp":
                candidate["created_at"] = "today"
            elif mutation == "zero_bytes":
                candidate["artifact_bytes"] = 0
            else:
                candidate["secret_table"] = "Members"
            with self.subTest(mutation=mutation):
                with self.assertRaises(ValueError):
                    Manifest.parse(json.dumps(candidate))
