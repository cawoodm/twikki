/**
 * Core (twikki.core)
 * Bootstraps `tw.events` — the pub/sub bus (send/subscribe/override) with a
 * duplicate-handler guard. Note `send` passes params through verbatim; only
 * `tw.events.decode` (called by sendCommand) decodes `---enc:` base64 payloads
 * (via `tw.core.common.decoder`).
 * Loads after core.common (which must come first in modulesToLoad).
 */
(function (tw) {
  const name = 'twikki.core';
  const version = '0.25.0';
  const platform = '0.24.0'; // built for platform ^0.24.0

  dp('TWikki Core started');
  tw.events = (function () {
    const handlers = [];
    let initialized = false;
    return {
      init() {
        initialized = true;
      },
      send(event, params) {
        dp('events.send', event);
        let result = [];
        handlers
          .filter(h => h.event === event)
          .forEach(h => {
            if (Array.isArray(params)) result.push(h.handler(...params));
            else result.push(h.handler(params));
          });
        return result;
      },
      decode(params) {
        if (typeof params === 'string' && params.match(/^---enc:/))
          return tw.core.common.decoder(params.substring(7));
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
          if (window.devMode)
            throw new Error(`No handlerName provided in events.subscribe(${event})!`);
        }
        // Prevent same handler function for same event
        if (handlers.find(h => h.event === event && h.handler.name === handlerName))
          return console.warn('Ignoring duplicate event handler', event, handlerName); // debugger;
        // dp('subscribe', event, handlerName);
        handlers.push({event, handler});
      },
      override(event, handler) {
        if (typeof handler === 'string') handler = eval(handler);
        // Remove existing handlers
        handlers.filter(h => h.event === event).forEach(h => delete h.event);
        // Add new handler
        this.subscribe(event, handler);
      },
      handlers() {
        return handlers;
      },
      clear() {
        dp('clear');
        handlers.length = 0;
      },
    };
  })();

  return {name, version, platform};
});
