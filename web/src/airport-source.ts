/** Small vector extract. © OpenStreetMap contributors, ODbL. Coordinates transformed by GDAL
 * from WGS84 to EPSG:2961 on 2026-11-15. No image pixels. CFS supplies width/surface/light types.
 * Taxiway width (15 m), windsock position and lamp spacing are model approximations.
 * Runway mapped length is 1509.9 m; published 1524 m is retained, not silently substituted.
 * Baked NSTDB/HRDEM buildings take precedence over the two OSM hangar outlines.
 */
export const AIRPORT = {
  "comparison": {
    "canvec": {"url":"https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/canvec/shp/Transport/canvec_250K_NS_Transport_shp.zip", "layer":"runway_0", "featureId":"4a84c79faea14ed189191742f73fe6f2", "lonlat":[-61.3706664,45.6578823], "horizontalAccuracyMetres":250, "decision":"Reject for geometry. One airfield point, no runway ends, taxiways, apron, heights or lighting in this extract."},
    "nstdb": "Live Structures service connection timed out. Compare against shipped NSTDB building records 10 and 45 instead; their measured ground/eave/ridge heights take precedence over OSM outlines. No new buildings."
  },
  "retrieved": "2026-11-15",
  "crs": "EPSG:2961",
  "osmUrl": "https://www.openstreetmap.org/api/0.6/map?bbox=-61.385,45.65,-61.35,45.665",
  "cfsUrl": "https://imageserver.fltplan.com/afd/Canada/27NOV2025/CYPD-2439.PDF",
  "runway": {
    "osm": 557999000,
    "ends": [
      [
        626370.897,
        5057168.646
      ],
      [
        627880.627,
        5057192.745
      ]
    ],
    "lonlat": [
      [
        -61.3779813,
        45.6565616
      ],
      [
        -61.358605,
        45.6565017
      ]
    ],
    "width": 45.72,
    "publishedLength": 1524,
    "magneticHeading": 109,
    "surface": "asphalt"
  },
  "taxiways": [
    {
      "osm": 194663350,
      "points": [
        [
          626515.518,
          5057366.614
        ],
        [
          626516.593,
          5057262.037
        ],
        [
          626517.374,
          5057197.411
        ],
        [
          626515.533,
          5057190.538
        ],
        [
          626512.949,
          5057184.24
        ],
        [
          626510.104,
          5057180.014
        ],
        [
          626504.96,
          5057176.164
        ],
        [
          626500.835,
          5057173.157
        ],
        [
          626498.166,
          5057170.669
        ]
      ],
      "width": 15
    },
    {
      "osm": 557998997,
      "points": [
        [
          626321.393,
          5057362.892
        ],
        [
          626328.701,
          5057363.029
        ],
        [
          626451.579,
          5057365.329
        ],
        [
          626515.518,
          5057366.614
        ],
        [
          626552.503,
          5057367.575
        ]
      ],
      "width": 15
    },
    {
      "osm": 557998999,
      "points": [
        [
          626517.374,
          5057197.411
        ],
        [
          626520.138,
          5057190.632
        ],
        [
          626522.959,
          5057185.276
        ],
        [
          626527.244,
          5057180.362
        ],
        [
          626534.847,
          5057176.348
        ],
        [
          626550.841,
          5057170.948
        ]
      ],
      "width": 15
    }
  ],
  "apron": {
    "osm": 163231396,
    "points": [
      [
        626442.668,
        5057313.899
      ],
      [
        626442.137,
        5057359.725
      ],
      [
        626355.841,
        5057357.521
      ],
      [
        626352.85,
        5057352.803
      ],
      [
        626351.904,
        5057334.09
      ],
      [
        626306.394,
        5057333.813
      ],
      [
        626306.586,
        5057380.887
      ],
      [
        626354.006,
        5057380.035
      ],
      [
        626373.462,
        5057372.204
      ],
      [
        626442.111,
        5057370.65
      ],
      [
        626443.817,
        5057383.355
      ],
      [
        626597.193,
        5057386.798
      ],
      [
        626598.778,
        5057316.364
      ],
      [
        626550.546,
        5057314.997
      ],
      [
        626529.496,
        5057292.986
      ],
      [
        626530.081,
        5057214.974
      ],
      [
        626555.242,
        5057193.733
      ],
      [
        626484.056,
        5057192.301
      ],
      [
        626507.261,
        5057214.534
      ],
      [
        626505.203,
        5057292.582
      ],
      [
        626484.231,
        5057314.019
      ],
      [
        626442.668,
        5057313.899
      ]
    ]
  },
  "hangars": [
    {
      "osm": 163231548,
      "points": [
        [
          626403.276,
          5057411.342
        ],
        [
          626421.478,
          5057410.377
        ],
        [
          626419.703,
          5057377.198
        ],
        [
          626401.501,
          5057378.163
        ],
        [
          626403.276,
          5057411.342
        ]
      ],
      "bakedId": 10
    },
    {
      "osm": 163231584,
      "points": [
        [
          626349.573,
          5057408.043
        ],
        [
          626370.119,
          5057407.214
        ],
        [
          626369.262,
          5057386.39
        ],
        [
          626348.716,
          5057387.219
        ],
        [
          626349.573,
          5057408.043
        ]
      ],
      "bakedId": 45
    }
  ],
  "windsock": {
    "point": [
      626620,
      5057270
    ],
    "position": "approximate; no surveyed point in the checked sources"
  },
  "lighting": {
    "edgeSpacing": 60,
    "position": "regular model spacing; CFS confirms type, not individual positions",
    "approachArray": false
  }
};
