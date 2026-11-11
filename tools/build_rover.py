"""Embed prebuilt JS and the Three.js license in the standalone game.
Build JS first with esbuild (see README); no build tools are needed to play.
"""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
js=(root/'.cache/rover-runtime.js').read_text()
license=(root/'games/THREE-LICENSE.txt').read_text()
js=re.sub(r'</script',r'<\\/script',js,flags=re.I)
html=(root/'tools/chefs-rover.template.html').read_text().replace('<!-- ROVER_RUNTIME -->','<script id="rover-runtime">\n/*\n'+license+'\n*/\n'+js+'\n</script>')
(root/'games/chefs-rover.html').write_text(html)
print('Built standalone Chef’s Rover:',len(html.encode()),'bytes')
