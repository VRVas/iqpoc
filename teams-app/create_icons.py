"""Generate Teams app icons: color.png (192x192) and outline.png (32x32)."""
import struct
import zlib
import os

def create_png(width, height, pixels):
    """Create a minimal PNG from RGBA pixel data."""
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc

    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter byte
        for x in range(width):
            raw += pixels[y][x]

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # 8bit RGBA
    idat = zlib.compress(raw)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')


def create_color_icon():
    """192x192 indigo square with white 'IQ' rendered as simple block letters."""
    W, H = 192, 192
    bg = struct.pack('BBBB', 99, 102, 241, 255)   # indigo
    fg = struct.pack('BBBB', 255, 255, 255, 255)   # white

    pixels = [[bg] * W for _ in range(H)]

    # Simple block letter "I" and "Q" centered
    # Letter area: roughly 120px wide, 80px tall, centered
    cx, cy = W // 2, H // 2
    lw = 8  # line width

    # "I" - vertical bar at x offset -30 from center
    ix = cx - 35
    for y in range(cy - 35, cy + 35):
        for x in range(ix - lw // 2, ix + lw // 2):
            if 0 <= x < W and 0 <= y < H:
                pixels[y][x] = fg
    # "I" serifs (top and bottom horizontal)
    for y in range(cy - 35, cy - 35 + lw):
        for x in range(ix - 18, ix + 18):
            if 0 <= x < W and 0 <= y < H:
                pixels[y][x] = fg
    for y in range(cy + 35 - lw, cy + 35):
        for x in range(ix - 18, ix + 18):
            if 0 <= x < W and 0 <= y < H:
                pixels[y][x] = fg

    # "Q" - circle + tail at x offset +25 from center
    qx = cx + 25
    r_outer = 34
    r_inner = 26
    for y in range(H):
        for x in range(W):
            dx, dy = x - qx, y - cy
            dist_sq = dx * dx + dy * dy
            if r_inner * r_inner <= dist_sq <= r_outer * r_outer:
                pixels[y][x] = fg

    # Q tail - diagonal line from bottom-right of circle
    for i in range(20):
        tx = qx + r_inner // 2 + i
        ty = cy + r_inner // 2 + i
        for dx in range(-lw // 2, lw // 2 + 1):
            for dy in range(-lw // 2, lw // 2 + 1):
                px, py = tx + dx, ty + dy
                if 0 <= px < W and 0 <= py < H:
                    pixels[py][px] = fg

    return create_png(W, H, pixels)


def create_outline_icon():
    """32x32 transparent background with white 'IQ' block letters."""
    W, H = 32, 32
    tr = struct.pack('BBBB', 0, 0, 0, 0)          # transparent
    fg = struct.pack('BBBB', 255, 255, 255, 255)   # white

    pixels = [[tr] * W for _ in range(H)]

    cx, cy = W // 2, H // 2
    lw = 2

    # "I" at x offset -5
    ix = cx - 6
    for y in range(cy - 7, cy + 7):
        for x in range(ix - lw // 2, ix + lw // 2):
            if 0 <= x < W and 0 <= y < H:
                pixels[y][x] = fg
    for y in range(cy - 7, cy - 7 + lw):
        for x in range(ix - 4, ix + 4):
            if 0 <= x < W and 0 <= y < H:
                pixels[y][x] = fg
    for y in range(cy + 7 - lw, cy + 7):
        for x in range(ix - 4, ix + 4):
            if 0 <= x < W and 0 <= y < H:
                pixels[y][x] = fg

    # "Q" circle at x offset +5
    qx = cx + 5
    r_outer = 7
    r_inner = 5
    for y in range(H):
        for x in range(W):
            dx, dy = x - qx, y - cy
            dist_sq = dx * dx + dy * dy
            if r_inner * r_inner <= dist_sq <= r_outer * r_outer:
                pixels[y][x] = fg

    # Q tail
    for i in range(4):
        tx = qx + 3 + i
        ty = cy + 3 + i
        for d in range(-1, 2):
            px, py = tx + d, ty
            if 0 <= px < W and 0 <= py < H:
                pixels[py][px] = fg

    return create_png(W, H, pixels)


if __name__ == '__main__':
    d = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(d, 'color.png'), 'wb') as f:
        f.write(create_color_icon())
    with open(os.path.join(d, 'outline.png'), 'wb') as f:
        f.write(create_outline_icon())
    print(f"Created color.png and outline.png in {d}")
