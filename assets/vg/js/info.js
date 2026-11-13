/* Информационные страницы: поиск по FAQ и проверка доступности API. */
(function () {
  'use strict';
  var VG = window.VG;
  var $ = VG.$, $$ = VG.$$, T = VG.T, escapeHtml = VG.escapeHtml;

  document.addEventListener('DOMContentLoaded', function () {
    var search = $('#faqSearch');
    if (search) {
      search.addEventListener('input', VG.debounce(function () {
        var query = search.value.trim().toLowerCase();
        var visible = 0;
        $$('#faqList details').forEach(function (item) {
          var ok = !query || item.textContent.toLowerCase().indexOf(query) !== -1;
          item.hidden = !ok;
          if (ok) visible++;
        });
        var empty = $('#faqEmpty');
        if (empty) empty.classList.toggle('hidden', visible > 0);
      }, 120));
    }
    var probe = $('#probeBtn');
    if (probe) probe.addEventListener('click', function () {
      var box = $('#probeMsg');
      probe.disabled = true;
      box.className = 'msg';
      box.textContent = T('Проверяем…', 'Checking…');
      VG.api('/api/health').then(function (data) {
        box.className = 'msg ok';
        box.textContent = T(
          'Сервер отвечает. База данных: ' + data.backend + '. CAPTCHA: ' + (data.captcha.enabled ? 'включена' : 'выключена') +
          '. Платежи: ' + (data.payments ? 'подключены' : 'выключены') + '.',
          'Server is responding. Database: ' + data.backend + '. CAPTCHA: ' + (data.captcha.enabled ? 'enabled' : 'disabled') +
          '. Payments: ' + (data.payments ? 'configured' : 'disabled') + '.');
      }).catch(function (error) {
        box.className = 'msg err';
        box.textContent = error.message;
      }).then(function () { probe.disabled = false; });
    });
  });
})();
