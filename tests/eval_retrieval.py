"""Compute Recall@10 from hand-labelled retrieval results.

Input is a JSON file containing objects with:
  {"relevant": ["writeup-id"], "keyword": [...], "vector": [...], "hybrid": [...]}
The ranked arrays contain writeup ids in descending rank order.
"""
import json
import sys


def recall(rows, method):
    if not rows:
        return 0.0
    hits = 0
    relevant = 0
    for row in rows:
        expected = set(map(str, row["relevant"]))
        retrieved = set(map(str, row[method][:10]))
        hits += len(expected & retrieved)
        relevant += len(expected)
    return hits / relevant if relevant else 0.0


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python tests/eval_retrieval.py labels.json")
        return 2
    with open(sys.argv[1], encoding="utf-8") as stream:
        rows = json.load(stream)
    print("| Method | Recall@10 |")
    print("|---|---:|")
    for method in ("keyword", "vector", "hybrid"):
        print(f"| {method} | {recall(rows, method):.3f} |")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
