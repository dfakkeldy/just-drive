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
    # Repo-relative JSON files holding EPSG:2961 polygon rings (`ring` key) where no roadside mailbox may stand
    # (for example, a town with post-office pickup only). Any placed box whose position falls inside is dropped,
    # and step 29 stops if any box stands inside.
    no_mailbox_polygons: tuple = ()
    # Named kind-4 road pieces that step 29 gives no pole run, when a drive showed no power line along them:
    # ((east, north) on the piece's line, its expected name). Other pieces with the same name keep the usual rule.
    # Public roads keep their frozen poles (tools/power-network/README.md), apart from public_pole_corrections; only
    # the kind-4 extension is left out.
    unpowered_tracks: tuple = ()
    # The one exception to the frozen public-pole pass (tools/power-network/README.md), where a drive filmed the real
    # line: ((east, north) on the public road's line, its expected name, its kind, rules). Each rule is
    # (s0, s1, 'left' | 'right' | 'none') on [s0, s1) metres from the road's first point (s1 None: to its end). Left
    # and right are seen looking along the road from that point. A pole in a 'none' stretch is removed; a pole on the
    # wrong side moves straight across to the other side; any other pole keeps its frozen bytes.
    public_pole_corrections: tuple = ()
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
        dict(point=(623789.1, 5103515.2), road='Birch Street', toward='same'),
        # Little Mabou Hall (20 Nov dash cam): four units on Little Mabou Road, 6 m SE of 620347, 5102381 to clear the
        # transformer pole at 620350.8, 5102383.2.
        dict(point=(620351.0, 5102377.5), road='Little Mabou Road', toward='same', modules=4)),
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
    # no power (Dan, 21 Nov 2026).
    # The point is a vertex of that kind-4 piece in the baked roads. The other kind-4 pieces of the same name are a
    # 12 m bridge (never poled) and a piece beyond the church that the drive did not reach (no building near it).
    unpowered_tracks=(((629728.21, 5080744.94), 'River Denys Road'),),
    # River Denys Road's public piece (game road 98, from its end at the paved piece): where the 21 Nov 2026 dash cam
    # saw the line, both ways. Right is the south side, left the north side. The line leaves the road through the
    # woods at 1975-2340 m and 2560-2745 m. It ends at a bend about 2.78 km along: a transformer pole on the left, then
    # the last pole on the right, by the last house with power. The game's nearest frozen pole for that last pole
    # stands at 2815 m, 30-40 m on, beside that house's game twin, so it stays and feeds the house. No pole stands
    # after it (tools/power-network/README.md). The point is a vertex of that piece.
    public_pole_corrections=(((623149.01, 5079712.61), 'River Denys Road', 3, (
        (0, 612, 'right'), (612, 1100, 'left'), (1100, 1160, 'right'), (1160, 1530, 'left'), (1530, 1975, 'right'),
        (1975, 2340, 'none'), (2340, 2560, 'right'), (2560, 2745, 'none'), (2745, 2790, 'left'),
        (2790, 2840, 'right'), (2840, None, 'none'))),),
    # The community mailbox bank in the gravel lot at the Keltic Drive / Highway 19 corner (10 units, owner-counted
    # 17 Nov) is built by hand in web/src/judique-village-site.ts (VILLAGE_ITEMS.mailboxes at 617095.0, 5081493.0)
    # and lies inside the 550 m village mailbox exclusion radius, so community_sites stays empty here.
    wide_source='mabou', anchor_highway=19)

PORTHOOD = Area(
    observed_styles='pipeline/observed_styles_porthood.json',
    id='porthood', name='Port Hood', origin=MABOU.origin, mid_tiles=(8, 16, 14, 24),
    anchor=(613722, 5096896), fetch_box=(-61.615, 45.921, -61.439, 46.080),
    wide_source='mabou', anchor_highway=19,
    # The school, the arena and one more hall (3 buildings, 11 blocks). On together with that land delta (grok-bots#1341).
    big_buildings=True,
    keep_roads=(
        (617248, 5088761, 617310, 5088841),   # the Maryville tractor dealership (web/src/maryville-store-site.ts)
        (614458, 5096360, 614496, 5096396),   # the Dunmore shop (web/src/november-buildings.ts)
        (614135, 5090427, 614348, 5090516),   # Little Judique Harbour wharf (web/src/wharves.ts, web/src/wharf-source.ts)
        (612554, 5098084, 612701, 5098211),   # Murphys Pond wharf (web/src/wharves.ts, web/src/wharf-source.ts)
        (611639, 5096704, 611722, 5096797),   # Port Hood Island wharf (web/src/wharves.ts, web/src/wharf-source.ts)
        (614135, 5088331, 614244, 5088429),   # Little Judique Ponds wharf (web/src/wharves.ts, web/src/wharf-source.ts)
        (612649, 5097944, 612672, 5097968),   # harbour light 876.8 (web/src/harbour-lights-data.ts)
        (608449, 5092444, 608475, 5092469),   # harbour light 881 (web/src/harbour-lights-data.ts)
        (614020, 5090510, 614044, 5090534),   # harbour light 881.1 (web/src/harbour-lights-data.ts)
    ),
    community_sites=(
        # Little Mabou Road junction (20 Nov dash cam; units not counted).
        dict(point=(613341.0, 5098861.0), road='Little Mabou Road', toward='same'),
    ),
)

POINTTUPPER = Area(
    observed_styles='pipeline/observed_styles_pointtupper.json',
    id='pointtupper', name='Point Tupper and Port Hawkesbury', origin=(591500, 5103332), mid_tiles=(14, 22, 20, 28),
    anchor=(627529, 5051762), fetch_box=(-61.468104, 45.54932, -61.291694, 45.673129),
    highways=(4, 19, 104, 105, 344), anchor_highway=4, exclude_utility_trees=True,
    # Town of Port Hawkesbury legal municipal limits: no roadside mailboxes; residents pick up mail at the post office.
    no_mailbox_polygons=('web/src/port-hawkesbury-boundary.json',),
    # The large stores, plaza, civic centre, schools, college and tanks of Port Hawkesbury and Point Tupper
    # (the project brief). On together with that land delta (tools/point-tupper-delta/), which the main thread installs.
    big_buildings=True,
    # Nearby infrastructure shares a box where the surveyed footprints are close.
    # Leave 10 m outside each reservation before road shaping can start to return.
    keep_roads=(
        (628177, 5052529, 628351, 5052698),   # Port Hawkesbury Reeves Street (web/src/port-hawkesbury-site.ts)
        (628296, 5052590, 628567, 5052802),   # Port Hawkesbury plaza (web/src/port-hawkesbury-site.ts)
        (629802, 5052877, 630146, 5053089),   # Port Hawkesbury north dealer and gas bar (web/src/port-hawkesbury-site.ts)
        (629750, 5052697, 630134, 5052971),   # Port Hawkesbury south dealer (web/src/port-hawkesbury-site.ts)
        (628167, 5052120, 628242, 5052199),   # Port Hawkesbury garage (web/src/port-hawkesbury-site.ts)
        (626270, 5057110, 627930, 5057450),   # the airport (web/src/airport-site.ts)
        (628103, 5052706, 628194, 5052796),   # reeves-pitt signals (web/src/traffic-signals.ts, web/src/traffic-signal-rules.ts)
        (628456, 5052528, 628553, 5052626),   # reeves-reynolds signals (web/src/traffic-signals.ts, web/src/traffic-signal-rules.ts)
        (628994, 5052216, 629082, 5052306),   # reeves-trunk4 signals (web/src/traffic-signals.ts, web/src/traffic-signal-rules.ts)
        (629744, 5052936, 629845, 5053035),   # paint-tamarac-trunk4 signals (web/src/traffic-signals.ts, web/src/traffic-signal-rules.ts)
        (623579, 5056016, 623776, 5056199),   # the causeway crossing and canal (web/src/canal.ts, web/src/canal-route.ts)
        (627333, 5052368, 627517, 5052558),   # Port Hawkesbury waterfront wharf (web/src/wharves.ts, web/src/wharf-source.ts)
        (621891, 5056144, 621967, 5056203),   # Aulds Cove wharf (web/src/wharves.ts, web/src/wharf-source.ts)
        (628357, 5047614, 628381, 5047637),   # harbour light 694.4 (web/src/harbour-lights-data.ts)
        (628210, 5047713, 628233, 5047736),   # harbour light 694.5 (web/src/harbour-lights-data.ts)
        (624204, 5054541, 624227, 5054565),   # harbour light 698 (web/src/harbour-lights-data.ts)
        (623374, 5056297, 623397, 5056320),   # harbour light 701 (web/src/harbour-lights-data.ts)
        (623541, 5056155, 623565, 5056179),   # harbour light 702 (web/src/harbour-lights-data.ts)
        (620640, 5052573, 620722, 5052651),   # dam (web/src/pt-infrastructure-source.ts)
        (620706, 5054970, 620741, 5054995),   # culvert (web/src/pt-infrastructure-source.ts)
        (620817, 5056276, 620849, 5056302),   # culvert (web/src/pt-infrastructure-source.ts)
        (621032, 5052315, 621069, 5052378),   # dam (web/src/pt-infrastructure-source.ts)
        (621108, 5052128, 621428, 5052307),   # dam (web/src/pt-infrastructure-source.ts)
        (621279, 5053576, 621325, 5053626),   # culvert (web/src/pt-infrastructure-source.ts)
        (621407, 5054459, 621436, 5054558),   # dam (web/src/pt-infrastructure-source.ts)
        (621515, 5057016, 621540, 5057038),   # gate (web/src/pt-infrastructure-source.ts)
        (621528, 5052368, 621555, 5052390),   # culvert (web/src/pt-infrastructure-source.ts)
        (621643, 5051320, 621674, 5051351),   # culvert (web/src/pt-infrastructure-source.ts)
        (621780, 5054610, 621839, 5054652),   # dam (web/src/pt-infrastructure-source.ts)
        (622010, 5055739, 622035, 5055761),   # gate (web/src/pt-infrastructure-source.ts)
        (622020, 5051422, 622047, 5051451),   # culvert (web/src/pt-infrastructure-source.ts)
        (622276, 5055196, 622329, 5055261),   # fence (web/src/pt-infrastructure-source.ts)
        (622282, 5054681, 622308, 5054702),   # gate (web/src/pt-infrastructure-source.ts)
        (622285, 5046750, 622324, 5046780),   # culvert (web/src/pt-infrastructure-source.ts)
        (622333, 5053411, 622357, 5053454),   # culvert (web/src/pt-infrastructure-source.ts)
        (622981, 5047328, 623021, 5047359),   # culvert (web/src/pt-infrastructure-source.ts)
        (623012, 5052138, 623042, 5052167),   # culvert (web/src/pt-infrastructure-source.ts)
        (623035, 5054398, 623132, 5054439),   # conveyor (web/src/pt-infrastructure-source.ts)
        (623150, 5055116, 623578, 5055235),   # conveyor (web/src/pt-infrastructure-source.ts)
        (623159, 5054261, 623297, 5055065),   # conveyor (web/src/pt-infrastructure-source.ts)
        (623271, 5055260, 623318, 5055323),   # conveyor (web/src/pt-infrastructure-source.ts)
        (623274, 5054413, 623394, 5054443),   # conveyor (web/src/pt-infrastructure-source.ts)
        (623464, 5047565, 623493, 5047594),   # culvert (web/src/pt-infrastructure-source.ts)
        (623530, 5047399, 623564, 5047425),   # culvert (web/src/pt-infrastructure-source.ts)
        (623693, 5058198, 623722, 5058221),   # culvert (web/src/pt-infrastructure-source.ts)
        (623916, 5050655, 623965, 5050731),   # fence (web/src/pt-infrastructure-source.ts)
        (623917, 5051750, 623944, 5051776),   # culvert (web/src/pt-infrastructure-source.ts)
        (624048, 5053139, 624083, 5053164),   # culvert (web/src/pt-infrastructure-source.ts)
        (624119, 5052556, 624144, 5052577),   # gate (web/src/pt-infrastructure-source.ts)
        (624141, 5053112, 624173, 5053137),   # culvert (web/src/pt-infrastructure-source.ts)
        (624146, 5056656, 624171, 5056677),   # gate (web/src/pt-infrastructure-source.ts)
        (624183, 5053095, 624217, 5053121),   # culvert (web/src/pt-infrastructure-source.ts)
        (624242, 5053078, 624271, 5053104),   # culvert (web/src/pt-infrastructure-source.ts)
        (624248, 5051814, 624285, 5051837),   # culvert (web/src/pt-infrastructure-source.ts)
        (624279, 5057037, 624307, 5057075),   # culvert (web/src/pt-infrastructure-source.ts)
        (624333, 5053050, 624366, 5053075),   # culvert (web/src/pt-infrastructure-source.ts)
        (624377, 5048186, 624412, 5048216),   # culvert (web/src/pt-infrastructure-source.ts)
        (624396, 5057140, 624612, 5057347),   # fence (web/src/pt-infrastructure-source.ts)
        (624455, 5052971, 624486, 5053001),   # culvert (web/src/pt-infrastructure-source.ts)
        (624639, 5057118, 624787, 5057253),   # fence (web/src/pt-infrastructure-source.ts)
        (624641, 5052854, 624673, 5052881),   # culvert (web/src/pt-infrastructure-source.ts)
        (624700, 5049423, 624730, 5049452),   # culvert (web/src/pt-infrastructure-source.ts)
        (624726, 5052810, 624753, 5052835),   # culvert (web/src/pt-infrastructure-source.ts)
        (624807, 5052760, 624837, 5052786),   # culvert (web/src/pt-infrastructure-source.ts)
        (624826, 5049286, 624863, 5049329),   # culvert (web/src/pt-infrastructure-source.ts)
        (624837, 5052740, 624867, 5052768),   # culvert (web/src/pt-infrastructure-source.ts)
        (624889, 5052700, 624927, 5052735),   # culvert (web/src/pt-infrastructure-source.ts)
        (624937, 5052666, 624977, 5052698),   # culvert (web/src/pt-infrastructure-source.ts)
        (624977, 5052648, 625007, 5052675),   # culvert (web/src/pt-infrastructure-source.ts)
        (625076, 5049140, 625108, 5049170),   # culvert (web/src/pt-infrastructure-source.ts)
        (625253, 5048709, 625288, 5048750),   # culvert (web/src/pt-infrastructure-source.ts)
        (625279, 5052477, 625314, 5052506),   # culvert (web/src/pt-infrastructure-source.ts)
        (625309, 5052795, 625342, 5052828),   # fence (web/src/pt-infrastructure-source.ts)
        (625310, 5049830, 625356, 5049863),   # culvert (web/src/pt-infrastructure-source.ts)
        (625359, 5050685, 625445, 5050772),   # fence (web/src/pt-infrastructure-source.ts)
        (625384, 5050225, 625422, 5050248),   # culvert (web/src/pt-infrastructure-source.ts)
        (625433, 5049787, 625468, 5049814),   # culvert (web/src/pt-infrastructure-source.ts)
        (625514, 5052485, 625564, 5052535),   # pier (web/src/pt-infrastructure-source.ts)
        (625517, 5052781, 625587, 5052843),   # fence (web/src/pt-infrastructure-source.ts)
        (625581, 5048685, 625616, 5048717),   # culvert (web/src/pt-infrastructure-source.ts)
        (625994, 5055138, 626018, 5055173),   # culvert (web/src/pt-infrastructure-source.ts)
        (626005, 5055189, 626032, 5055224),   # culvert (web/src/pt-infrastructure-source.ts)
        (626123, 5049430, 626170, 5049456),   # pier (web/src/pt-infrastructure-source.ts)
        (626770, 5051709, 627112, 5051789),   # conveyor, gate (web/src/pt-infrastructure-source.ts)
        (627134, 5053849, 627159, 5053870),   # gate (web/src/pt-infrastructure-source.ts)
        (627413, 5046487, 627439, 5046510),   # culvert (web/src/pt-infrastructure-source.ts)
        (627845, 5050406, 628390, 5050836),   # conveyor, fence (web/src/pt-infrastructure-source.ts)
        (628418, 5053789, 628445, 5053813),   # culvert (web/src/pt-infrastructure-source.ts)
        (628436, 5050485, 628477, 5050529),   # culvert (web/src/pt-infrastructure-source.ts)
        (628470, 5051851, 628550, 5051917),   # fence (web/src/pt-infrastructure-source.ts)
        (628602, 5052941, 628670, 5053006),   # fence (web/src/pt-infrastructure-source.ts)
        (628618, 5054295, 628702, 5054377),   # fence (web/src/pt-infrastructure-source.ts)
        (628678, 5049471, 628802, 5049625),   # fence (web/src/pt-infrastructure-source.ts)
        (628743, 5052475, 628786, 5052519),   # fence (web/src/pt-infrastructure-source.ts)
        (628859, 5049356, 629038, 5049439),   # conveyor (web/src/pt-infrastructure-source.ts)
        (629447, 5052115, 629552, 5052218),   # fence (web/src/pt-infrastructure-source.ts)
        (629465, 5048125, 629490, 5048147),   # gate (web/src/pt-infrastructure-source.ts)
        (629710, 5048606, 629773, 5048673),   # fence (web/src/pt-infrastructure-source.ts)
        (629795, 5048286, 630629, 5048334),   # pipeline (web/src/pt-infrastructure-source.ts)
        (629796, 5048313, 630173, 5049510),   # pipeline (web/src/pt-infrastructure-source.ts)
        (629986, 5047859, 630042, 5047915),   # fence (web/src/pt-infrastructure-source.ts)
        (630384, 5049639, 630498, 5049835),   # dam (web/src/pt-infrastructure-source.ts)
        (630401, 5050740, 630574, 5050836),   # dam (web/src/pt-infrastructure-source.ts)
        (630416, 5054323, 630467, 5054361),   # fence (web/src/pt-infrastructure-source.ts)
        (630636, 5049524, 630667, 5049556),   # culvert (web/src/pt-infrastructure-source.ts)
        (630723, 5054534, 630792, 5054576),   # fence (web/src/pt-infrastructure-source.ts)
        (630833, 5049146, 630878, 5049179),   # culvert (web/src/pt-infrastructure-source.ts)
        (630887, 5049455, 630912, 5049476),   # gate (web/src/pt-infrastructure-source.ts)
        (631080, 5046833, 631106, 5046855),   # gate (web/src/pt-infrastructure-source.ts)
        (631099, 5048717, 631133, 5048747),   # culvert (web/src/pt-infrastructure-source.ts)
        (631445, 5048312, 631475, 5048347),   # gate (web/src/pt-infrastructure-source.ts)
        (631728, 5046386, 631759, 5046420),   # culvert (web/src/pt-infrastructure-source.ts)
        (631832, 5046408, 631923, 5046509),   # culvert, dam (web/src/pt-infrastructure-source.ts)
        (632374, 5047538, 632409, 5047561),   # culvert (web/src/pt-infrastructure-source.ts)
    ),
)

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
    # Two large halls (2 buildings, 8 blocks). On together with that land delta (grok-bots#1341).
    big_buildings=True,
    # The quarry and its entrance: another thread builds there. (The last line of an area stays a bare `)`:
    # tools/start-here-check.mjs reads each area up to it.)
    keep_roads=((630200, 5061400, 633200, 5066500),))

CANSOCAUSEWAY = Area(
    observed_styles='pipeline/observed_styles_cansocauseway.json',
    id='cansocauseway', name='Canso Causeway and Troy', origin=(591500, 5103332), mid_tiles=(12, 15, 17, 24),
    anchor=(623581, 5056272), fetch_box=(-61.518623, 45.624174, -61.366785, 45.802815),
    highways=(4, 19, 104, 105, 344), anchor_highway=19, wide_source='pointtupper', exclude_utility_trees=True,
    interpolate_coastal_trail=True, avoid_wing_overlaps=True,
    keep_roads=(
        (623579, 5056016, 623776, 5056199),   # the causeway crossing and canal (web/src/canal.ts, web/src/canal-route.ts)
        (621891, 5056144, 621967, 5056203),   # Aulds Cove wharf (web/src/wharves.ts, web/src/wharf-source.ts)
        (624204, 5054541, 624227, 5054565),   # harbour light 698 (web/src/harbour-lights-data.ts)
        (623374, 5056297, 623397, 5056320),   # harbour light 701 (web/src/harbour-lights-data.ts)
        (623541, 5056155, 623565, 5056179),   # harbour light 702 (web/src/harbour-lights-data.ts)
    ),
)

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
