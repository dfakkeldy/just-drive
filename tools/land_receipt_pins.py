"""Read the original and road-bed variants of a land receipt."""


def receipt_for(report, with_bed):
    """Return one complete receipt, with the selected file pins."""
    result = {key: value for key, value in report.items() if key != 'roadBed'}
    if not with_bed:
        return result
    bed = report['roadBed']
    replacements = {entry['file']: entry for entry in bed['files']}
    result['files'] = [entry | replacements.get(entry['file'], {}) for entry in report['files']]
    if 'companion' in bed:
        result['files'].append(bed['companion'])
    return result


def previous_digest(report, name, digest, *, cached=None):
    """Walk back a pinned after hash, also recognizing a cache made on the original after bytes."""
    original = next((entry for entry in report['files'] if entry['file'] == name), None)
    if original is None:
        return None
    repaired = next((entry for entry in report.get('roadBed', {}).get('files', [])
                     if entry['file'] == name), None)
    if repaired and digest == repaired['sha256']:
        if cached == original['sha256']:
            return cached
        return repaired.get('before', original['before'])
    if digest == original['sha256']:
        return original['before']
    return None
