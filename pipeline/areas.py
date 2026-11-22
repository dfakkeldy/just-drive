"""Area registry for the terrain pipeline. Bounds use EPSG:2961 metres.

L5 ranges are half open: (i0, j0, i1, j1). Paths are relative to the invoked
checkout, deliberately without resolving pipeline/tools symlinks in proof roots.
"""
from dataclasses import dataclass
from functools import cached_property
import json
import os
import sys
from pathlib import Path

# Python resolves sys.path[0] through a symlink directory. Use the invoked
# pipeline entry point for its root, even if this import came from the real path.
ENTRY = Path(os.path.abspath(getattr(sys.modules.get('__main__'), '__file__', __file__)))
ROOT = ENTRY.parent.parent if ENTRY.parent.name == 'pipeline' else Path(os.path.abspath(__file__)).parent.parent


@dataclass(frozen=True)
class Area:
    id: str
    name: str
    origin: tuple
    mid_tiles: tuple
    anchor: tuple
    fetch_box: tuple
    fine_half: int = 1536
    route: tuple | None = None  # None: every public road and the rail trail
    extra_corridor: tuple = ()  # with route None: named tracks and dry-weather roads that also get 1 m land
    # Unnamed provincial lines that are really public roads: ((east, north) on the line, name, kind).
    # Applied after ids are given, so no other road's id moves.
    renamed_roads: tuple = ()
    # Roads that are public for driving but stay, for the invented roadside props, the driveway that the provincial
    # file calls them: one (east, north) on each line. Step 29 sees such a road as kind 4: no box and no pole stands
    # on it, and a house beside it gets its box on the next public road.
    props_driveways: tuple = ()
    # Hand-built house sites, as (east, north, radius in metres): no roadside box for the hand-built house site.
    # A house inside the radius gets no mailbox, and step 29 stops if any box stands inside.
    no_box_sites: tuple = ()
    # Named kind-4 road pieces that step 29 gives no pole run, when a drive showed no power line along them:
    # ((east, north) on the piece's line, its expected name). Other pieces with the same name keep the usual rule.
    # Public roads keep their frozen poles (tools/power-network/README.md); only the kind-4 extension is left out.
    unpowered_tracks: tuple = ()
    extra_fine: tuple = ()  # boxes (xmin, ymin, xmax, ymax) that get 1 m land whatever roads they hold
    fine_tile_limit: int = 1500  # guard: most 256 m tiles of 1 m land that one bake may select
    # Boxes (xmin, ymin, xmax, ymax) round hand-built places beside a road. Only the optional road-shaped ground
    # (road_ground.py) reads them: inside one no road point moves and no ground changes.
    keep_roads: tuple = ()
    highways: tuple = (19,)
    washboard: tuple = ()
    landmarks: tuple = ()
    community_sites: tuple = ()
    observed_styles: str | None = None
    comparison_centres: tuple = ()
    village_half: tuple = (700, 550)
    mailbox_exclusion_radius: int = 550
    require_farm_sample: bool = False
    require_forest_samples: bool = False
    # Existing lossless Mabou fetch. New areas use tightly cropped source-grid strips.
    elevation_window: tuple | None = None
    wide_source: str | None = None
    style_seed: str = 'area-styles-v1'
    legacy_manifest: bool = False
    provincial_sheets: tuple = ()
    anchor_highway: int | None = None
    exclude_utility_trees: bool = False
    interpolate_coastal_trail: bool = False
    avoid_wing_overlaps: bool = False
    # Large mapped buildings (malls, mills, schools, tanks) as blocks with their own heights (big_buildings.py).
    # Off until an area's data go: the size gate of 27_bake_buildings.py drops them, as before, so a bake of step 27
    # by another task does not add them. The bake that adds them sets MMM_BIG_BUILDINGS=1 for step 27 and its check
    # (steps 29 and 30 read "shape" in the data, not the variable), and only after tools/check-big.sh passes on the
    # rehearsed land (no block in a hand-built site of the game).
    # Turn an area's switch on in the same change as that area's data go, so code and data change together. Until
    # then the bake stops when a land has large buildings and the variable is not set (guard_big).
    big_buildings: bool = False
    # Points (east, north) inside mapped outlines that a hand-built site of the game replaces: left out of the above.
    big_buildings_skip: tuple = ()

    @property
    def raw(self):
        return ROOT / ('data/raw' if self.id == 'mabou' else f'data/raw/areas/{self.id}')

    @property
    def output(self):
        return ROOT / ('data/baked/terrain' if self.id == 'mabou' else f'data/baked/areas/{self.id}')

    @property
    def overview(self):
        return ROOT / ('data/work/overview' if self.id == 'mabou' else f'data/work/overview/{self.id}')

    @property
    def mid(self):
        i0, j0, i1, j1 = self.mid_tiles
        x0, y1 = self.origin
        return (float(x0 + i0 * 2048), float(y1 - j1 * 2048),
                float(x0 + i1 * 2048), float(y1 - j0 * 2048))

    def elevation(self, kind):
        name = f'north-loop-{kind}-1m-epsg3979.tif' if self.elevation_window else f'land-{kind}-1m-epsg3979.vrt'
        return self.raw / 'elevation' / name

    def wide(self, kind):
        owner = AREAS[self.wide_source] if self.wide_source else self
        if owner.origin != self.origin:
            raise ValueError('Shared wide rasters require the same quadtree root')
        return owner.raw / 'elevation' / f'wide-{kind}-16m-utm20.tif'

    def bake_wide(self, kind):
        """Derived input belongs to this bake, never to the source downloader."""
        if self.interpolate_coastal_trail:
            return self.raw / 'elevation' / f'wide-{kind}-16m-utm20-interpolated.vrt'
        return self.wide(kind)

    @cached_property
    def bake_anchor(self):
        """Snap a configured search point to its highway's provincial centreline.

        Fetch/dry-run needs no vectors. A bake that needs snapping requires the
        fetched network and fails clearly rather than using an unsnapped point.
        """
        if self.anchor_highway is None:
            return self.anchor
        from osgeo import ogr, osr
        src, dst = osr.SpatialReference(), osr.SpatialReference()
        src.ImportFromEPSG(4326); dst.ImportFromEPSG(2961)
        for srs in (src, dst):
            srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        tr = osr.CoordinateTransformation(src, dst)
        path = self.raw / 'vectors/BASE_NSTDB_10k_Roads_WM84__05_bridges.geojson'
        if not path.is_file():
            raise RuntimeError(f'Fetch vectors before snapping the anchor: {path}')
        best = None
        for feature in json.loads(path.read_text())['features']:
            if feature['properties'].get('RTE_NO') != self.anchor_highway or not feature.get('geometry'):
                continue
            geom = ogr.CreateGeometryFromJson(json.dumps(feature['geometry']))
            geom.Transform(tr)
            parts = [geom] if geom.GetGeometryName() == 'LINESTRING' else list(geom)
            for part in parts:
                pts = part.GetPoints()
                for a, b in zip(pts, pts[1:]):
                    dx, dy = b[0]-a[0], b[1]-a[1]
                    length2 = dx*dx+dy*dy
                    if not length2:
                        continue
                    t = max(0, min(1, ((self.anchor[0]-a[0])*dx+(self.anchor[1]-a[1])*dy)/length2))
                    x, y = a[0]+t*dx, a[1]+t*dy
                    hit = ((x-self.anchor[0])**2+(y-self.anchor[1])**2, x, y)
                    if best is None or hit < best:
                        best = hit
        if best is None:
            raise RuntimeError(f'No Highway {self.anchor_highway} near the anchor in the fetched network')
        return (round(best[1], 3), round(best[2], 3))

    def corridor_road(self, road):
        if self.route is not None:
            return road['kind'] == 5 or road['name'] in self.route
        return road['kind'] in (1, 2, 3, 5) or road['name'] in self.extra_corridor

    def in_village(self, x, y):
        return abs(x - self.bake_anchor[0]) < self.village_half[0] and abs(y - self.bake_anchor[1]) < self.village_half[1]


MABOU = Area(
    id='mabou', name='Mabou', origin=(591500, 5136100), mid_tiles=(12, 12, 20, 20),
    anchor=(624271, 5103301), fetch_box=(-61.52, 45.99, -61.28, 46.16),
    route=('Highway 19', 'Highway 252', 'Rankinville Road', 'Murphys Hill Road',
           'Smithville Road', 'Glenora Falls Road', 'Mabou Harbour Road',
           'Northeast Mabou Road', 'MacDonald Glen Road', 'Mabou Mines Road',
           'Mountain Road', 'Maple Street', 'Birch Street', 'Meadow Road',
           'Murray Hill Road', 'Beaton Road', 'MacKillop Road', 'MacLeods Road',
           'Southwest Ridge Road', 'Mull River Road'),
    highways=(19, 252), washboard=('Mabou Mines Road', 'Mabou Mines Branch'),
    keep_roads=(
        (620387, 5099072, 621014, 5099688),   # the works yard on Highway 19 (the box of web/src/yard-site.ts)
        (618830, 5109090, 619130, 5109450),   # the roadside scene on Mabou Mines Road (web/src/road-scene.ts)
        (618580, 5104650, 618860, 5105150),   # the wharf at Mabou Harbour and its lane (web/src/fishing-site.ts)
        (618480, 5110050, 618960, 5110560),   # the wharf at Mabou Coal Mines, Finlay Point (web/src/coast-site.ts)
        (619300, 5110480, 619640, 5110780),   # the mine at the end of Mabou Mines Road (web/src/mine-site.ts)
        (625884, 5100827, 625943, 5100885)),  # porch-site: a hand-built house at the end of Beaton Road, placed on its surveyed building record
    landmarks=(('Mabou church', 624151.0, 5103406.0, 60.0),),
    community_sites=(
        # Post office building: two cabinets in the 12 and 13 Nov dash cam (the project brief); the place is unchanged.
        dict(point=(624452.9, 5103395.2), road='Highway 19', toward='same', modules=2),
        dict(point=(631521.0, 5101180.2), road='Highway 252', toward='across'),
        dict(point=(627079.3, 5103643.5), road='Smithville Road', toward='same'),
        # Grocery store: back flat on its east end wall at the south corner, doors facing east (the project brief brief:
        # wall normal 70.0 degrees, pad back 5 cm off the wall). `flush` keeps the step-out from pushing it into the lot.
        dict(exact=(624896.85, 5103595.12), heading=70.0, modules=4, flush=True),
        dict(exact=(619316.7, 5104955.3), heading=60.0, modules=3),
        dict(point=(623789.1, 5103515.2), road='Birch Street', toward='same')),
    observed_styles='pipeline/observed_styles.json',
    comparison_centres=((624271, 5103301), (623100, 5104200), (626000, 5104000)),
    require_farm_sample=True, require_forest_samples=True,
    elevation_window=(2497700, 338800, 2523700, 364900), style_seed='mabou-styles-v1',
    legacy_manifest=True, provincial_sheets=('1046000061300', '1046000061400', '1046050061300',
        '1046050061400', '1046100061300', '1046100061400'))

# Boxes agreed with Dan on 11 Nov 2026 (level-5 tile ranges on Mabou's lattice, half open).
JUDIQUE = Area(
    # East to i 20 so that River Denys Road reaches the church on River Denys Mountain; south to j 32 so that the
    # dividing line Dan marked on Highway 19 at Craigmore (about N 5071700) is inside, with overlap (11 Nov 2026).
    observed_styles='pipeline/observed_styles_judique.json',
    id='judique', name='Judique', origin=MABOU.origin, mid_tiles=(11, 24, 20, 32),
    # Snap the community-centre search point after vectors have been fetched.
    anchor=(617136, 5081421), fetch_box=(-61.539, 45.772, -61.283, 45.931),
    extra_corridor=('River Denys Road', 'River Denys Mountain Road', 'General Line Road'),
    keep_roads=(
        (618538, 5074301, 618791, 5074525),   # the house by the brook (web/src/home-site.ts)
        (630690, 5080545, 630944, 5080752)),  # the church on River Denys Mountain and its start point (web/src/church-site.ts)
    # The provincial file calls this gravel public road a driveway. The 2018 plan of survey names it (Dan, 11 Nov 2026).
    renamed_roads=(((618553.0, 5074368.5), 'Old Chisholm Mill Road', 3),),
    props_driveways=((618553.0, 5074368.5),),
    no_box_sites=((618687.3, 5074423.9, 150),),   # the origin of the hand-built house site (web/src/home-site.ts)
    # The dash cam drive of 21 Nov 2026 saw the line end at the last house with power, near the start of
    # River Denys Road's public piece. No pole stands along its kind-4 piece to the church, and the church has
    # no power (Dan, 21 Nov 2026). The public piece keeps its frozen poles.
    # The point is a vertex of that kind-4 piece in the baked roads. The other kind-4 pieces of the same name are a
    # 12 m bridge (never poled) and a piece beyond the church that the drive did not reach (no building near it).
    unpowered_tracks=(((629728.21, 5080744.94), 'River Denys Road'),),
    wide_source='mabou', anchor_highway=19)

PORTHOOD = Area(
    observed_styles='pipeline/observed_styles_porthood.json',
    id='porthood', name='Port Hood', origin=MABOU.origin, mid_tiles=(8, 16, 14, 24),
    anchor=(613722, 5096896), fetch_box=(-61.615, 45.921, -61.439, 46.080),
    wide_source='mabou', anchor_highway=19)

POINTTUPPER = Area(
    observed_styles='pipeline/observed_styles_pointtupper.json',
    id='pointtupper', name='Point Tupper and Port Hawkesbury', origin=(591500, 5103332), mid_tiles=(14, 22, 20, 28),
    anchor=(627529, 5051762), fetch_box=(-61.468104, 45.54932, -61.291694, 45.673129),
    highways=(4, 19, 104, 105, 344), anchor_highway=4, exclude_utility_trees=True,
    # The large stores, plaza, civic centre, schools, college and tanks of Port Hawkesbury and Point Tupper
    # (the project brief). On together with that land delta (tools/point-tupper-delta/), which the main thread installs.
    big_buildings=True)

# One area round the whole bay (Dan, 11 Nov 2026: "whole bay"): West Bay village, Dundee, Lime Hill, Marble Mountain
# and the old gypsum quarry at Sugar Camp. It shares the Strait origin and its coarse far land.
WESTBAY = Area(
    # West Bay: rates pooled from filmed rural areas (Judique, Port Hood, Mabou); no West Bay observation.
    # Separate area slot allows later correction. Replace it when daylight observations become available.
    observed_styles='pipeline/observed_styles_westbay.json',
    id='westbay', name='West Bay', origin=POINTTUPPER.origin, mid_tiles=(18, 12, 31, 22),
    anchor=(642342, 5063327), fetch_box=(-61.359, 45.656, -60.997, 45.855),
    highways=(4, 104, 105), wide_source='pointtupper',
    extra_corridor=('Long Stretch Road',),
    fine_tile_limit=2200,  # twice Judique's land: 2,042 tiles on the first bake
    # The quarry and its entrance; the shore lane north of the village that Dan asked to see well.
    extra_fine=((630200, 5061400, 633200, 5066500), (643600, 5067500, 644500, 5068350)),
    # The quarry and its entrance: another thread builds there. (The last line of an area stays a bare `)`:
    # tools/start-here-check.mjs reads each area up to it.)
    keep_roads=((630200, 5061400, 633200, 5066500),))

CANSOCAUSEWAY = Area(
    observed_styles='pipeline/observed_styles_cansocauseway.json',
    id='cansocauseway', name='Canso Causeway and Troy', origin=(591500, 5103332), mid_tiles=(12, 15, 17, 24),
    anchor=(623581, 5056272), fetch_box=(-61.518623, 45.624174, -61.366785, 45.802815),
    highways=(4, 19, 104, 105, 344), anchor_highway=19, wide_source='pointtupper', exclude_utility_trees=True,
    interpolate_coastal_trail=True, avoid_wing_overlaps=True)

AREAS = {area.id: area for area in (MABOU, JUDIQUE, PORTHOOD, POINTTUPPER, WESTBAY, CANSOCAUSEWAY)}


def current():
    key = os.environ.get('MMM_AREA', 'mabou')
    if key not in AREAS:
        raise ValueError(f'Unknown MMM_AREA {key!r}; choose one of {", ".join(AREAS)}')
    return AREAS[key]


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--paths', action='store_true', required=True,
                        help='Print resolved paths without reading raw data or writing any output')
    parser.parse_args()
    # Numbered scripts import this module. A __main__-only probe misses Python's
    # sys.path[0] symlink resolution, so exercise that separate import here too.
    import areas as registry
    selected = registry.current()
    print(json.dumps(dict(root=str(registry.ROOT), area=selected.id, raw=str(selected.raw),
                         output=str(selected.output), overview=str(selected.overview))))
