"""Embed the account module and auth UI into all site pages after editing sources."""
from pathlib import Path
import re
root=Path(__file__).resolve().parent.parent
for page in ('index.html','top.html','roulette.html','admin.html'):
    p=root/page;s=p.read_text()
    for source,tag in (('database.js','accounts-module'),('auth-client.js','auth-client-runtime')):
        code=re.sub(r'</script',r'<\\/script',(root/source).read_text(),flags=re.I)
        script=f'<script id="{tag}">\n{code}\n</script>'
        pattern=rf'<script id="{tag}">[\s\S]*?</script>'
        if re.search(pattern,s):s=re.sub(pattern,lambda m:script,s,count=1)
        elif source=='database.js':s=s.replace('<script src="database.js"></script>',script)
        else:s=s.replace('</body>',script+'\n</body>')
    p.write_text(s)
