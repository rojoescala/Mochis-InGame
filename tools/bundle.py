#!/usr/bin/env python3
"""Junta index.html + style.css + scripts en un solo archivo: mochis-juego.html"""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text()
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + (root / 'style.css').read_text() + '\n</style>')
def inline(m):
    src = (root / m.group(1)).read_text()
    assert '</script' not in src
    return '<script>\n' + src + '\n</script>'
html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
(root / 'mochis-juego.html').write_text(html)
print('mochis-juego.html', len(html) // 1024, 'KB')
