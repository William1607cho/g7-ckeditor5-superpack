  // 코어 ActionDispatcher 가 있으면 수동 트리거용 핸들러도 등록 (레이아웃 onMount 등에서 호출 가능)
  function registerHandlers(retry) {
    var dispatcher = window.G7Core && window.G7Core.getActionDispatcher && window.G7Core.getActionDispatcher();
    if (dispatcher) {
      dispatcher.registerHandler(IDENTIFIER + '.render', function () { scan(document); }, { category: 'plugin', source: IDENTIFIER });
      return;
    }
    if (!retry) return;
    var tries = 0;
    var timer = window.setInterval(function () {
      var d = window.G7Core && window.G7Core.getActionDispatcher && window.G7Core.getActionDispatcher();
      if (d) {
        d.registerHandler(IDENTIFIER + '.render', function () { scan(document); }, { category: 'plugin', source: IDENTIFIER });
        window.clearInterval(timer);
      } else if (++tries >= 50) {
        window.clearInterval(timer);
      }
    }, 100);
  }

  function init() {
    registerHandlers(true);
    run();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.__G7Ckeditor5Superpack = { rescan: function () { scan(document); } };
