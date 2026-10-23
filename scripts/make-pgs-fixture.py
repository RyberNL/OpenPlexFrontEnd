"""Writes test/fixtures/media/subtitles.sup: a minimal PGS (Blu-ray) subtitle for the e2e tests.

ffmpeg can't encode PGS, so the segments are written by hand. The subtitle shows one solid red
600x100 box near the bottom of a 1280x720 frame from 0:01 to 0:30.
"""

import struct
import sys
from pathlib import Path

WIDTH, HEIGHT = 1280, 720
BOX_W, BOX_H, BOX_X, BOX_Y = 600, 100, 340, 560
RED = (81, 240, 90)  # Y, Cr, Cb (BT.601)


def segment(kind: int, pts: float, data: bytes) -> bytes:
    ticks = round(pts * 90_000)
    return b"PG" + struct.pack(">IIBH", ticks, 0, kind, len(data)) + data


def composition(number: int, objects: int) -> bytes:
    data = struct.pack(">HHBHBBBB", WIDTH, HEIGHT, 0x10, number, 0x80 if objects else 0x00, 0, 0, objects)
    if objects:
        data += struct.pack(">HBBHH", 0, 0, 0, BOX_X, BOX_Y)
    return data


def window() -> bytes:
    return struct.pack(">BBHHHH", 1, 0, BOX_X, BOX_Y, BOX_W, BOX_H)


def palette() -> bytes:
    y, cr, cb = RED
    return struct.pack(">BB", 0, 0) + struct.pack(">BBBBB", 1, y, cr, cb, 255)


def bitmap() -> bytes:
    # Run-length encoded lines: 0x00, 0b11LLLLLL LLLLLLLL, colour = a long run of colour 1.
    run = struct.pack(">BHB", 0x00, 0xC000 | BOX_W, 1)
    rle = (run + b"\x00\x00") * BOX_H
    header = struct.pack(">HBB", 0, 0, 0xC0)
    length = len(rle) + 4
    return header + length.to_bytes(3, "big") + struct.pack(">HH", BOX_W, BOX_H) + rle


def main(out: Path) -> None:
    show, hide = 1.0, 30.0
    data = b"".join(
        [
            segment(0x16, show, composition(0, 1)),
            segment(0x17, show, window()),
            segment(0x14, show, palette()),
            segment(0x15, show, bitmap()),
            segment(0x80, show, b""),
            segment(0x16, hide, composition(1, 0)),
            segment(0x17, hide, window()),
            segment(0x80, hide, b""),
        ]
    )
    out.write_bytes(data)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "test/fixtures/media/subtitles.sup"))
