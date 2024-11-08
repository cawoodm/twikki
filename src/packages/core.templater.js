(function(tw) {

  const name = 'core.templater';
  const version = '0.0.1';

  let blockregex = /\{\{(([@!]?)(.+?))\}\}(([\s\S]+?)(\{\{:\1\}\}([\s\S]+?))?)\{\{\/\1\}\}/g;
  let valregex = /\{\{([=%])(.+?)\}\}/g;

  // Exports
  const exports = {
    Templater,
  };

  Templater.prototype.render = function (vars) {
    return render(this.t, vars);
  };

  const run = () => {};

  return {name, version, exports, run};

  // Based on https://github.com/jasonmoo/t.js
  function Templater(template) {
    this.t = template;
  }
  function scrub(val) {
    return new Option(val).innerHTML.replace(/"/g, '&quot;');
  }
  function get_value(vars, key) {
    let parts = key.split('.');
    while (parts.length) {
      if (!(parts[0] in vars)) return false;
      vars = vars[parts.shift()];
    }
    return vars;
  }
  function render(fragment, vars) {
    return fragment
      .replace(blockregex, function(_, __, meta, key, inner, if_true, has_else, if_false) {
        let val = get_value(vars, key);
        let temp = '';
        if (!val) {
          if (meta === '!') return render(inner, vars);
          if (has_else) return render(if_false, vars);
          return '';
        }
        if (!meta) return render(if_true, vars);
        if (meta === '@') {
          _ = vars._key;
          __ = vars._val;
          for (let i in val) {
            if (val.hasOwnProperty(i)) {
              vars._key = i;
              vars._val = val[i];
              temp += render(inner, vars);
            }
          }
          vars._key = _;
          vars._val = __;
          return temp;
        }
        return '';
      })
      .replace(valregex, function(_, meta, key) {
        let val = get_value(vars, key);
        if (val || val === 0) return meta === '%' ? scrub(val) : val;
        return '';
      });
  }

});
