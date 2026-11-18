"""Reviewed source-data expectations; a source/rule change needs an explicit review."""

def reviewed_drops(area, audit):
    expected={f'pointtupper-{n}' for n in (13,30,46,53,63,64,75)} if area=='pointtupper' else set()
    actual={lot['id'] for lot in audit if lot['drop']}
    assert actual==expected, f'Reviewed drop list changed for {area}: {sorted(actual)} != {sorted(expected)}'
