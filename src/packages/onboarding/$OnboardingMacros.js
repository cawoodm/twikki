// tags: $Script

// Action handlers (not macros — they have side effects and return undefined).
// Exposed on tw.run so inline onclick="" / event subscribers can call them.
tw.run.welcome = {
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
};

// Real macro: returns an HTML button.
tw.extensions.registerMacro('welcome', 'Step2Button', () => tw.ui.button('Click Me!', 'welcome.step2', 1), {
  description: 'Button that advances onboarding to step 2.',
  example: '<<welcome.Step2Button>>',
});

if (!tw.store.get('welcomeShown')) {
  // Only run once (localStorage)
  tw.events.send('ui.close.all');
  tw.run.welcome.Start();
  tw.store.set('welcomeShown', 1);
}
if (!tw.tmp.onboardingEvents) {
  tw.events.subscribe('welcome.step2', tw.run.welcome.Step2);
}
