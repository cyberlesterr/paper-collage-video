#!/usr/bin/env python3
"""Split a regular chroma-key character sheet into trimmed cell images."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("prefix")
    parser.add_argument("count", type=int)
    parser.add_argument("--columns", type=int, default=2)
    parser.add_argument("--padding", type=int, default=20)
    parser.add_argument("--key-threshold", type=float, default=48.0)
    parser.add_argument("--suffix", default="key")
    return parser.parse_args()


def foreground_bbox(cell: Image.Image, threshold: float) -> tuple[int, int, int, int]:
    rgb = np.asarray(cell.convert("RGB"), dtype=np.float32)
    samples = np.concatenate(
        [rgb[:4, :, :].reshape(-1, 3), rgb[-4:, :, :].reshape(-1, 3)], axis=0
    )
    key = np.median(samples, axis=0)
    distance = np.linalg.norm(rgb - key, axis=2)
    ys, xs = np.where(distance > threshold)
    if len(xs) == 0:
        return (0, 0, cell.width, cell.height)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def padded_bbox(
    bbox: tuple[int, int, int, int], width: int, height: int, padding: int
) -> tuple[int, int, int, int]:
    left, top, right, bottom = bbox
    return (
        max(0, left - padding),
        max(0, top - padding),
        min(width, right + padding),
        min(height, bottom + padding),
    )


def main() -> None:
    args = parse_args()
    if args.count < 1 or args.columns < 1:
        raise SystemExit("count and columns must be positive")

    source = Image.open(args.input).convert("RGB")
    rows = math.ceil(args.count / args.columns)
    cell_width = source.width / args.columns
    cell_height = source.height / rows
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for index in range(args.count):
        row, column = divmod(index, args.columns)
        bounds = (
            round(column * cell_width),
            round(row * cell_height),
            round((column + 1) * cell_width),
            round((row + 1) * cell_height),
        )
        cell = source.crop(bounds)
        crop = padded_bbox(
            foreground_bbox(cell, args.key_threshold),
            cell.width,
            cell.height,
            args.padding,
        )
        output = args.output_dir / f"{args.prefix}-{index + 1}-{args.suffix}.png"
        cell.crop(crop).save(output)
        print(output)


if __name__ == "__main__":
    main()
