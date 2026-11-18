"""Conservative lot eligibility from open NRCan HRDEM DTM/DSM, never reflectance."""
import math
from pathlib import Path
import numpy as np
from osgeo import gdal,osr
import xml.etree.ElementTree as ET
from shapely.geometry import box
from shapely.geometry import shape


def record_window(ds,path,bounds,record):
    record(path,'height-source')
    if Path(path).suffix!='.vrt':return
    src=osr.SpatialReference();src.ImportFromEPSG(2961)
    dst=ds.GetSpatialRef()
    for sr in (src,dst):sr.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    tr=osr.CoordinateTransformation(src,dst)
    points=box(*bounds).segmentize(16).exterior.coords
    inv=gdal.InvGeoTransform(ds.GetGeoTransform())
    coords=[gdal.ApplyGeoTransform(inv,*tr.TransformPoint(x,y)[:2]) for x,y in points]
    x0=min(p[0] for p in coords)-3;x1=max(p[0] for p in coords)+3
    y0=min(p[1] for p in coords)-3;y1=max(p[1] for p in coords)+3
    for node in ET.fromstring(Path(path).read_text()).findall('.//ComplexSource')+ET.fromstring(Path(path).read_text()).findall('.//SimpleSource'):
        rect=node.find('DstRect');name=node.find('SourceFilename')
        if rect is None or name is None:continue
        l,t,w,h=[float(rect.attrib[k]) for k in ('xOff','yOff','xSize','ySize')]
        if l>x1 or l+w<x0 or t>y1 or t+h<y0:continue
        source=Path(path).parent/name.text if name.attrib.get('relativeToVRT')=='1' else Path(name.text)
        if source.suffix=='.vrt':record_window(gdal.Open(str(record(source,'height-source'))),source,bounds,record)
        else:record(source,'height-source')


def filter_lots(lots,raw,record,grid,rules,buildings=()):
    folder=Path(raw)/'elevation'
    paths=[folder/f'land-{k}-1m-epsg3979.vrt' for k in ('dtm','dsm')]
    if not paths[0].exists():paths=[folder/f'north-loop-{k}-1m-epsg3979.tif' for k in ('dtm','dsm')]
    paths=[p.with_name(p.name.replace('.vrt','-federal.vrt')) if p.suffix=='.vrt' and p.with_name(p.name.replace('.vrt','-federal.vrt')).exists() else p for p in paths]
    sources=[gdal.Open(str(record(p,'height-source'))) for p in paths]
    kept,audit=[],[]
    for lot in lots:
        g=shape(lot['geometry']);x0,y0,x1,y1=g.bounds
        bounds=(math.floor(x0/2)*2-4,math.floor(y0/2)*2-4,math.ceil(x1/2)*2+4,math.ceil(y1/2)*2+4)
        arrays=[]
        for ds,path in zip(sources,paths):
            record_window(ds,path,bounds,record)
            out=gdal.Warp('',ds,format='MEM',dstSRS='EPSG:2961',outputBounds=bounds,xRes=2,yRes=2,resampleAlg='bilinear',dstNodata=-9999)
            arrays.append(out.ReadAsArray().astype(float))
        dtm,dsm=arrays;inside=grid([g]).grid(bounds)
        valid=(dtm>-1000)&(dsm>-1000)&np.isfinite(dtm)&np.isfinite(dsm)
        dy,dx=np.gradient(dtm,2);slope=np.hypot(dx,dy)
        valid &= np.isfinite(slope)
        roofs=grid([b.buffer(1) for b in buildings]).grid(bounds)
        eligible=inside&~roofs
        cells=eligible&valid;n=int(cells.sum());coverage=n/max(1,int(eligible.sum()))
        median=float(np.median(slope[cells])) if n else None
        tall=float(((dsm-dtm)[cells]>rules['lot_tall_height_m']).mean()) if n else None
        reasons=[]
        if coverage<.95:reasons.append('incomplete_hrdem')
        if median is not None and median>rules['lot_max_median_slope']:reasons.append('median_slope')
        if tall is not None and tall>rules['lot_max_tall_fraction']:reasons.append('tall_cover')
        audit.append(dict(roof_fraction=float((inside&roofs).sum()/max(1,inside.sum())),id=lot['id'],m2=g.area,median_slope=median,tall_fraction=tall,valid_fraction=coverage,drop=bool(reasons),reasons=reasons))
        if not reasons:kept.append(lot)
    return kept,audit
