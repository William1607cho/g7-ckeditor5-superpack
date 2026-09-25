  function t(key, fallback) {
    var translate = window.G7Core && window.G7Core.t;
    if (typeof translate !== 'function') return fallback;
    var full = IDENTIFIER + '.' + key;
    var r = translate(full);
    return (typeof r === 'string' && r !== full) ? r : fallback;
  }

