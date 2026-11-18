"""Preserve optional versioned scenery when a routine terrain bake replaces its manifest."""
def preserve_far_manifest(previous, candidate):
    keys={k:previous[k] for k in ('tall','farLand') if k in previous}
    if keys:
        for field in ('crs','origin','size','village'):
            if previous.get(field)!=candidate.get(field):
                raise ValueError('Optional far pack would belong to another terrain root; prepare a new work pack before changing '+field)
    return {**candidate,**keys}
