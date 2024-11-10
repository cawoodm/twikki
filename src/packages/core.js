(function(tw) {

  const name = 'twikki.core';
  const version = '0.0.1';

  console.log('TWIKKI Core started');
  tw.core = {};
  tw.events = (function() {
    const handlers = [];
    let initialized = false;
    return {
      init() {
        initialized = true;
      },
      send(event, params) {
        // dp('events.send', event, params);
        let result = [];
        handlers
          .filter(h => h.event === event)
          .forEach(h => {
            if (Array.isArray(params))
              result.push(h.handler(...params));
            else
              result.push(h.handler(params));
          });
        return result;
      },
      decode(params) {
        if (params?.match(/^---enc:/)) return decoder(params.substring(7));
        return params;
      },
      // TODO: Should have subscribe to listen and override to handle
      // handlerName is used to ensure we don't call the same function twice for the same event
      subscribe(event, handler, handlerName) {
        if (!initialized) throw new Error('Events not yet initialized!');
        if (!handlerName && typeof handler === 'string') {
          handlerName = handler;
          handler = eval(handlerName);
        }
        if (!handlerName) handlerName = handler.name;
        if (!handlerName) {
          console.warn(`No handlerName provided in events.subscribe(${event})!`);
          if (window.devMode) throw new Error(`No handlerName provided in events.subscribe(${event})!`);
        }
        // Prevent same handler function for same event
        if (handlers.find(h => h.event === event && h.handler.name === handlerName))
          return console.warn('Ignoring duplicate event handler', event, handlerName); // debugger;
        // dp('subscribe', event, handlerName);
        handlers.push({event, handler});
      },
      override(event, handler) {
        // Remove existing handlers
        handlers.filter(h => h.event === event).forEach(h => (delete h.event));
        // Add new handler
        handlers.push({event, handler});
      },
      handlers() {return handlers;},
      clear() {dp('clear'); handlers.length = 0;},
    };
    function decoder(encoded) {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return String.fromCharCode(...new Uint16Array(bytes.buffer));
    }
  })();

  tw.run = {
    getTiddler,
  };
  tw.macros = {};
  tw.extensions = {
    registerMacro,
  };
  tw.call = call;

  return {name, version};

  function call(functionName, ...args) {
    return eval(functionName)(...args);
  }
  function registerMacro(namespace, name, fcn, options) {
    if (!tw.macros[namespace]) tw.macros[namespace] = {};
    tw.macros[namespace][name] = fcn;
    if (options) Object.assign(tw.macros[namespace][name], options);
  }
  function getTiddler(title, includeRawShadow = true) {
    // TODO: This is case-senstive and allows duplicates like AAA + aaa
    let result = tw.tiddlers.all.find(titleIs(title));
    if (includeRawShadow === false && result?.isRawShadow === true) return undefined;
    return result;
  }
  function titleIs(title) {
    return t => t.title === title;
  }
});
