// Credit text shared by the title card (title.ts) and the About pages (tools/about-pages.mjs). Plain strings only:
// the About pages are built in Node, without a browser.

/** Where a person writes to correct something or to have a place taken out. A mailbox alias; change it here only. */
export const CONTACT = 'justdrive@fakkeldy.ca';

export const LAND_CREDITS = `<p>Elevation, trees and building shapes: Natural Resources Canada, High Resolution Digital Elevation Model. Contains information licensed under the Open Government Licence – Canada.</p>
<p>Roads, railways, water, building locations, utility lines and towers, forest types, designated areas, and Point Tupper dams, culverts, conveyors, industrial stack, marine dolphins, wharves and some fences and gates: Province of Nova Scotia. Contains information licensed under the Open Government Licence – Nova Scotia.</p>
<p>Public wharf outlines: Province of Nova Scotia. Contains information licensed under the Open Government Licence – Nova Scotia.</p>
<p>Environment and Climate Change Canada - <span lang="fr">Environnement et Changement climatique Canada</span>. (2025) “Canadian National Wetlands Inventory - <span lang="fr">Inventaire national des terres humides du Canada</span>”. Available at: <a href="https://open.canada.ca/data/en/dataset/d5af4ac5-ebdb-4645-bb0a-8ec5cac5e29f">Canadian National Wetlands Inventory</a> (Accessed 14 November 2026). Contains information licensed under the Open Government Licence – Canada.</p>
<p>Contains modified Copernicus Sentinel data 2025, 2026. Only derived ground classes are used.</p>
<p>Airport runway, taxiways and apron, transmission tower positions, Strait of Canso crossings and communication masts, other Point Tupper fences and gates, the small piers and Point Tupper marine terminal pier outlines, plus some building outlines, road details and wharf source comparisons: © OpenStreetMap contributors, available under the Open Database Licence. Airport way IDs, tower IDs and source choices are retained in the source files.</p>
<p>Airport source comparison, wharf source comparisons, communication tower heights and Point Tupper above-ground pipeline routes: Natural Resources Canada, CanVec. Contains information licensed under the Open Government Licence – Canada.</p>
<p>Strait of Canso crossing tower heights and white strobe lighting: Nova Scotia Environmental Assessment public records (Auld's Cove 2016 registration and 2025 assessment). Communication mast red night-light height classes follow Transport Canada Standard 621.</p>
<p>Airport dimensions and lighting types: NAV CANADA, Canada Flight Supplement, November 2025 edition. Model lamp spacing, taxiway widths and windsock position are approximate.</p>
<p>Harbour lights: Canadian Coast Guard List of Lights; Mabou tower form: Canadian Register of Historic Places. Cross-checks: NSTDB (Open Government Licence – Nova Scotia), NRCan CanVec (Open Government Licence – Canada), and OpenStreetMap (Open Database Licence).</p>`;

/** Shared by both public About pages and every title-card credit view. */
export const FAR_CREDITS = `<p>Source: Natural Resources Canada, Canadian Wind Turbine Database. Contains information licensed under the Open Government Licence – Canada.</p>
<p>Contains modified Copernicus Sentinel data 2026.</p>
<p>Far land and turbine ground heights: Natural Resources Canada, Medium Resolution Digital Elevation Model (MRDEM-30 DTM). Contains information licensed under the Open Government Licence – Canada.</p>`;

export const ENGINE_CREDIT = `<p>Built with three.js (MIT licence).</p>`;

/** Where a player can give the developer a coffee. The radio's donation ad sends listeners to this link. */
export const COFFEE_URL = 'https://ko-fi.com/fakkeldy';
export const COFFEE_TEXT = 'Buy the developer a coffee';

/** The public About page of each brand. Absolute, so the private test page links to the live site. */
export const ABOUT_URL = { mail: 'https://mmm.fakkeldy.ca/about', just: 'https://justdrive.fakkeldy.ca/about' } as const;
/** The public Help page of each brand: controls, settings and what to do when something goes wrong. */
export const HELP_URL = { mail: 'https://mmm.fakkeldy.ca/help', just: 'https://justdrive.fakkeldy.ca/help' } as const;
/** Just Listen: the radio alone, on a light page of its own (tools/listen-page.mjs). One page, at the same path on both hosts. */
export const LISTEN_URL = { mail: 'https://mmm.fakkeldy.ca/listen/', just: 'https://justdrive.fakkeldy.ca/listen/' } as const;
/** What's new: the changelog page built by tools/changelog.py. Absolute like the others; the same page on both hosts. */
export const CHANGES_URL = { mail: 'https://mmm.fakkeldy.ca/changes/', just: 'https://justdrive.fakkeldy.ca/changes/' } as const;
export const CHANGES_TEXT = "What's new";
export const LISTEN_TEXT = 'Just Listen: the radio alone';
