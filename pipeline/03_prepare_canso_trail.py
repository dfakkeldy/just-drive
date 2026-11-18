#!/usr/bin/env python3
"""Prepare the owner-approved Canso trail estimate before its area bake."""
from areas import current
from canso_trail import prepare

if __name__ == '__main__':
    prepare(current())
