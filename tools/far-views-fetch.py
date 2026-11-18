#!/usr/bin/env python3
"""Open-source inputs for far views. No full-scene Sentinel download or image output.

The three farm review windows use 10 m COG reads into RAM. Only numerical audit
metadata is retained. --sentinel-audit re-reads those windows, not EA positions.
"""
import argparse,json,urllib.request,urllib.parse
from datetime import datetime,timezone
from pathlib import Path
from osgeo import gdal
ROOT=Path(__file__).resolve().parent.parent

def get(url):
 with urllib.request.urlopen(url,timeout=60) as r:return json.load(r)
def save(path,data):path.write_text(json.dumps(data,separators=(',',':'))+'\n')
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--data-root',type=Path,required=True);ap.add_argument('--sentinel-audit',action='store_true');args=ap.parse_args();data=args.data_root.resolve();raw=data/'raw/far-views';raw.mkdir(parents=True,exist_ok=True)
 gdal.UseExceptions();gdal.SetConfigOption('GDAL_DISABLE_READDIR_ON_OPEN','EMPTY_DIR');gdal.SetConfigOption('CPL_VSIL_CURL_ALLOWED_EXTENSIONS','.tif');gdal.SetConfigOption('GDAL_HTTP_TIMEOUT','60');gdal.SetConfigOption('CPL_VSIL_CURL_CACHE_SIZE','33554432');gdal.SetConfigOption('CPL_VSIL_NETWORK_STATS_ENABLED','YES');gdal.NetworkStatsReset()
 if args.sentinel_audit:
  points=json.loads((ROOT/'pipeline/far-views-points.json').read_text());windows=[]
  for scene in points['scenes'].values():
   b=scene['window'];windows.append((scene,b))
  for p in points['points']:
   if 'window' in p:windows.append((points['scenes'][p['scene']],p['window']))
  audit=[];seen=set()
  for scene,b in windows:
   key=(scene['datetime'],*b)
   if key in seen:continue
   seen.add(key);row=dict(datetime=scene['datetime'],window=b,bands={},derivedPoints=sum(p['date']==scene['datetime'][:10] for p in points['points']))
   for band,url in scene['assets'].items():
    ds=gdal.Warp('', '/vsicurl/'+url,format='MEM',dstSRS='EPSG:2961',outputBounds=b,xRes=10,yRes=10,resampleAlg='near');a=ds.ReadAsArray();row['bands'][band]=dict(shape=list(a.shape),bytes=a.nbytes,min=int(a.min()),max=int(a.max()));ds=None
    network=json.loads(gdal.NetworkStatsGetAsSerializedJSON());downloaded=network.get('methods',{}).get('GET',{}).get('downloaded_bytes',0)
    if downloaded>900_000_000:raise RuntimeError('Window audit reached its 900 MB transfer ceiling')
   audit.append(row)
  save(raw/'sentinel-window-audit.json',dict(windows=audit,network=json.loads(gdal.NetworkStatsGetAsSerializedJSON()),pixelsRetained=False));print('Sentinel windows audited in RAM; no pixels retained',flush=True)
 else:
  features=[]
  for layer,prefix in [(6,'ns'),(8,'pei')]:
   u='https://maps-cartes.services.geo.ca/server_serveur/rest/services/NRCan/wind_turbine_database2_en/MapServer/'+str(layer)+'/query?'+urllib.parse.urlencode(dict(where='1=1',outSR=4326,outFields='*',f='geojson'))
   d=get(u)
   if 'features' not in d or d.get('exceededTransferLimit'):raise ValueError('Incomplete turbine service response')
   for f in d['features']:f['id']=prefix+'-'+str(f['id'])
   features+=d['features']
  save(raw/'nrcan-turbines.geojson',dict(type='FeatureCollection',features=features))
  u='https://datacube.services.geo.ca/stac/api/search?'+urllib.parse.urlencode(dict(collections='mrdem-30',bbox='-63.7,44.7,-59.8,47',limit=10));d=get(u);save(raw/'dem-stac.json',d)
  asset=d['features'][0]['assets']['dtm']['href']
  ds=gdal.Warp(str(raw/'regional-240m.tif'),'/vsicurl/'+asset,format='GTiff',dstSRS='EPSG:2961',outputBounds=[480000,4960000,760000,5240000],xRes=240,yRes=240,resampleAlg='bilinear',creationOptions=['COMPRESS=DEFLATE'],dstNodata=-32767);ds=None
  save(raw/'fetch-receipt.json',dict(retrieved=datetime.now(timezone.utc).isoformat(),turbines=len(features),dem=asset,network=json.loads(gdal.NetworkStatsGetAsSerializedJSON())))
  print('Fetched NRCan turbine points and 240 m MRDEM regional subset',len(features))
if __name__=='__main__':main()
