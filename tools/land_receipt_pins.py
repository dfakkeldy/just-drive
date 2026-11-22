"""Read the original, road-bed, and community-mailbox variants of a land receipt."""


def receipt_for(report, with_bed, *, with_community=False):
    """Return one complete receipt, with the selected file pins."""
    result = {key: value for key, value in report.items() if key not in ('roadBed', 'communityMailboxes')}
    replacements = {}
    if with_bed:
        bed = report['roadBed']
        replacements.update({entry['file']: entry for entry in bed['files']})
    if with_community:
        comm = report['communityMailboxes']
        replacements.update({entry['file']: entry for entry in comm['files']})
    if replacements:
        result['files'] = [entry | replacements.get(entry['file'], {}) for entry in report['files']]
    if with_bed and 'companion' in report['roadBed']:
        result['files'].append(report['roadBed']['companion'])
    return result


def previous_digest(report, name, digest, *, cached=None):
    """Walk back a pinned after hash, also recognizing road-bed and community-mailbox variants."""
    original = next((entry for entry in report['files'] if entry['file'] == name), None)
    if original is None:
        return None
    for variant in ('roadBed', 'communityMailboxes'):
        repaired = next((entry for entry in report.get(variant, {}).get('files', [])
                         if entry['file'] == name), None)
        if repaired and digest == repaired['sha256']:
            if variant == 'roadBed' and cached == original['sha256']:
                return cached
            return repaired.get('before', original['before'])
    if digest == original['sha256']:
        return original['before']
    return None
