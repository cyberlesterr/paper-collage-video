#!/usr/bin/env python3
"""Turn a solid chroma-key background into a soft transparent alpha matte."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--transparent-threshold", type=float, default=18.0)
    parser.add_argument("--opaque-threshold", type=float, default=95.0)
    parser.add_argument("--edge-feather", type=float, default=0.6)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def sample_key(rgb: np.ndarray) -> np.ndarray:
    border = np.concatenate(
        [
            rgb[:4, :, :].reshape(-1, 3),
            rgb[-4:, :, :].reshape(-1, 3),
            rgb[:, :4, :].reshape(-1, 3),
            rgb[:, -4:, :].reshape(-1, 3),
        ],
        axis=0,
    )
    return np.median(border, axis=0)


def main() -> None:
    args = parse_args()
    if args.out.exists() and not args.force:
        raise SystemExit(f"Output exists: {args.out}; pass --force to overwrite")
    if args.opaque_threshold <= args.transparent_threshold:
        raise SystemExit("opaque-threshold must be larger than transparent-threshold")

    source = Image.open(args.input).convert("RGB")
    rgb = np.asarray(source, dtype=np.float32)
    key = sample_key(rgb)
    distance = np.linalg.norm(rgb - key, axis=2)
    alpha = np.clip(
        (distance - args.transparent_threshold)
        / (args.opaque_threshold - args.transparent_threshold),
        0.0,
        1.0,
    )
    alpha_image = Image.fromarray(np.uint8(alpha * 255), mode="L")
    if args.edge_feather > 0:
        alpha_image = alpha_image.filter(ImageFilter.GaussianBlur(args.edge_feather))
    alpha_u8 = np.asarray(alpha_image, dtype=np.uint8)

    red = rgb[:, :, 0]
    green = rgb[:, :, 1]
    blue = rgb[:, :, 2]
    spill = np.maximum(0.0, green - np.maximum(red, blue))
    edge_strength = 1.0 - alpha_u8.astype(np.float32) / 255.0
    rgb[:, :, 1] = np.maximum(0.0, green - spill * (0.58 + 0.42 * edge_strength))

    rgba = np.dstack([np.uint8(np.clip(rgb, 0, 255)), alpha_u8])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, mode="RGBA").save(args.out)

    transparent = int(np.count_nonzero(alpha_u8 == 0))
    partial = int(np.count_nonzero((alpha_u8 > 0) & (alpha_u8 < 255)))
    total = int(alpha_u8.size)
    key_hex = "#" + "".join(f"{round(channel):02x}" for channel in key)
    print(f"Wrote {args.out}")
    print(f"Key color: {key_hex}")
    print(f"Transparent pixels: {transparent}/{total}")
    print(f"Partially transparent pixels: {partial}/{total}")


if __name__ == "__main__":
    main()
