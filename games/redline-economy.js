/* Local-game economy. These are points, not cash. Durable intent + idempotent catalog receipt. */
function redlineSettleStake(state,won){
 const bet=state.stake;if(!bet)return null;state.stake=null;
 let received=null,removed=null;
 if(won){if(!state.owned.includes(bet.prizeId)){state.owned.push(bet.prizeId);received=bet.prizeId}else state.cash+=7500;}
 else if(bet.ownedCount>=5&&state.owned.length>=5&&state.owned.includes(bet.carId)){
   state.owned=state.owned.filter(id=>id!==bet.carId);delete state.cars[bet.carId];removed=bet.carId;
   if(state.selected===bet.carId)state.selected=state.owned[0];
 }
 return{won,received,removed,bet};
}
function createRedlineExchange({state,account,save,toast,showSheet,canExchange}){
 const $=id=>document.getElementById(id);let ready=false,status='Запусти Redline из каталога под своим аккаунтом.',sending=false;
 const embedded=parent!==window&&location.origin!=='null';
 function post(data){if(embedded)parent.postMessage({...data,game:'redline',account},location.origin)}
 function refresh(){const p=state.exchange?.pending; $('exchangeCredits').textContent='₵ '+Math.floor(state.cash).toLocaleString('ru-RU');$('exchangeStatus').textContent=p?'1000 кредитов зарезервированы. '+status:status;$('exchangeDo').disabled=!ready||sending||(!p&&state.cash<1000)||!canExchange();$('exchangeDo').textContent=p?'Повторить подтверждение':'Обменять 1000 ₵ → 100 V';}
 function menu(){showSheet('exchange');refresh();post({type:'redlineExchangeHello'})}
 function request(){if(!ready||sending||!canExchange())return false;state.exchange ||= {};
   if(!state.exchange.pending){if(state.cash<1000)return false;const id=typeof crypto.randomUUID==='function'?crypto.randomUUID():`${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
     state.cash-=1000;state.exchange.pending={id,account,credits:1000,coins:100,created:Date.now()};
     if(!save()){state.cash+=1000;state.exchange.pending=null;status='Не удалось сохранить списание. Обмен не отправлен.';refresh();return false}
   }
   const p=state.exchange.pending;if(p.account!==account)return false;
   sending=true;status='Ожидание подтверждения каталога…';refresh();post({type:'redlineExchange',id:p.id,credits:1000,coins:100});
   setTimeout(()=>{if(sending){sending=false;status='Подтверждение ещё не получено. Повтори запрос — списания второй раз не будет.';refresh()}},4000);return true;
 }
 window.addEventListener('message',e=>{if(!embedded||e.source!==parent||e.origin!==location.origin)return;const d=e.data;if(d?.game!=='redline'||d.account!==account)return;
   if(d.type==='redlineExchangeReady'){ready=d.ready===true;status=ready?'Курс фиксирован: 1000 ₵ = 100 V. Перевод на текущий аккаунт.':'Обмен недоступен: войди в каталог и разреши локальное сохранение.';refresh();return}
   const p=state.exchange?.pending;if(d.type!=='redlineExchangeAck'||!p||p.id!==d.id)return;
   sending=false;
   if(d.ok===true){state.exchange.pending=null;state.exchange.lastId=p.id;save();status='Готово: +100 V на аккаунте каталога.';toast('Обмен выполнен · −1000 ₵ / +100 V',5)}
   else { // Never refund an ambiguous failure: retry this exact durable intent.
     status='Каталог не подтвердил перевод. Кредиты остаются в резерве; повтори подтверждение после восстановления сохранения.';
   }refresh();
 });
 $('exchangeBtn').onclick=menu;$('exchangeDo').onclick=request;post({type:'redlineExchangeHello'});refresh();return{menu,request,refresh,get ready(){return ready}};
}
if(typeof module!=='undefined')module.exports={redlineSettleStake};
