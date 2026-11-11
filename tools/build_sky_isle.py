"""Build standalone Sky-Isle Logistics, with CDN + embedded offline Babylon fallback."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
html=(root/'tools/sky-isle.template.html').read_text()
libs=(root/'tools/sky-libraries.json').read_text()
js=(root/'games/sky-archipelago.js').read_text()+'\n'+(root/'games/sky-isle.js').read_text()
license=(root/'games/BABYLON-LICENSE.txt').read_text()
escape=lambda s:re.sub(r'</script',r'<\\/script',s,flags=re.I)
html=html.replace('<!-- SKY_LIBRARIES -->','<script>/* Babylon.js and Babylon GUI: Apache-2.0.\n'+license.replace('*/','* /')+'\n*/\nwindow.__SKY_LIBS='+libs+';</script>')
html=html.replace('<!-- SKY_RUNTIME -->','<script>'+escape(js)+'</script>')
out=root/'games/sky-isle.html';out.write_text(html)
print('Built Sky-Isle Logistics:',out.stat().st_size,'bytes')
