tw.macros.welcome = {
  Start() {
    tw.core.dom.$('header').style.display = 'none';
    tw.core.dom.$('sidebar').style.display = 'none';
    tw.run.showTiddler('Welcome');
  },
  Step1() {
    tw.run.showTiddler('Congratulations');
    tw.run.closeTiddler('Welcome');
  },
  Step2() {
    tw.core.dom.$('header').style.display = '';
    tw.core.dom.$('sidebar').style.display = '';
    tw.run.closeTiddler('Congratulations');
    tw.run.showTiddler('Help');
  },
  Step2Button() {
    return tw.ui.button('Click Me!', 'welcome.step2', 1);
  },
};

if (!tw.store.get('welcomeShown')) {
  // Only run once (localStorage)
  tw.events.send('ui.close.all');
  tw.macros.welcome.Start();
  tw.store.set('welcomeShown', 1);
}
if (!tw.tmp.onboardingEvents) {
  tw.events.subscribe('welcome.step2', tw.macros.welcome.Step2);
}
