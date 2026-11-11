"""Build one entirely offline HTML. Source files are only needed for editing."""
from pathlib import Path
import json,re,base64,gzip,hashlib
from html import escape
root=Path(__file__).resolve().parents[1]
html=(root/'tools/redline.template.html').read_text()
credits=(root/'REDLINE-ASSET-LICENSES.md').read_text()
cc=(root/'assets/redline/CC-BY-4.0.txt').read_text()
html=html.replace('<!-- REDLINE_CREDITS -->','<details id="assetCredits"><summary>Модели и лицензии · CC BY 4.0</summary><pre>'+escape(credits)+'</pre><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">Открыть официальную страницу CC BY 4.0 ↗</a><details><summary>Полный текст CC BY 4.0 (встроен, английский)</summary><pre>'+escape(cc)+'</pre></details></details>')
core=json.loads((root/'tools/sky-libraries.json').read_text())['core']
license=(root/'games/BABYLON-LICENSE.txt').read_text().replace('*/','* /')
html=html.replace('<!-- REDLINE_LIBRARIES -->','<script>/* Babylon.js: Apache-2.0\n'+license+'\n*/window.__RL_CORE='+json.dumps(core)+';</script>')
html=html.replace('<!-- REDLINE_ASSETS -->','<script>window.__RL_MESHES_GZ='+json.dumps(base64.b64encode((root/'assets/redline/meshes.json.gz').read_bytes()).decode())+';</script>')
surface=(root/'assets/redline/surface.json.gz').read_bytes()
assert json.loads(gzip.decompress(surface))['roadsHash']==hashlib.sha256((root/'games/redline-roads.js').read_bytes()).hexdigest(), 'Rebuild surface: python tools/build_redline_surface.py'
html=html.replace('<!-- REDLINE_SURFACE -->','<script>window.__RL_SURFACE_GZ='+json.dumps(base64.b64encode(surface).decode())+';</script>')
js='\n'.join((root/('games/'+f)).read_text() for f in ['redline-cars.js','redline-roads.js','redline-surface.js','redline-architecture.js','redline-mountains.js','redline-districts.js','redline-world.js','redline-handling.js','redline-drivers.js','redline-roam.js','redline-story.js','redline-economy.js','redline.js'])
html=html.replace('<!-- REDLINE_RUNTIME -->','<script>'+re.sub(r'</script',r'<\\/script',js,flags=re.I)+'</script>')
out=root/'games/redline.html';out.write_text(html);print(out,len(html.encode()))
