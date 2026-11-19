"""Build standalone Sky-Isle Logistics, with CDN + embedded offline Babylon fallback."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
html=(root/'tools/sky-isle.template.html').read_text()
libs=(root/'tools/sky-libraries.json').read_text()
js=(root/'games/sky-archipelago.js').read_text()+'\n'+(root/'games/sky-isle.js').read_text()+'\n'+(root/'games/sky-gfx.js').read_text()
license=(root/'games/BABYLON-LICENSE.txt').read_text()
escape=lambda s:re.sub(r'</script',r'<\\/script',s,flags=re.I)
html=html.replace('<!-- SKY_LIBRARIES -->','<script>/* Babylon.js and Babylon GUI: Apache-2.0.\n'+license.replace('*/','* /')+'\n*/\nwindow.__SKY_LIBS='+libs+';</script>')
html=html.replace('<!-- SKY_RUNTIME -->','<script>'+escape(js)+'</script>')
# Словари i18n (RU/EN) дописывает tools/i18n/games.py в собранную страницу. При
# пересборке переносим их из прошлой версии, иначе переводы молча пропадают.
out=root/'games/sky-isle.html'
carry=[]
if out.exists():
    old=out.read_text(encoding='utf-8')
    for name in ('game-i18n-strings','game-i18n-runtime'):
        m=re.search(r'<script id="'+name+r'">.*?</script>',old,re.S)
        if m: carry.append(m.group(0))
if out.exists():
    prev=out.read_text(encoding='utf-8')
    if 'data-ru=' in prev and 'data-ru=' not in html:
        print('ВНИМАНИЕ: в собранной странице есть пары data-ru/data-en, а в шаблоне их нет.')
        print('После пересборки разметку переводов восстанавливает python3 tools/i18n/games.py')
if carry and 'game-i18n-strings' not in html:
    html=html.replace('<head>','<head>\n'+'\n'.join(carry),1)
out.write_text(html)
print('Built Sky-Isle Logistics:',out.stat().st_size,'bytes')
