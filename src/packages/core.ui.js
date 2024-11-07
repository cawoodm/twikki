(function(tw) {

  const name = 'core.ui';
  const version = '0.0.1';
  const exports = {};

  // Exports
  // exports.notify = notify;

  // Run
  const run = () => {
    initUI();
  };

  return {name, version, exports, run};

  function initUI() {
    dp(99);
    let html = tw.run.getTiddler('$MainLayout').text;
    document.body.innerHTML = html;
    // tw.core.dom.htmlToNode
  }

});
