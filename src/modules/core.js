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
  const platform = '0.26.0'; // built for platform ^0.26.0

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
        tw.logging.break(event);
        let result = [];
        handlers
          .filter(h => h.event === event)
          .forEach(h => {
            if (Array.isArray(params)) result.push(h.handler(...params));
            else result.push(h.handler(params));
          });
        return result;
      },
      // First non-null/undefined result wins; later subscribers don't run. The
      // single-handler convention behind today's 'markdown.render' generalised
      // for renderer.override etc. Subscribers that throw are caught and
      // skipped, matching the soft stance of the rest of the bus.
      request(event, params) {
        dp('events.request', event);
        const matching = handlers.filter(h => h.event === event);
        for (const h of matching) {
          let r;
          try {
            r = Array.isArray(params) ? h.handler(...params) : h.handler(params);
          } catch (e) {
            console.warn(`events.request '${event}' handler threw: ${e.message}`, e.stack);
            continue;
          }
          if (r != null) return r;
        }
        return undefined;
      },
      // Chain `value` through subscribers; each returns the next value. A
      // subscriber that returns `undefined` is treated as a no-op (value
      // passes through unchanged) — symmetric with `request()` and prevents
      // a forgotten `return` from silently poisoning the chain. To explicitly
      // set the value to empty, return `''`. Throws are caught — the failing
      // handler is skipped and the previous value is passed on. Empty
      // subscriber list returns the original value unchanged.
      filter(event, value, ctx) {
        dp('events.filter', event);
        let current = value;
        handlers
          .filter(h => h.event === event)
          .forEach(h => {
            try {
              const next = h.handler(current, ctx);
              if (next !== undefined) current = next;
            } catch (e) {
              console.warn(`events.filter '${event}' handler threw: ${e.message}`, e.stack);
            }
          });
        return current;
      },
      decode(params) {
        if (typeof params === 'string' && params.match(/^---enc:/)) return tw.core.common.decoder(params.substring(7));
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
        if (handlers.find(h => h.event === event && h.handler.name === handlerName)) return dp('Ignoring duplicate event handler', event, handlerName);
        dp('subscribe', event, handlerName);
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
