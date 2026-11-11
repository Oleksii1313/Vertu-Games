/* Auth UI bridge. Email confirmation is performed by server.py, never simulated. */
(function(){
'use strict';
const $=id=>document.getElementById(id),VA=window.VA;
if(!VA)return;
let pending=null,migrating=false,busy=false,availabilityTimer=0,availabilitySeq=0,authEpoch=0;
try{pending=JSON.parse(sessionStorage.getItem('vg_pending_email')||'null')}catch(e){}
const style=document.createElement('style');style.textContent=`.auth-note{font-size:12px;line-height:1.6;color:var(--muted);margin:12px 0;overflow-wrap:anywhere}.email-status{border:1px solid var(--line);border-radius:12px;background:var(--card2);padding:12px;margin:14px 0}.email-status .btn{margin-top:8px;max-width:100%;white-space:normal}.verify-actions{display:flex;gap:8px;flex-wrap:wrap}.verify-actions .btn{flex:1;font-size:12px;padding:10px}.verification-code{font:700 24px monospace!important;letter-spacing:8px;text-align:center}.msg{overflow-wrap:anywhere}`;document.head.appendChild(style);
const form=document.createElement('form');form.id='formVerifyEmail';form.hidden=true;form.innerHTML='<p class="auth-note" id="verifyDescription"></p><label><span>Код из письма</span><input id="emailCode" class="verification-code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"></label><p class="auth-note">Код действует 10 минут. Если письма нет, проверьте «Спам».</p><button class="btn btn-primary" type="submit" style="width:100%">Подтвердить почту</button><div class="verify-actions" style="margin-top:10px"><button id="resendEmail" class="btn btn-ghost" type="button">Отправить ещё раз</button><button id="cancelVerification" class="btn btn-ghost" type="button">Назад</button></div>';
$('formReg').after(form);
const regNote=document.createElement('p');regNote.className='auth-note';regNote.textContent='Аккаунт создаётся только после ввода кода из настоящего письма. Уже регистрировались? Откройте вкладку «Вход».';$('formReg').appendChild(regNote);
const storageNote=document.createElement('p');storageNote.className='auth-note';storageNote.textContent='Старые аккаунты доступны в том же браузере и по тому же адресу сайта. Не нужно регистрироваться повторно.';$('formLogin').appendChild(storageNote);
const notice=document.createElement('div');notice.className='email-status';notice.id='emailStatus';notice.hidden=true;notice.innerHTML='<div id="emailStatusText" class="auth-note" style="margin:0"></div><button id="migrateAccount" class="btn btn-ghost" type="button">Подтвердить почту и сохранить аккаунт на сервере</button>';if($('profLogged'))$('profLogged').prepend(notice);
// Google uses a server-side code flow, not an email/password form or a fake picker.
const gt=(ru,en)=>document.body.getAttribute('lang')==='en'?en:ru;
const googleArea=document.createElement('div');googleArea.id='googleAuth';googleArea.className='google-auth';
googleArea.innerHTML='<button type="button" id="googleSignIn" class="google-button"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48"><path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24v7.42h11a9.4 9.4 0 0 1-4.08 6.18v5.14h6.61c3.87-3.56 6.08-8.82 6.08-14.82Z"/><path fill="#34A853" d="M24 44c5.4 0 9.92-1.79 13.23-4.86l-6.61-5.14c-1.83 1.23-4.17 1.98-6.62 1.98-5.22 0-9.64-3.52-11.22-8.26H5.95v5.3A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.78 27.72a12 12 0 0 1 0-7.44v-5.3H5.95a20 20 0 0 0 0 18.04l6.83-5.3Z"/><path fill="#EA4335" d="M24 12.02c2.94 0 5.57 1.01 7.65 3L37.4 9.3A19.3 19.3 0 0 0 24 4 20 20 0 0 0 5.95 14.98l6.83 5.3C14.36 15.54 18.78 12.02 24 12.02Z"/></svg><span class="label-ru">Войти через Google</span><span class="label-en">Sign in with Google</span></button><p class="auth-note"><span class="label-ru">Выберите аккаунт на странице Google. Пароль от почты сюда вводить не нужно.</span><span class="label-en">Choose your account on Google. Do not enter your email password here.</span></p><p class="auth-note" id="googleAvailability" role="status"></p><div class="google-divider"><span class="label-ru">или по email и паролю сайта</span><span class="label-en">or with email and site password</span></div>';
$('formLogin').before(googleArea);
const linkGoogle=document.createElement('button');linkGoogle.id='linkGoogle';linkGoogle.type='button';linkGoogle.className='btn btn-ghost';linkGoogle.hidden=true;linkGoogle.innerHTML='<span class="label-ru">Привязать Google к этому аккаунту</span><span class="label-en">Link Google to this account</span>';notice.appendChild(linkGoogle);
const googleStyle=document.createElement('style');googleStyle.textContent=`#authModal{padding:16px}#authModal>.panel{max-height:calc(100dvh - 32px);overflow:auto;overscroll-behavior:contain}#authModal .tabs{padding-right:28px}#authModal .close{min-width:44px;min-height:44px;top:6px;right:6px}#authModal button{min-height:44px}.google-auth{margin:18px 0}.google-auth[hidden],#linkGoogle[hidden]{display:none!important}.google-button{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:48px;min-width:44px;padding:10px 14px;background:#fff;border:1px solid #dadce0;border-radius:6px;color:#1f1f1f;font:500 14px system-ui,sans-serif;cursor:pointer}.google-button:hover{background:#f3f7fc}.google-button:focus-visible{outline:3px solid #66d0c7;outline-offset:3px}.google-button:disabled{opacity:.6;cursor:wait}.google-button svg{flex:0 0 20px}.google-divider{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:11px;margin:16px 0}.google-divider:before,.google-divider:after{content:'';height:1px;flex:1;background:var(--line)}#googleAvailability:empty{display:none}#linkGoogle{min-height:44px;white-space:normal}#authModal .auth-note{font-size:12px} @media(max-width:480px){#authModal>.panel{padding:20px}}`;document.head.appendChild(googleStyle);
const googleMessages={
 GOOGLE_LOGIN_REQUIRED:['Этот аккаунт создан через Google. Нажмите «Войти через Google» — пароля сайта у него нет.','This account was created with Google. Choose Sign in with Google; it has no site password.'],
 GOOGLE_NOT_CONFIGURED:['Вход через Google ещё не настроен владельцем сайта. Нужны сервер и ключи Google OAuth.','The owner has not configured Google sign-in yet. A server and Google OAuth credentials are required.'],
 BACKEND_UNAVAILABLE:['Сервер входа недоступен. Google-вход не работает из отдельного HTML или на статическом хостинге без сервера.','The sign-in server is unavailable. Google sign-in needs a backend, not just a standalone HTML file or static host.'],
 GOOGLE_CANCELLED:['Вы отменили вход через Google. Можно попробовать снова.','Google sign-in was cancelled. You can try again.'],
 GOOGLE_STATE_INVALID:['Сеанс Google-входа истёк или cookie недоступны. Откройте сайт в отдельной вкладке и начните снова.','The Google sign-in attempt expired or cookies are unavailable. Open the site in its own tab and try again.'],
 GOOGLE_TOKEN_FAILED:['Не удалось безопасно подтвердить ответ Google. Попробуйте снова; если ошибка повторяется, проверьте настройки OAuth.','The Google response could not be verified safely. Try again; if it persists, check the OAuth configuration.'],
 GOOGLE_EMAIL_UNVERIFIED:['Google не подтвердил адрес почты. Используйте регистрацию с кодом из письма.','Google did not verify this email. Use registration with an emailed code.'],
 GOOGLE_EMAIL_EXTERNAL:['Для этого способа подтверждения нужен Gmail или Google Workspace. Для внешнего адреса используйте код из письма.','This verification method supports Gmail and Google Workspace. Use an emailed code for an external address.'],
 GOOGLE_ACCOUNT_EXISTS:['Этот email уже есть на сервере. Войдите прежним способом, затем в профиле нажмите «Привязать Google». Аккаунты не объединяются автоматически.','This email already has a server account. Sign in with your existing method, then choose Link Google in your profile. Accounts are not merged automatically.'],
 GOOGLE_LINK_SESSION:['Для привязки нужно оставаться в том же серверном аккаунте. Войдите заново и повторите.','Linking requires the same active server session. Sign in again and retry.'],
 GOOGLE_LINK_EMAIL:['Выберите Google-аккаунт с той же почтой, что указана в профиле.','Choose the Google account with the same email as your profile.'],
 GOOGLE_ACCOUNT_CONFLICT:['Этот Google-аккаунт или адрес уже связан с другой записью. Данные не объединены.','This Google account or email is associated with a different record. No records were merged.'],
 LOGIN_REQUIRED:['Сначала войдите в существующий серверный аккаунт.','First sign in to your existing server account.']
};
function googleMessage(code){const pair=googleMessages[code]||googleMessages.GOOGLE_TOKEN_FAILED;return gt(...pair)}
let googleAvailable=null,googleBackend=null;
function googleVisibility(){const name=VA.getCurrentUser(),u=name&&VA.getUser(name);googleArea.hidden=!!name||!!pending||migrating;linkGoogle.hidden=!(u?.authSource==='server'&&u.emailVerified&&!u.googleLinked);$('googleAvailability').textContent=googleBackend===false?googleMessage('BACKEND_UNAVAILABLE'):googleAvailable===false?googleMessage('GOOGLE_NOT_CONFIGURED'):''}
new MutationObserver(googleVisibility).observe(document.body,{attributes:true,attributeFilter:['lang']});
async function beginGoogle(mode='login'){
 if(busy)return;
 if(mode==='link'){if(oldToggleProfile)oldToggleProfile(false);oldToggleAuth(true);window.openTab('acct')}
 if(window.self!==window.top){msg(gt('Для входа через Google откройте сам сайт в отдельной вкладке, а не во встроенном предпросмотре.','For Google sign-in, open the site in its own tab, not in an embedded preview.'));return}
 if(!/^https?:$/.test(location.protocol)){msg(googleMessage('BACKEND_UNAVAILABLE'));return}
 setBusy(true);msg(gt('Подключаемся к Google…','Connecting to Google…'),false);
 try{
  const next=location.pathname.split('/').pop()||'index.html';
  const r=await api('/api/auth/google/start',{mode,next,lang:document.body.getAttribute('lang')==='en'?'en':'ru'});
  if(!r.ok){msg(googleMessages[r.code]?googleMessage(r.code):r.msg);return}
  const destination=new URL(r.url);if(destination.origin!=='https://accounts.google.com'||destination.pathname!=='/o/oauth2/v2/auth')throw Error('Invalid authorization URL');
  location.assign(destination.href);
 }catch{msg(googleMessage('GOOGLE_TOKEN_FAILED'))}finally{setBusy(false)}
}
$('googleSignIn').onclick=()=>beginGoogle('login');linkGoogle.onclick=()=>beginGoogle('link');
const googleQuery=new URLSearchParams(location.search),googleOutcome=googleQuery.get('google_login'),googleError=googleQuery.get('google_error');
if(googleOutcome||googleError){
 try{const clean=new URL(location.href);clean.searchParams.delete('google_login');clean.searchParams.delete('google_error');history.replaceState(null,'',clean.pathname+clean.search+clean.hash)}catch{}
 if(['ru','en'].includes(googleQuery.get('lang'))&&typeof window.setLang==='function')window.setLang(googleQuery.get('lang'));
}

function msg(text,error=true){const m=$('authMsg');m.textContent=text||'';m.className='msg'+(error?' err':'');m.setAttribute('role',error?'alert':'status')}
async function api(path,data){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
 try{const response=await fetch(path,{method:data===undefined?'GET':'POST',credentials:'same-origin',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:controller.signal});
  if(!(response.headers.get('content-type')||'').includes('application/json'))throw Error('No API');const result=await response.json();return {...result,status:response.status};
 }catch(e){return {ok:false,code:'BACKEND_UNAVAILABLE',msg:'Сервер аккаунтов недоступен. Владельцу нужно запустить server.py и настроить SMTP для писем или Google OAuth для Google-входа. Старый локальный аккаунт можно открыть через «Вход».'}}
 finally{clearTimeout(timeout)}
}
function pendingSave(){try{pending?sessionStorage.setItem('vg_pending_email',JSON.stringify(pending)):sessionStorage.removeItem('vg_pending_email')}catch(e){}}
function setBusy(value){busy=value;for(const b of document.querySelectorAll('#formLogin button,#formReg button,#formVerifyEmail button,#googleSignIn,#linkGoogle'))b.disabled=value;updateResend()}
function updateResend(){const b=$('resendEmail');const remaining=pending?Math.max(0,Math.ceil((pending.resendAt-Date.now())/1000)):0;b.disabled=busy||remaining>0;b.textContent=remaining?`Повторить через ${remaining} с`:'Отправить ещё раз'}
setInterval(updateResend,1000);
function emailStatus(){googleVisibility();const name=VA.getCurrentUser(),user=name?VA.getUser(name):null;notice.hidden=!user;if(!user)return;
 $('emailStatusText').textContent=user.authSource==='server'&&user.emailVerified?`Почта подтверждена: ${user.email}. Аккаунт хранится на сервере.`:'Локальный аккаунт: почта ещё не подтверждена. На другом устройстве он недоступен. Подтвердите адрес, чтобы сохранить вход на сервере.';
 if(user.googleLinked)$('emailStatusText').textContent=gt('Почта подтверждена: '+user.email+'. Google привязан к аккаунту.','Email verified: '+user.email+'. Google is linked to this account.');
 $('migrateAccount').hidden=user.authSource==='server'&&user.emailVerified;
}
function refresh(){const name=VA.getCurrentUser();if(typeof logged!=='undefined')logged=name;
 if(typeof refreshAccount==='function')refreshAccount();if(typeof updateCoin==='function')updateCoin();if(typeof applyMetaToHeader==='function')applyMetaToHeader();if(typeof renderFreeNote==='function')renderFreeNote();emailStatus();
}
window.getCurrentUser=()=>VA.getCurrentUser();window.setCurrent=name=>VA.setCurrent(name);
const oldToggleProfile=window.toggleProfile;
if(oldToggleProfile)window.toggleProfile=function(open){oldToggleProfile(open);emailStatus()};
const oldTab=window.openTab;
window.openTab=function(tab){form.hidden=true;msg('');oldTab(tab);googleVisibility();if(tab==='reg'){migrating=false;window.bindRegChecks()}};
function showVerification(){
 if(!pending)return;oldTab('verify');form.hidden=false;googleVisibility();
 for(const id of ['formLogin','formReg','accountPanel'])if($(id))$(id).style.display='none';
 $('verifyDescription').textContent=`Отправили код на ${pending.email}. Введите его ниже — до подтверждения аккаунт не создаётся.`;
 updateResend();$('emailCode').focus();
}
const oldToggleAuth=window.toggleAuth;
window.toggleAuth=function(open){oldToggleAuth(open);if(open){refresh();if(pending)showVerification();else if(migrating)oldTab('login')}};
function saveServerUser(user){
 const all=VA.getUsers(),old=all[user.username],same=old&&String(old.email||'').toLowerCase()===user.email.toLowerCase();
 if(old&&!same){try{localStorage.setItem('vg_legacy_backup_'+Date.now(),JSON.stringify(old))}catch(e){}}
 const record=Object.assign({balance:100,banned:false,owned:['av:rocket','col:teal','t:new'],avatar:'av:rocket',color:'col:teal',title:'t:new'},same?old:{},user);
 delete record.pass;delete record.salt;all[user.username]=record;VA.saveUsers(all);VA.setCurrent(user.username);
 try{localStorage.removeItem('vg_signed_out')}catch(e){}refresh();
}
function signedIn(name,local=false){authEpoch++;VA.setCurrent(name);refresh();$('authModal').classList.remove('open');$('lgPass').value='';$('rgPass').value='';$('rgPass2').value='';msg('');if(typeof showToast==='function')showToast(local?'Вход выполнен в локальный аккаунт. Почту можно подтвердить в профиле.':'Вы вошли как '+name)}
async function beginRegistration(username,email,password){
 const result=await api('/api/auth/register',{username,email,password});if(!result.ok){msg(result.msg);return false}
 pending={id:result.registrationId,email:result.email,username,resendAt:Date.now()+result.resendAfter*1000};pendingSave();$('lgPass').value='';$('rgPass').value='';$('rgPass2').value='';msg('');showVerification();return true;
}
window.doLogin=async function(e){e.preventDefault();if(busy)return;msg('');const identifier=$('lgUser').value.trim(),password=$('lgPass').value;setBusy(true);
 try{
  const local=VA.loginCheck(identifier,password);
  if(migrating){if(!local.ok){msg(local.msg);return}const user=VA.getUser(local.username);if(!VA.isValidEmail(user.email||'')){msg('В старом аккаунте нет корректной почты. Для переноса обратитесь к владельцу сайта.');return}await beginRegistration(local.username,user.email,password);return}
  // Legacy logins remain usable without SMTP, and never create another account.
  if(local.ok){signedIn(local.username,true);return}
  const result=await api('/api/auth/login',{identifier,password});
  if(result.ok){saveServerUser(result.user);signedIn(result.user.username);return}
  if(result.code==='ACCOUNT_NOT_FOUND'||result.code==='BACKEND_UNAVAILABLE'){
   const known=VA.usernameTaken(identifier)||VA.findByEmail(identifier);msg(known?local.msg:result.msg);
  }else msg(googleMessages[result.code]?googleMessage(result.code):result.msg);
 }finally{setBusy(false)}
};
window.doRegister=async function(e){e.preventDefault();if(busy)return;msg('');const username=$('rgUser').value.trim(),email=$('rgEmail').value.trim().toLowerCase(),password=$('rgPass').value;
 if(!username){msg('Введите ник');return}if(!VA.isValidEmail(email)){msg('Некорректный email');return}if(password.length<4){msg('Пароль от 4 символов');return}if(password!==$('rgPass2').value){msg('Пароли не совпадают');return}
 if(VA.usernameTaken(username)||VA.emailTaken(email)){msg('Этот ник или email уже есть в этом браузере. Используйте вкладку «Вход», затем подтвердите почту в профиле.');return}
 setBusy(true);try{await beginRegistration(username,email,password)}finally{setBusy(false)}
};
form.onsubmit=async function(e){e.preventDefault();if(busy||!pending)return;setBusy(true);msg('');try{const result=await api('/api/auth/verify',{registrationId:pending.id,code:$('emailCode').value.trim()});if(!result.ok){msg(result.msg);return}pending=null;pendingSave();migrating=false;form.hidden=true;$('emailCode').value='';saveServerUser(result.user);signedIn(result.user.username)}finally{setBusy(false)}};
$('resendEmail').onclick=async()=>{if(busy||!pending)return;setBusy(true);msg('');try{const r=await api('/api/auth/resend',{registrationId:pending.id});if(!r.ok){msg(r.msg);return}pending.resendAt=Date.now()+r.resendAfter*1000;pendingSave();msg('Новое письмо отправлено. Используйте последний код.',false)}finally{setBusy(false)}};
$('cancelVerification').onclick=()=>{pending=null;pendingSave();migrating=false;form.hidden=true;window.openTab('login')};
$('migrateAccount').onclick=()=>{const name=VA.getCurrentUser();if(!name)return;pending=null;pendingSave();migrating=true;if(oldToggleProfile)oldToggleProfile(false);oldToggleAuth(true);oldTab('login');form.hidden=true;$('lgUser').value=name;msg('Введите текущий пароль. После проверки мы отправим код на почту этого аккаунта.',false)};
window.logout=async()=>{authEpoch++;pending=null;pendingSave();migrating=false;VA.setCurrent(null);try{localStorage.setItem('vg_signed_out','1')}catch(e){}refresh();if(oldToggleProfile)oldToggleProfile(false);oldToggleAuth(false);await api('/api/auth/logout',{});};
window.checkRegInputs=function(){
 const seq=++availabilitySeq;clearTimeout(availabilityTimer);const name=$('rgUser').value.trim(),email=$('rgEmail').value.trim(),hint=$('regHint');if(!hint)return;
 const localMessage=name&&VA.usernameTaken(name)?'Этот ник уже зарегистрирован. Используйте вход.':email&&!VA.isValidEmail(email)?'Некорректный email':email&&VA.emailTaken(email)?'Эта почта уже зарегистрирована. Используйте вход.':'';
 hint.textContent=localMessage;hint.className='reg-hint'+(localMessage?' bad':'');if(localMessage||(!name&&!email))return;
 availabilityTimer=setTimeout(async()=>{const result=await api('/api/auth/availability?'+new URLSearchParams({username:name,email}));if(seq!==availabilitySeq)return;
  if(result.ok){const taken=result.usernameTaken||result.emailTaken;hint.textContent=taken?'Ник или email уже зарегистрирован на сервере. Используйте вход.':email?'Формат корректен. Для регистрации понадобится код из письма.':'';hint.className='reg-hint'+(taken?' bad':'')}
 },300);
};
window.bindRegChecks=function(){for(const id of ['rgUser','rgEmail']){const field=$(id);if(!field._authBound){field.addEventListener('input',window.checkRegInputs);field._authBound=true}}window.checkRegInputs()};
// Recover a valid server session; preserve unverified legacy accounts in this browser.
(async()=>{const epoch=authEpoch,result=await api('/api/auth/session');if(epoch!==authEpoch)return;let signedOut=false;try{signedOut=localStorage.getItem('vg_signed_out')==='1'}catch(e){}
 googleBackend=!!result.ok;googleAvailable=result.ok?!!result.googleConfigured:null;
 const fromGoogle=['success','linked'].includes(googleOutcome)&&result.ok&&result.user?.googleLinked;
 if(result.ok&&result.user&&(!signedOut||fromGoogle))saveServerUser(result.user);
 else if(result.ok&&!result.user){const name=VA.getCurrentUser(),user=name&&VA.getUser(name);if(user?.authSource==='server')VA.setCurrent(null)}
 refresh();
 if(fromGoogle){pending=null;pendingSave();migrating=false;form.hidden=true;signedIn(result.user.username);googleVisibility();if(googleOutcome==='linked'&&typeof showToast==='function')showToast(gt('Google привязан. Можно входить обоими способами.','Google linked. Both sign-in methods are available.'))}
 else if(googleError||googleOutcome){window.toggleAuth(true);window.openTab(VA.getCurrentUser()?'acct':'login');msg(googleMessage(googleError||'GOOGLE_TOKEN_FAILED'))}
 if(!VA.storageStatus().persistent)storageNote.textContent='Браузер не разрешает постоянное локальное хранение. Старые аккаунты здесь могут быть недоступны. Для регистрации и серверного входа откройте сайт по его обычному адресу.';
})();
})();
