/* ==========================================================================
   Trainable: loads one training into the Power-Up player.

   The server writes the training into window.TRAINABLE before core.js runs
   (core.js needs storageKey to load the right saved progress). This file
   runs after components.js and before tracking.js and app.js. It sets the
   branding, glossary and levels, and turns the lesson data back into the
   shapes the renderers expect; then app.js boots exactly as in Power-Up.
   ========================================================================== */
(function () {
  'use strict';

  var PU = window.PU;
  var T = window.TRAINABLE || {};

  PU.brand = {
    name: T.company || '',
    product: T.product || 'LevelCrew',
    madeWith: 'LevelCrew',
    fileSlug: T.fileSlug || 'trainable',
    code: T.code || 'TR',
    logo: null,
    sheet: { url: T.progressUrl || '', key: '' },
    cta: T.cta || null
  };
  /* A personal invite link fills in the name and email the employer gave. */
  if (T.person && !T.preview) {
    if (!PU.state.name && T.person.name) PU.state.name = String(T.person.name).slice(0, 40);
    if (!PU.state.email && T.person.email) PU.state.email = String(T.person.email).slice(0, 80);
  }
  PU.GLOSSARY = T.glossary || {};
  if (T.ranks && T.ranks.length) PU.RANKS = T.ranks;

  /*
   * The prompt checker's word lists (core.js PU.RX) were written for food
   * brands and Indian cities, so "our freight company in Dubai" failed the
   * Context check. Each training adds its own company's words.
   */
  var vocab = T.vocab || {};
  Object.keys(vocab).forEach(function (k) {
    var orig = PU.RX[k];
    if (!orig || !vocab[k] || !vocab[k].length) return;
    var extra = PU.ruleTest({ all: [vocab[k]] });
    PU.RX[k] = {
      source: orig.source,
      test: function (t) {
        return orig.test(t) || extra(t);
      }
    };
  });

  /** Lesson data keeps pairs as objects; the renderers read arrays. */
  function pairs(list, a, b) {
    return (list || []).map(function (x) {
      return Array.isArray(x) ? x : [x[a], x[b]];
    });
  }

  /* Colours are optional in lesson data; these are LevelCrew's (no blues or violets). */
  var PALETTE = ['#ff4d6d', '#ff8a5c', '#00a676', '#e0418b', '#e89a00', '#13b5a6'];

  function withColors(list) {
    return (list || []).map(function (x, i) {
      return x.color ? x : Object.assign({}, x, { color: PALETTE[i % PALETTE.length] });
    });
  }

  function unblank(t) {
    return String(t).replace(/\{\{([^{}\n]{1,80})\}\}/g, '[$1]');
  }

  function prepStep(s) {
    var st = Object.assign({}, s);
    if (st.type === 'showdown') {
      if (st.a && !st.a.color) st.a = Object.assign({}, st.a, { color: '#9a8c91' });
      if (st.b && !st.b.color) st.b = Object.assign({}, st.b, { color: '#ff4d6d' });
    }
    if (st.type === 'builder' && st.slots) st.slots = withColors(st.slots);
    if (st.type === 'cards' && st.mnemonic) st.mnemonic = withColors(st.mnemonic);
    if (st.type === 'menu' && st.departments) st.departments = withColors(st.departments);
    if (st.type === 'hero' && st.meta) st.meta = pairs(st.meta, 'icon', 'text');
    if (st.type === 'mission' && st.moves) st.moves = pairs(st.moves, 'title', 'text');
    /* Typing boxes can't highlight a blank: show {{a detail}} there as [a detail]. */
    if (st.type === 'mission') {
      if (st.taskPlaceholder) st.taskPlaceholder = unblank(st.taskPlaceholder);
      if (st.fields) st.fields = st.fields.map(function (f) { return f.ph ? Object.assign({}, f, { ph: unblank(f.ph) }) : f; });
    }
    if (st.placeholder) st.placeholder = unblank(st.placeholder);
    if (st.type === 'write' && st.facts && st.facts.rows) st.facts = Object.assign({}, st.facts, { rows: pairs(st.facts.rows, 'k', 'v') });
    if (st.type === 'compare' && st.cols) {
      st.cols = st.cols.map(function (c) {
        return c.stat && !Array.isArray(c.stat) ? Object.assign({}, c, { stat: [c.stat.big, c.stat.label] }) : c;
      });
    }
    return st;
  }

  PU.levels = (T.levels || []).map(function (L, i) {
    return Object.assign({}, L, {
      color: L.color || 'var(--sw-' + (i % 13) + ')',
      steps: (L.steps || []).map(prepStep)
    });
  });

  /*
   * {{blanks}} mark a detail the company didn't give. Most fields show them as
   * a highlighted blank (core.js gaps()), but some renderers write plain text
   * (builder options, chat messages, cowork logs), where "{{...}}" would show
   * raw. This catches any that slip through, including text added later
   * (a chat turn appearing after Send). Typing boxes are left alone.
   */
  var GAP = /\{\{([^{}\n]{1,80})\}\}/;
  function blanks(root) {
    if (!root || !document.createTreeWalker) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!p || /^(TEXTAREA|INPUT|SCRIPT|STYLE)$/.test(p.nodeName) || (p.isContentEditable)) return NodeFilter.FILTER_REJECT;
        return GAP.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    var found = [];
    while (walker.nextNode()) found.push(walker.currentNode);
    found.forEach(function (n) {
      var frag = document.createDocumentFragment();
      var rest = n.nodeValue;
      var m;
      while ((m = GAP.exec(rest))) {
        if (m.index) frag.appendChild(document.createTextNode(rest.slice(0, m.index)));
        var span = document.createElement('span');
        span.className = 'gap';
        span.title = 'Fill in your own';
        span.textContent = m[1];
        frag.appendChild(span);
        rest = rest.slice(m.index + m[0].length);
      }
      if (rest) frag.appendChild(document.createTextNode(rest));
      n.parentNode.replaceChild(frag, n);
    });
  }
  if (window.MutationObserver) {
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      (window.requestAnimationFrame || setTimeout)(function () {
        pending = false;
        blanks(document.getElementById('app'));
      });
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  /* Copy and "Open in Claude" send {{a detail}} as [a detail], so the prompt reads naturally in Claude. */
  function plain(t) {
    return String(t == null ? '' : t).replace(/\{\{([^{}\n]{1,80})\}\}/g, '[$1]');
  }
  var copy = PU.copy, link = PU.claudeLink;
  PU.copy = function (text) { return copy(plain(text)); };
  PU.claudeLink = function (prompt) { return link(prompt ? plain(prompt) : prompt); };
})();
