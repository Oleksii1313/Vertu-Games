#!/usr/bin/env python3
"""VertGames static site + persistent email-confirmed authentication.
Run: python3 server.py. Configure SMTP via environment (see .env.example).
Game HTML files work independently; email/account APIs require this server.
"""
import sys, google_oauth
import os, re, json, time, secrets, hashlib, hmac, sqlite3, ssl, smtplib, mimetypes, threading
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
from http.cookies import SimpleCookie
from email.message import EmailMessage
ROOT=Path(__file__).resolve().parent
DB=Path(os.environ.get('VERTGAMES_DB',str(ROOT/'data'/'accounts.sqlite3')))
PORT=int(os.environ.get('PORT','8000'))
COOKIE='vg_session'
TTL=600
MAIL_LOCK=threading.Lock()

class ClosingConnection(sqlite3.Connection):
    # SQLite's normal context manager commits/rolls back but does not close.
    def __exit__(self, *args):
        try:return super().__exit__(*args)
        finally:self.close()

def connect():
    c=sqlite3.connect(DB,timeout=15,factory=ClosingConnection);c.row_factory=sqlite3.Row;return c

def init_db():
    DB.parent.mkdir(parents=True,exist_ok=True)
    with connect() as c:
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,email TEXT NOT NULL,email_key TEXT NOT NULL UNIQUE,password TEXT NOT NULL,created INTEGER NOT NULL,verified INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL,email TEXT NOT NULL,email_key TEXT NOT NULL,password TEXT NOT NULL,code_hash TEXT NOT NULL,expires INTEGER NOT NULL,sent INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);
        ''')
        google_oauth.init_db(c)

def now():return int(time.time())
def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def password_hash(password):
    salt=secrets.token_hex(16);rounds=310000
    return f'pbkdf2_sha256${rounds}${salt}$'+hashlib.pbkdf2_hmac('sha256',password.encode(),salt.encode(),rounds).hex()
def password_ok(password,stored):
    try:
        alg,rounds,salt,expected=stored.split('$')
        return alg=='pbkdf2_sha256' and hmac.compare_digest(hashlib.pbkdf2_hmac('sha256',password.encode(),salt.encode(),int(rounds)).hex(),expected)
    except (ValueError,TypeError):return False

def valid_email(value):
    if not isinstance(value,str) or len(value)>254 or value.count('@')!=1:return False
    local,domain=value.rsplit('@',1)
    return bool(1<=len(local)<=64 and not local.startswith('.') and not local.endswith('.') and '..' not in local and re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+",local) and re.fullmatch(r'(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}',domain))
def valid_name(value):return bool(isinstance(value,str) and 1<=len(value)<=48 and re.fullmatch(r'[\w.-]+',value,re.UNICODE) and value.casefold() not in ('__proto__','prototype','constructor'))
def configured():return bool(os.environ.get('SMTP_HOST') and os.environ.get('SMTP_FROM'))
def send_code(email,code):
    if not configured():raise RuntimeError('SMTP is not configured')
    msg=EmailMessage();msg['From']=os.environ['SMTP_FROM'];msg['To']=email;msg['Subject']='VertGames — подтверждение почты'
    msg.set_content(f'Ваш код подтверждения VertGames: {code}\n\nКод действует 10 минут. Никому не сообщайте его.\nЕсли вы не запрашивали регистрацию, просто проигнорируйте это письмо.')
    host=os.environ['SMTP_HOST'];mode=os.environ.get('SMTP_MODE','starttls');port=int(os.environ.get('SMTP_PORT','465' if mode=='ssl' else '587'))
    if mode not in ('ssl','starttls','plain'):raise RuntimeError('Invalid SMTP_MODE')
    if mode=='plain' and host not in ('127.0.0.1','localhost','::1'):raise RuntimeError('Unencrypted SMTP is only allowed on localhost')
    context=ssl.create_default_context()
    client=smtplib.SMTP_SSL(host,port,timeout=15,context=context) if mode=='ssl' else smtplib.SMTP(host,port,timeout=15)
    with client:
        client.ehlo()
        if mode=='starttls':client.starttls(context=context);client.ehlo()
        if os.environ.get('SMTP_USER'):client.login(os.environ['SMTP_USER'],os.environ.get('SMTP_PASSWORD',''))
        client.send_message(msg)

def public_user(row):
    with connect() as c: linked=google_oauth.linked(c,row['id'])
    return {'username':row['username'],'email':row['email'],'emailVerified':True,'authSource':'server','created':row['created'],'googleLinked':linked}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,fmt,*args):
        # Do not log query strings (email addresses) or request bodies/codes.
        if args:print(self.command,urlparse(self.path).path,str(args[1]) if len(args)>1 else '',flush=True)
    def reply(self,status,data,cookie=None):
        payload=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(payload)));self.send_header('X-Content-Type-Options','nosniff')
        if cookie:self.send_header('Set-Cookie',cookie)
        self.end_headers();self.wfile.write(payload)
    def error(self,status,code,message):self.reply(status,{'ok':False,'code':code,'msg':message})
    def rate(self,scope,limit,seconds):
        key=digest(scope+':'+self.client_address[0])
        with connect() as c:
            c.execute('BEGIN IMMEDIATE');c.execute('DELETE FROM limits WHERE until<?',(now(),));r=c.execute('SELECT * FROM limits WHERE key=?',(key,)).fetchone()
            if r and r['count']>=limit:self.error(429,'RATE_LIMIT','Слишком много попыток. Подождите и попробуйте позже.');return False
            if r:c.execute('UPDATE limits SET count=count+1 WHERE key=?',(key,))
            else:c.execute('INSERT INTO limits VALUES(?,?,?)',(key,1,now()+seconds))
        return True
    def cookie(self,token='',age=2592000):
        secure='; Secure' if os.environ.get('PUBLIC_URL','').startswith('https://') or self.headers.get('X-Forwarded-Proto','').split(',')[0]=='https' else ''
        return f'{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}'+secure
    def token(self):
        try:c=SimpleCookie();c.load(self.headers.get('Cookie',''));return c[COOKIE].value if COOKIE in c else ''
        except Exception:return ''
    def session(self):
        token=self.token()
        if not token:return None
        with connect() as c:return c.execute('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires>?',(digest(token),now())).fetchone()
    def new_session(self,c,user_id):
        token=secrets.token_urlsafe(32);c.execute('DELETE FROM sessions WHERE expires<?',(now(),));old=self.token()
        if old:c.execute('DELETE FROM sessions WHERE token_hash=?',(digest(old),))
        c.execute('INSERT INTO sessions VALUES(?,?,?)',(digest(token),user_id,now()+2592000));return token
    def do_GET(self):
        path=urlparse(self.path).path
        if path==google_oauth.CALLBACK:return google_oauth.callback(self,sys.modules[__name__])
        if path=='/api/auth/session':
            user=self.session();return self.reply(200,{'ok':True,'emailConfigured':configured(),'googleConfigured':google_oauth.configured(),'user':public_user(user) if user else None})
        if path=='/api/auth/availability':
            if not self.rate('availability',120,60):return
            q=parse_qs(urlparse(self.path).query);name=q.get('username',[''])[0].strip();email=q.get('email',[''])[0].strip()
            with connect() as c:
                taken_name=bool(c.execute('SELECT 1 FROM users WHERE username_key=?',(name.casefold(),)).fetchone()) if name else False
                taken_email=bool(c.execute('SELECT 1 FROM users WHERE email_key=?',(email.casefold(),)).fetchone()) if email else False
            return self.reply(200,{'ok':True,'usernameTaken':taken_name,'emailTaken':taken_email,'emailValid':valid_email(email)})
        if path.startswith('/api/'):return self.error(404,'NOT_FOUND','Неизвестный запрос')
        # Serve only public site/game files; never expose account DB, env or source/config files.
        rel=unquote(path).lstrip('/') or 'index.html'
        allowed=rel in ('index.html','top.html','roulette.html','admin.html','about.html','support.html','api.html','privacy.html','database.js','auth-client.js','coin.svg') or (rel.startswith('games/') and Path(rel).suffix.lower() in ('.html','.png','.jpg','.svg'))
        file=(ROOT/rel).resolve()
        if not allowed or ROOT not in file.parents or not file.is_file():self.send_error(404);return
        payload=file.read_bytes();self.send_response(200);self.send_header('Content-Type',(mimetypes.guess_type(file.name)[0] or 'application/octet-stream')+('; charset=utf-8' if file.suffix in ('.html','.js','.svg') else ''));self.send_header('Content-Length',str(len(payload)));self.send_header('Cache-Control','no-cache');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(payload)
    def do_POST(self):
        origin=self.headers.get('Origin')
        allowed_host=os.environ.get('PUBLIC_URL','').rstrip('/') or f"{'https' if self.headers.get('X-Forwarded-Proto')=='https' else 'http'}://{self.headers.get('Host','')}"
        if origin and origin.rstrip('/')!=allowed_host:return self.error(403,'ORIGIN','Запрос должен выполняться с адреса сайта.')
        if not self.headers.get('Content-Type','').startswith('application/json'):return self.error(415,'CONTENT_TYPE','Требуется JSON')
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<1 or length>16384:raise ValueError()
            data=json.loads(self.rfile.read(length))
            if not isinstance(data,dict):raise ValueError()
        except (ValueError,UnicodeError):return self.error(400,'BAD_REQUEST','Некорректный запрос')
        path=urlparse(self.path).path
        try:
            if path=='/api/auth/google/start':return google_oauth.start(self,data,sys.modules[__name__])
            if path=='/api/auth/register':return self.register(data)
            if path=='/api/auth/verify':return self.verify(data)
            if path=='/api/auth/resend':return self.resend(data)
            if path=='/api/auth/login':return self.login(data)
            if path=='/api/auth/logout':
                with connect() as c:c.execute('DELETE FROM sessions WHERE token_hash=?',(digest(self.token()),))
                return self.reply(200,{'ok':True},self.cookie('',0))
            return self.error(404,'NOT_FOUND','Неизвестный запрос')
        except sqlite3.IntegrityError:return self.error(409,'DUPLICATE','Этот ник или email уже зарегистрирован. Используйте вход.')
        except Exception as exc:
            print('API failure:',type(exc).__name__,flush=True)
            return self.error(500,'SERVER_ERROR','Не удалось выполнить запрос. Попробуйте позже.')
    def register(self,data):
        if not self.rate('register',10,3600):return
        name=str(data.get('username','')).strip();email=str(data.get('email','')).strip().lower();password=data.get('password','')
        if not valid_name(name):return self.error(400,'USERNAME','Ник: 1–48 букв, цифр, точек, дефисов или подчёркиваний.')
        if not valid_email(email):return self.error(400,'EMAIL','Некорректный email. Укажите настоящий адрес.')
        if not isinstance(password,str) or not 4<=len(password)<=256:return self.error(400,'PASSWORD','Пароль должен содержать от 4 до 256 символов.')
        with connect() as c:
            if c.execute('SELECT 1 FROM users WHERE username_key=? OR email_key=?',(name.casefold(),email.casefold())).fetchone():return self.error(409,'DUPLICATE','Этот ник или email уже зарегистрирован. Используйте вход.')
        if not configured():return self.error(503,'EMAIL_NOT_CONFIGURED','Отправка писем ещё не настроена владельцем сайта. Аккаунт не создан. Существующий аккаунт доступен через «Вход».')
        # One pending request per email, with global cooldown. No code is returned to the client or logs.
        with MAIL_LOCK:
            with connect() as c:
                c.execute('DELETE FROM pending WHERE expires<?',(now(),))
                if c.execute('SELECT 1 FROM pending WHERE email_key=? AND sent>?',(email.casefold(),now()-60)).fetchone():return self.error(429,'COOLDOWN','Письмо уже отправлено. Подождите минуту перед повторной отправкой.')
            pid=secrets.token_urlsafe(24);code=f'{secrets.randbelow(1000000):06d}';stored=password_hash(password)
            try:send_code(email,code)
            except Exception as exc:
                print('SMTP failure:',type(exc).__name__,flush=True);return self.error(503,'EMAIL_SEND_FAILED','Не удалось отправить письмо. Проверьте адрес или обратитесь к владельцу сайта. Аккаунт не создан.')
            with connect() as c:
                c.execute('DELETE FROM pending WHERE email_key=?',(email.casefold(),))
                c.execute('INSERT INTO pending VALUES(?,?,?,?,?,?,?,?,?,0)',(pid,name,name.casefold(),email,email.casefold(),stored,digest(pid+':'+code),now()+TTL,now()))
        self.reply(200,{'ok':True,'registrationId':pid,'email':email,'expiresIn':TTL,'resendAfter':60})
    def verify(self,data):
        if not self.rate('verify',30,900):return
        pid=str(data.get('registrationId',''));code=str(data.get('code','')).strip()
        with connect() as c:
            c.execute('BEGIN IMMEDIATE');p=c.execute('SELECT * FROM pending WHERE id=?',(pid,)).fetchone()
            if not p or p['expires']<now():return self.error(400,'EXPIRED','Код истёк. Запросите новое письмо или начните регистрацию заново.')
            if p['attempts']>=5:return self.error(429,'CODE_LOCKED','Слишком много неверных кодов. Запросите новое письмо.')
            if not re.fullmatch(r'\d{6}',code) or not hmac.compare_digest(digest(pid+':'+code),p['code_hash']):
                c.execute('UPDATE pending SET attempts=attempts+1 WHERE id=?',(pid,));return self.error(400,'INVALID_CODE','Неверный код. Проверьте шесть цифр в письме.')
            cur=c.execute('INSERT INTO users(username,username_key,email,email_key,password,created,verified) VALUES(?,?,?,?,?,?,?)',(p['username'],p['username_key'],p['email'],p['email_key'],p['password'],now(),now()))
            user=c.execute('SELECT * FROM users WHERE id=?',(cur.lastrowid,)).fetchone();token=self.new_session(c,user['id']);c.execute('DELETE FROM pending WHERE id=?',(pid,))
        self.reply(200,{'ok':True,'user':public_user(user)},self.cookie(token))
    def resend(self,data):
        if not self.rate('resend',10,3600):return
        pid=str(data.get('registrationId',''))
        with MAIL_LOCK:
            with connect() as c:p=c.execute('SELECT * FROM pending WHERE id=?',(pid,)).fetchone()
            if not p:return self.error(400,'EXPIRED','Начните регистрацию заново.')
            if p['sent']>now()-60:return self.error(429,'COOLDOWN','Подождите минуту перед повторной отправкой.')
            code=f'{secrets.randbelow(1000000):06d}'
            try:send_code(p['email'],code)
            except Exception as exc:
                print('SMTP failure:',type(exc).__name__,flush=True);return self.error(503,'EMAIL_SEND_FAILED','Письмо не отправлено. Попробуйте позже.')
            with connect() as c:c.execute('UPDATE pending SET code_hash=?,expires=?,sent=?,attempts=0 WHERE id=?',(digest(pid+':'+code),now()+TTL,now(),pid))
        self.reply(200,{'ok':True,'resendAfter':60,'expiresIn':TTL})
    def login(self,data):
        if not self.rate('login',20,900):return
        identifier=str(data.get('identifier','')).strip().casefold();password=data.get('password','')
        if not isinstance(password,str) or len(password)>256:return self.error(400,'PASSWORD','Некорректный пароль')
        with connect() as c:
            u=c.execute('SELECT * FROM users WHERE username_key=? OR email_key=?',(identifier,identifier)).fetchone()
            if not u:return self.error(404,'ACCOUNT_NOT_FOUND','Аккаунт на сервере не найден. Если регистрировались раньше, используйте тот же браузер и адрес сайта.')
            if u['password']=='!google-only':return self.error(401,'GOOGLE_LOGIN_REQUIRED','Для этого аккаунта используйте «Войти через Google». Пароль сайта не создавался.')
            if not password_ok(password,u['password']):return self.error(401,'WRONG_PASSWORD','Неверный пароль.')
            token=self.new_session(c,u['id'])
        self.reply(200,{'ok':True,'user':public_user(u)},self.cookie(token))

if __name__=='__main__':
    init_db()
    print(f'VertGames listening on 0.0.0.0:{PORT}. Email sending: {"configured" if configured() else "NOT CONFIGURED (set SMTP_HOST and SMTP_FROM)"}',flush=True)
    print('Google sign-in: '+('configured' if google_oauth.configured() else 'NOT CONFIGURED (see GOOGLE_AUTH_SETUP.md)'),flush=True)
    ThreadingHTTPServer(('0.0.0.0',PORT),Handler).serve_forever()
