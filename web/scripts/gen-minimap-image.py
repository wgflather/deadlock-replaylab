"""
Repaint the game's minimap layers into the viewer's map art.

The minimap since the 2026-10 update is three layers, in the game's VPK under
panorama/images/minimap/base/, of which the game shows one at a time
(panorama/styles/hud_minimap.css): the streets normally, and while you are below them,
either the area under the middle (`is_underground`) or the tunnels (`in_tunnels`).
Extract all three to PNG first, e.g. with Source2Viewer-CLI:

    Source2Viewer-CLI -i ".../game/citadel/pak01_dir.vpk" -d -o out \\
        -f panorama/images/minimap/base/minimap_midtown_mid
    python scripts/gen-minimap-image.py out/panorama/images/minimap/base \\
        D:/map/minimap_midtown_mid_tunnels_psd.webp

The second argument is the area under the middle as it was before the update -- the
game no longer ships it; this copy is the one the deadlock.nyc viewer uses, and the four
pre-update replays we have put their heroes in its side rooms rather than the current
ones. It has the same make-up as the others, but over a uniform backdrop of alpha 89,
which is taken off, and its corridors carry a faint tint, so its walkable shapes are
found by how dark they are as well.

This writes:

  src/assets/map/minimap.webp                     the streets  (minimap_midtown_mid_psd)
  src/assets/map/minimap-underground.webp         under the middle  (..._mid_tunnels_psd)
  src/assets/map/minimap-tunnels.webp             the tunnels  (..._rat_tunnels_psd)
  src/assets/map/minimap-legacy-underground.webp  under the middle, before the update
  src/map/underground.ts                          where "under the middle" is walkable,
                                                  on both maps

Every layer is 1024px across the game's minimap bounds, +-MAP_RADIUS on both axes
(checked against hero positions from a real match: they follow its streets to the
pixel), and black, with the map carried by alpha.

The streets: about 180 to 240 on the streets, and nothing at all for the blocks between
them, which are holes in the layer just like the outside is. So the blocks are found as
those holes -- whatever alpha-0 region is not connected to the border -- and the whole
thing is painted the way the earlier art was (see src/map/index.ts): alpha read as a
height, ramped from #5a615a at 110 (a block) to #202420 at 205 (a street), the outer
silhouette feathered by blurring the "is this the city at all" mask by 4px, and the
result padded by MAP_IMAGE_MARGIN.

The two below-ground layers: the walkable shapes are near-opaque neutral greys, sitting
in a soft green-tinted halo -- the rock around them. They are painted in the same two
tones, walkable in the street tone and the halo in the block tone at its own alpha, so
"dark is where you can go" holds on all three.

Needs numpy, scipy and Pillow.
"""

import base64
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import binary_dilation, binary_fill_holes

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'src' / 'assets' / 'map'
MASK_MODULE = ROOT / 'src' / 'map' / 'underground.ts'

LAYERS = {
    'minimap_midtown_mid_psd.png': 'minimap.webp',
    'minimap_midtown_mid_tunnels_psd.png': 'minimap-underground.webp',
    'minimap_midtown_rat_tunnels_psd.png': 'minimap-tunnels.webp',
}

#: The layer's own size, and the padded size (MAP_IMAGE_MARGIN = 1080 / 1024).
SIZE = 1024
PADDED = 1080
#: Alpha below this is anti-aliasing noise, not map.
FLOOR = 40
#: The height a block is painted at, and the ramp's ends.
BLOCK, STREET = 110, 205
BLOCK_TONE = np.array([0x5A, 0x61, 0x5A], dtype=np.float32)
STREET_TONE = np.array([0x20, 0x24, 0x20], dtype=np.float32)
FEATHER = 4
#: Below ground, a walkable pixel is at least this opaque and no greener than it is red;
#: the halo around the shapes is tinted green.
SHAPE_ALPHA = 180
SHAPE_TINT = 3
#: The halo's strongest alpha in the output: rock, not a wall.
HALO_ALPHA = 200
#: The underground mask: one cell per this many layer pixels, grown by this many cells
#: so a hero on the edge of a room still counts as in it.
MASK_STEP = 4
MASK_GROW = 1


def load(path: Path) -> np.ndarray:
    layer = Image.open(path).convert('RGBA')
    if layer.size != (SIZE, SIZE):
        raise SystemExit(f'expected a {SIZE}px layer, got {layer.size} in {path.name}')
    return np.asarray(layer, dtype=np.float32)


def save(rgba: np.ndarray, name: str):
    out = Image.new('RGBA', (PADDED, PADDED), (0, 0, 0, 0))
    pad = (PADDED - SIZE) // 2
    out.paste(Image.fromarray(rgba.round().astype(np.uint8), 'RGBA'), (pad, pad))
    path = ASSETS / name
    out.save(path, 'WEBP', lossless=True, method=6)
    print(f'wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)')


def streets(layer: np.ndarray) -> np.ndarray:
    alpha = layer[..., 3]
    city = binary_fill_holes(alpha >= FLOOR)
    height = np.where(city, np.maximum(alpha, BLOCK), 0)
    t = np.clip((height - BLOCK) / (STREET - BLOCK), 0, 1)[..., None]
    rgb = BLOCK_TONE + (STREET_TONE - BLOCK_TONE) * t
    mask = Image.fromarray((city * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(FEATHER))
    return np.dstack([rgb, np.asarray(mask, dtype=np.float32)])


def walkable(layer: np.ndarray) -> np.ndarray:
    tint = layer[..., 1] - layer[..., 0]
    shape = (layer[..., 3] >= SHAPE_ALPHA) & (tint <= SHAPE_TINT)
    # Close the one-pixel nicks the tint test leaves along a shape's outline.
    img = Image.fromarray((shape * 255).astype(np.uint8))
    return np.asarray(img.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))) > 0


def below_ground(layer: np.ndarray) -> np.ndarray:
    shape = walkable(layer)
    rgb = np.where(shape[..., None], STREET_TONE, BLOCK_TONE)
    alpha = np.where(shape, 255, layer[..., 3] / 255 * HALO_ALPHA)
    return np.dstack([rgb, alpha])


#: The pre-update copy's backdrop alpha, and how dark (on white) its walkable shapes are.
LEGACY_BACKDROP = 89
LEGACY_SHAPE_LUMA = 75


def legacy_shape(layer: np.ndarray) -> np.ndarray:
    # Dark enough (the tinted corridors), or the current layers' own test -- near-opaque
    # neutral grey -- for the lighter floors such as the pit's. The halo is neither.
    alpha = layer[..., 3:4] / 255
    on_white = layer[..., :3] * alpha + 255 * (1 - alpha)
    return (on_white.mean(axis=-1) < LEGACY_SHAPE_LUMA) | walkable(layer)


def legacy_below_ground(layer: np.ndarray) -> np.ndarray:
    shape = legacy_shape(layer)
    halo = np.clip((layer[..., 3] - LEGACY_BACKDROP) / (255 - LEGACY_BACKDROP), 0, 1)
    rgb = np.where(shape[..., None], STREET_TONE, BLOCK_TONE)
    alpha = np.where(shape, 255, halo * HALO_ALPHA)
    return np.dstack([rgb, alpha])


def mask_of(shape: np.ndarray) -> tuple[str, int]:
    cells = SIZE // MASK_STEP
    grid = shape.reshape(cells, MASK_STEP, cells, MASK_STEP).any(axis=(1, 3))
    grid = binary_dilation(grid, iterations=MASK_GROW)
    return base64.b64encode(np.packbits(grid.astype(np.uint8)).tobytes()).decode(), int(grid.sum())


def write_masks(current: np.ndarray, legacy: np.ndarray):
    cells = SIZE // MASK_STEP
    packed, n = mask_of(current)
    legacy_packed, legacy_n = mask_of(legacy)
    MASK_MODULE.write_text(
        f"""/**
 * Where the area under the middle of the map is walkable -- the game's
 * `is_underground` minimap layer -- on the current map and on the one before the
 * 2026-10 update. Generated by scripts/gen-minimap-image.py; do not edit.
 *
 * {cells} x {cells} cells over the minimap bounds (+-MAP_RADIUS), row by row from the
 * top (north), one bit per cell, most significant first.
 */
export const UNDERGROUND_CELLS = {cells}
export const UNDERGROUND_MASK = '{packed}'
export const LEGACY_UNDERGROUND_MASK = '{legacy_packed}'
""",
        encoding='utf-8',
    )
    print(f'wrote {MASK_MODULE.relative_to(ROOT)} ({n} and {legacy_n} of {cells * cells} cells)')


def main(source: Path, legacy_source: Path):
    current_mask = None
    for name, out in LAYERS.items():
        layer = load(source / name)
        save(streets(layer) if out == 'minimap.webp' else below_ground(layer), out)
        if out == 'minimap-underground.webp':
            current_mask = walkable(layer)
    legacy = load(legacy_source)
    save(legacy_below_ground(legacy), 'minimap-legacy-underground.webp')
    write_masks(current_mask, legacy_shape(legacy))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
