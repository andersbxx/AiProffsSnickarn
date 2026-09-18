import math
import struct
import zlib


def new_canvas(size):
    return [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]


def set_px(c, x, y, color):
    if 0 <= x < len(c) and 0 <= y < len(c):
        c[y][x] = color


def blend(dst, src):
    sa = src[3] / 255.0
    if sa <= 0:
        return dst
    da = dst[3] / 255.0
    if da <= 0:
        return src
    a = sa + da * (1 - sa)
    r = (src[0] * sa + dst[0] * da * (1 - sa)) / a
    g = (src[1] * sa + dst[1] * da * (1 - sa)) / a
    b = (src[2] * sa + dst[2] * da * (1 - sa)) / a
    return (int(r), int(g), int(b), int(a * 255))


def stroke_segment(c, x0, y0, x1, y1, thickness, color):
    half = thickness / 2.0
    t = (y1 - y0, x0 - x1)
    dlen = math.hypot(*t)
    if dlen == 0:
        return
    n = (t[0] / dlen, t[1] / dlen)
    lo_x, hi_x = int(min(x0, x1) - half), int(max(x0, x1) + half)
    lo_y, hi_y = int(min(y0, y1) - half), int(max(y0, y1) + half)
    seg = (x1 - x0, y1 - y0)
    seglen2 = seg[0] ** 2 + seg[1] ** 2
    for y in range(max(0, lo_y), min(len(c), hi_y + 1)):
        for x in range(max(0, lo_x), min(len(c), hi_x + 1)):
            v = (x - x0, y - y0)
            proj = (v[0] * seg[0] + v[1] * seg[1]) / seglen2 if seglen2 else 0
            proj = max(0.0, min(1.0, proj))
            nx, ny = v[0] - proj * seg[0], v[1] - proj * seg[1]
            if math.hypot(nx, ny) <= half:
                c[y][x] = blend(c[y][x], color)


def rounded_square(c, margin, radius, color):
    size = len(c)
    radius = max(1, int(radius))
    for y in range(size):
        for x in range(size):
            if x < margin or x >= size - margin or y < margin or y >= size - margin:
                continue
            dx = max(margin + radius - x, x - (size - 1 - margin - radius), 0)
            dy = max(margin + radius - y, y - (size - 1 - margin - radius), 0)
            if dx * dx + dy * dy <= radius * radius:
                c[y][x] = blend(c[y][x], color)


def render(size, path):
    S = size
    c = new_canvas(S)
    m = int(S * 0.06)
    rounded_square(c, m, int(S * 0.16), (23, 27, 34, 255))

    white = (245, 246, 248, 255)
    blue = (59, 130, 246, 255)
    t = max(6, int(S * 0.075))

    # ">" chevron: two diagonal bars meeting on the right edge of the box
    apex = int(S * 0.60)
    top_start_y = int(S * 0.24)
    mid_y = int(S * 0.50)
    left_x = int(S * 0.28)
    stroke_segment(c, left_x, top_start_y, apex, mid_y, t, white)
    stroke_segment(c, left_x, int(S * 0.76), apex, mid_y, t, white)

    # "_" underscore under left bar
    stroke_segment(c, int(S * 0.24), int(S * 0.80), int(S * 0.52), int(S * 0.80), t, blue)

    write_png(c, path)


def write_png(c, path):
    size = len(c)
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            r, g, b, a = c[y][x]
            rows += bytes((r, g, b, a))
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(rows), 9)))
        f.write(chunk(b"IEND", b""))


render(192, "/home/anders/AiProffsSnickarn/icon-192.png")
render(512, "/home/anders/AiProffsSnickarn/icon-512.png")
print("icons written")