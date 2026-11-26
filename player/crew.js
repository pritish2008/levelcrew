/* ==========================================================================
   LevelCrew: the game around the lessons. The server side is
   trainable/game.py.

   - Streaks: days in a row with at least one step done, on the person's own
     calendar. Reported as streak, bestStreak and days.
   - Desk missions: the end of each level asks people to do one of their
     team's real jobs with Claude today.
   - Wins: "Log a win" keeps the job and how long it took before and with
     Claude. Self-reported, and always labelled so. A little XP, a few times
     a day. Reported as the list "wins" (removed ones as "winsGone").
   - The team board: first names, level, XP and streak of everyone on the
     training. Anyone can hide (reported as boardHidden: 1).
   - Carry on from another device: the place is saved on the server behind a
     secret resume key, joined with what the person's other devices saved.
     The personal invite link, a "carry on" link made in Settings, or opening
     the training on a device that saved before brings it back.

   The free sample and the owner's preview have no server to talk to: the
   board there is a clearly labelled example, and nothing leaves the browser.
   Runs after tracking.js and before app.js.
   ========================================================================== */
(function () {
  'use strict';

  var PU = window.PU;
  var h = PU.h;
  var T = window.TRAINABLE || {};
  var m = /^(\/api\/t\/[^/?#]+)\/progress(?:\?|$)/.exec(T.progressUrl || '');
  var API = m ? m[1] : '';
  var crew = (PU.crew = {});

  var MAX_WINS = 100;
  var WIN_XP = 15;
  var XP_WINS_A_DAY = 3;
  var BEFORE = [5, 10, 15, 30, 45, 60, 90, 120, 240];
  var WITH = [1, 2, 5, 10, 15, 20, 30, 45, 60];

  /** True on a real training (a staff or personal link), false in the sample and previews. */
  crew.live = function () {
    return !!API && !T.preview;
  };
  /** Things are kept and sent only on a real training, outside Preview mode. */
  function keeping() {
    return crew.live() && !PU.state.preview;
  }
  function data() {
    var d = PU.state.data;
    if (!d || typeof d !== 'object') d = PU.state.data = {};
    return d;
  }
  function plain(t) {
    return String(t == null ? '' : t).replace(/==|\*\*/g, '');
  }
  function obj(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x);
  }

  /* ---------- days and streaks ---------- */

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }
  function dayKey(t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  /** The day `n` days after `key` (YYYY-MM-DD), on the local calendar. */
  function shiftDay(key, n) {
    var p = key.split('-');
    return dayKey(new Date(+p[0], +p[1] - 1, +p[2] + n, 12).getTime());
  }
  function days() {
    var d = data().days;
    if (!obj(d)) d = data().days = {};
    return d;
  }
  crew.today = function () {
    return dayKey(Date.now());
  };

  /** { now: days in a row (today, or up to yesterday), best, days: days played, today: played today } */
  crew.streak = function () {
    var D = days();
    var today = crew.today();
    var k = D[today] ? today : shiftDay(today, -1);
    var now = 0;
    while (D[k] && now < 1000) {
      now++;
      k = shiftDay(k, -1);
    }
    var keys = Object.keys(D)
      .filter(function (x) {
        return /^\d{4}-\d\d-\d\d$/.test(x);
      })
      .sort();
    var best = 0;
    var run = 0;
    var prev = null;
    keys.forEach(function (x) {
      run = prev && shiftDay(prev, 1) === x ? run + 1 : 1;
      prev = x;
      if (run > best) best = run;
    });
    best = Math.max(best, now, +data().bestStreak || 0);
    return { now: now, best: best, days: keys.length, today: !!D[today] };
  };

  /** A step was done for the first time: today counts towards the streak. */
  crew.markDay = function () {
    if (PU.state.preview) return;
    var D = days();
    var k = crew.today();
    if (D[k]) return;
    D[k] = 1;
    var keys = Object.keys(D).sort();
    while (keys.length > 400) delete D[keys.shift()];
    var s = crew.streak();
    if (s.best > (+data().bestStreak || 0)) data().bestStreak = s.best;
    PU.save();
    PU.emit('streak', s);
    if (s.now > 1) PU.toast(s.now + ' days in a row. Keep it going!', { icon: 'flame', ms: 2600 });
  };

  /** The last 7 days, oldest first: [{ key, on, label }] */
  crew.week = function () {
    var D = days();
    var today = crew.today();
    var names = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    var out = [];
    for (var i = 6; i >= 0; i--) {
      var k = shiftDay(today, -i);
      var p = k.split('-');
      out.push({ key: k, on: !!D[k], label: names[new Date(+p[0], +p[1] - 1, +p[2], 12).getDay()], today: i === 0 });
    }
    return out;
  };

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  crew.streakCard = function () {
    var s = crew.streak();
    var line = s.today ? 'Done for today. Come back tomorrow to keep it going.' : s.now ? 'Do one step today to keep it going.' : s.days ? 'Do one step today to start a new streak.' : '';
    return h(
      'div.streak-card',
      h(
        'div.streak-top',
        h('span.streak-flame', { class: s.now ? 'is-on' : '' }, PU.icon('flame')),
        h(
          'div',
          h('div.streak-num', s.now ? plural(s.now, 'day', 'days') + ' in a row' : 'Start a streak'),
          h('div.streak-best', s.days ? 'Best: ' + plural(s.best, 'day', 'days') + ' · Played on ' + plural(s.days, 'day', 'days') : 'Do at least one step a day.')
        )
      ),
      h(
        'div.streak-week',
        { role: 'img', 'aria-label': 'The last 7 days' },
        crew.week().map(function (d) {
          return h('span', { class: (d.on ? 'is-on' : '') + (d.today ? ' is-today' : ''), title: d.key }, h('i'), h('b', d.label));
        })
      ),
      line ? h('div.streak-line', line) : null
    );
  };

  /* ---------- the team's real jobs ---------- */

  /** Jobs for desk missions and wins: the team's real jobs ({name, use, levels}). */
  crew.jobs = function () {
    var out = [];
    (T.tasks || []).forEach(function (t) {
      if (t && t.name && out.length < 12) out.push({ name: plain(t.name).slice(0, 80), use: t.use || 'ok', levels: t.levels || [] });
    });
    if (!out.length && !API && !T.preview) {
      // The free sample has no team: use the example jobs from its final mission.
      PU.levels.forEach(function (L) {
        L.steps.forEach(function (st) {
          if (st.type === 'mission' && st.examples)
            st.examples.forEach(function (x) {
              if (out.length < 8) out.push({ name: plain(x).slice(0, 80), use: 'ok', levels: [] });
            });
        });
      });
    }
    return out;
  };

  function mainLevels() {
    return PU.levels.filter(function (L) {
      return !L.optional;
    });
  }

  /** The job for a level's desk mission: one the level used, else the next one round. */
  crew.jobFor = function (L) {
    var jobs = crew.jobs();
    if (!jobs.length) return null;
    var i = Math.max(0, mainLevels().indexOf(L));
    var mine = jobs.filter(function (j) {
      return j.levels.indexOf(L.id) >= 0;
    });
    return mine.length ? mine[i % mine.length] : jobs[i % jobs.length];
  };

  /* ---------- wins ---------- */

  crew.wins = function () {
    var w = data().wins;
    if (!Array.isArray(w)) w = data().wins = [];
    return w;
  };
  function gone() {
    var g = data().winsGone;
    if (!Array.isArray(g)) g = data().winsGone = [];
    return g;
  }
  /** The same clean-up the server does (interview.clean_answer), so what people see is what's shared. */
  function scrub(t) {
    return String(t || '')
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email removed]')
      .replace(/(^|[^\w])\+?\d[\d \-()]{8,}\d(?!\w)/g, '$1[number removed]');
  }
  crew.scrub = scrub;

  function newId() {
    return 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  crew.mins = function (n) {
    n = Math.round(n || 0);
    if (n < 60) return n + ' min';
    var hh = Math.floor(n / 60);
    var mm = n % 60;
    return hh + ' h' + (mm ? ' ' + mm + ' min' : '');
  };

  /** How many wins, and the time they saved in all (before minus with Claude). */
  crew.winTotals = function () {
    var w = crew.wins();
    var saved = 0;
    w.forEach(function (x) {
      saved += (+x.before || 0) - (+x.after || 0);
    });
    return { count: w.length, saved: saved };
  };

  function xpLeftToday() {
    var per = data().winXp;
    return XP_WINS_A_DAY - ((obj(per) && per[crew.today()]) || 0);
  }

  crew.addWin = function (win) {
    if (PU.state.preview) {
      PU.toast('Preview mode is on, so nothing is saved.', { icon: 'eye' });
      return null;
    }
    var w = {
      id: newId(),
      level: win.level || '',
      task: scrub(win.task).replace(/\s+/g, ' ').trim().slice(0, 80),
      before: Math.max(0, Math.min(600, Math.round(win.before))),
      after: Math.max(0, Math.min(600, Math.round(win.after))),
      note: scrub(win.note).replace(/\s+/g, ' ').trim().slice(0, 200),
      at: Math.round(Date.now() / 1000)
    };
    var list = crew.wins();
    list.push(w);
    while (list.length > MAX_WINS) list.shift();
    var got = 0;
    if (xpLeftToday() > 0) {
      var per = obj(data().winXp) ? data().winXp : (data().winXp = {});
      var today = crew.today();
      per[today] = (per[today] || 0) + 1;
      var old = shiftDay(today, -14);
      Object.keys(per).forEach(function (k) {
        if (k < old) delete per[k];
      });
      got = PU.award('win:' + w.id, WIN_XP, 'Win logged');
    }
    PU.save();
    PU.emit('wins');
    if (!got) PU.toast('Win logged. Wins earn XP ' + XP_WINS_A_DAY + ' times a day.', { icon: 'check', ms: 3000 });
    sendSoon();
    crew.saveSoon();
    return w;
  };

  crew.removeWin = function (id) {
    var list = crew.wins();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list.splice(i, 1);
        var g = gone();
        g.push(id);
        if (g.length > 400) g.splice(0, g.length - 400);
        PU.save();
        PU.emit('wins');
        sendSoon();
        crew.saveSoon();
        return true;
      }
    }
    return false;
  };

  /** Minute chips: one can be picked. */
  function minuteChips(values, label, onPick) {
    var row = h('div.chips.win-chips', { role: 'group', 'aria-label': label });
    values.forEach(function (v) {
      var b = h('button.chip', { type: 'button', 'aria-pressed': 'false' }, crew.mins(v));
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(row.children, function (c) {
          c.classList.remove('is-on');
          c.setAttribute('aria-pressed', 'false');
        });
        b.classList.add('is-on');
        b.setAttribute('aria-pressed', 'true');
        onPick(v);
      });
      row.appendChild(b);
    });
    return row;
  }

  /** "Log a win": the job, minutes before and with Claude (tap chips), and an optional note. */
  crew.openLogWin = function (opts) {
    opts = opts || {};
    if (PU.state.preview) {
      PU.toast('Preview mode is on, so nothing is saved.', { icon: 'eye' });
      return;
    }
    var pick = { task: opts.task || '', before: null, after: null };
    var jobs = crew.jobs();
    var other = h('input.input#win-task', { type: 'text', maxlength: '80', placeholder: jobs.length ? 'Or type another job' : 'Type the job', autocomplete: 'off' });
    var jobRow = h('div.chips.win-chips', { role: 'group', 'aria-label': 'Which job?' });
    function paintJobs() {
      PU.clear(jobRow);
      jobs.forEach(function (j) {
        var on = pick.task === j.name;
        var b = h('button.chip', { type: 'button', class: on ? 'is-on' : '', 'aria-pressed': String(on) }, j.name);
        b.addEventListener('click', function () {
          pick.task = j.name;
          other.value = '';
          paintJobs();
        });
        jobRow.appendChild(b);
      });
    }
    paintJobs();
    if (pick.task && !jobs.some(function (j) { return j.name === pick.task; })) other.value = pick.task;
    other.addEventListener('input', function () {
      pick.task = other.value.trim();
      paintJobs();
    });
    var note = h('input.input#win-note', { type: 'text', maxlength: '200', placeholder: 'e.g. a reply to a customer', autocomplete: 'off' });
    var save = h('button.btn.btn-primary', { type: 'button' }, PU.icon('check'), h('span', 'Save my win'));
    save.addEventListener('click', function () {
      if (!pick.task) return PU.toast('Pick the job first.', { icon: 'info' });
      if (pick.before === null) return PU.toast('How long did it take before Claude?', { icon: 'info' });
      if (pick.after === null) return PU.toast('How long did it take with Claude?', { icon: 'info' });
      var w = crew.addWin({ task: pick.task, before: pick.before, after: pick.after, note: note.value, level: opts.level || '' });
      if (!w) return;
      if (PU.closeDrawer) PU.closeDrawer();
    });
    var who = (PU.brand && PU.brand.name) || 'your employer';
    var body = h(
      'div.stack.win-form',
      h('p.small.muted', 'A win is a real job you did with Claude. Tap your answers.'),
      h('div.win-q', h('div.win-label', 'Which job?'), jobs.length ? jobRow : null, other),
      h('div.win-q', h('div.win-label', 'How long did it take before Claude?'), minuteChips(BEFORE, 'Minutes before Claude', function (v) { pick.before = v; })),
      h('div.win-q', h('div.win-label', 'How long did it take with Claude?'), minuteChips(WITH, 'Minutes with Claude', function (v) { pick.after = v; })),
      h('div.win-q', h('label.win-label', { for: 'win-note' }, 'What did you make? (optional)'), note, h('span.small.muted', 'No names or phone numbers, please.')),
      h('div.btn-row', save, h('span.small.muted', xpLeftToday() > 0 ? '+' + WIN_XP + ' XP' : 'No more XP for wins today')),
      h('p.small.muted.win-honest', PU.icon('info', 'icon-sm'), h('span', 'You tell us the times. Nobody checks them.' + (crew.live() ? ' Your wins go to ' + who + ' with your progress, marked “self-reported”.' : (T.preview ? ' This is a preview, so they stay in this browser.' : ' In this sample, they stay in this browser.'))))
    );
    if (PU.openDrawer) PU.openDrawer('Log a win', body);
  };

  function winDate(at) {
    try {
      return new Date(at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    } catch (e) {
      return '';
    }
  }

  /** My wins: the totals, a button to log one, and the list (newest first). */
  crew.winsView = function () {
    var wrap = h('div.stack.wins-view');
    function paint() {
      var t = crew.winTotals();
      var add = h('button.btn.btn-primary.btn-sm', { type: 'button' }, PU.icon('plus', 'icon-sm'), 'Log a win');
      add.addEventListener('click', function () {
        crew.openLogWin();
      });
      var list = crew.wins().slice().reverse();
      PU.fill(
        wrap,
        h(
          'div.wins-totals',
          h('div.ds', h('span.eyebrow', 'Wins'), h('b', String(t.count))),
          h('div.ds', h('span.eyebrow', 'Time saved'), h('b', t.saved > 0 ? crew.mins(t.saved) : '0 min')),
          h('span.tag', 'Self-reported')
        ),
        h('div.btn-row', add),
        list.length
          ? h(
              'ul.wins-list',
              list.map(function (w) {
                var del = h('button.icon-btn.win-del', { type: 'button', 'aria-label': 'Remove this win', title: 'Remove' }, PU.icon('x', 'icon-sm'));
                del.addEventListener('click', function () {
                  crew.removeWin(w.id);
                  PU.toast('Win removed', { icon: 'check' });
                  paint();
                });
                return h(
                  'li.win-item',
                  h(
                    'div.win-main',
                    h('b', w.task),
                    h('span.win-times', crew.mins(w.before) + ' → ' + crew.mins(w.after) + ' with Claude'),
                    w.note ? h('span.win-note', w.note) : null,
                    h('span.win-when', winDate(w.at))
                  ),
                  del
                );
              })
            )
          : h('p.small.muted', 'No wins yet. Do a real job with Claude, then log it here.'),
        h('p.small.muted', 'You tell us the times. Nobody checks them.')
      );
    }
    paint();
    return wrap;
  };

  /* ---------- desk missions (end of each level) and the certificate ---------- */

  crew.deskCard = function (L) {
    var job = crew.jobFor(L);
    var title = L.short || plain(L.title);
    var btn = h('button.btn.btn-primary.btn-sm', { type: 'button' }, PU.icon('plus', 'icon-sm'), h('span', 'Log a win'));
    btn.addEventListener('click', function () {
      crew.openLogWin({ task: job ? job.name : '', level: L.id });
    });
    return h(
      'section.desk-card',
      { 'aria-label': 'Do this at your desk today' },
      h('div.desk-top', h('span.desk-icon', PU.icon('target')), h('div', h('div.eyebrow', 'Do this at your desk today'), h('h3.desk-title', job ? job.name : 'One real job from your week'))),
      h(
        'p.desk-text',
        job
          ? 'Do this job for real with Claude today. Use what you just learned in “' + title + '”.'
          : 'Pick a job you do every week and do it with Claude today, the way “' + title + '” showed you. Keep to your company’s rules on what can go into Claude.'
      ),
      job && job.use === 'anonymised'
        ? h('p.desk-rule', PU.icon('alert', 'icon-sm'), h('span', 'Your company’s rule for this job: take out names and personal details before anything goes into Claude.'))
        : null,
      h('p.desk-text.muted', 'Then log your win: how long the job took before, and how long it took with Claude.'),
      h('div.btn-row', btn, h('span.small.muted', '+' + WIN_XP + ' XP'))
    );
  };

  var baseSummary = PU.steps.summary;
  PU.steps.summary = function (step, ctx) {
    var out = [].concat(baseSummary(step, ctx));
    if (ctx.level.optional) return out;
    return [out[0], crew.deskCard(ctx.level)].concat(out.slice(1));
  };

  crew.certWins = function () {
    var t = crew.winTotals();
    var s = crew.streak();
    var add = h('button.btn.btn-ghost.btn-sm', { type: 'button' }, PU.icon('plus', 'icon-sm'), 'Log a win');
    add.addEventListener('click', function () {
      crew.openLogWin({ level: 'LF' });
    });
    return h(
      'section.desk-card.cert-wins',
      { 'aria-label': 'Your wins' },
      h('div.desk-top', h('span.desk-icon', PU.icon('trophy')), h('div', h('div.eyebrow', 'Your wins at work'), h('h3.desk-title', t.count ? (t.count === 1 ? '1 job' : t.count + ' jobs') + ' done with Claude' : 'Log your first win'))),
      h(
        'p.desk-text',
        t.count
          ? (t.saved > 0 ? 'About ' + crew.mins(t.saved) + ' saved, by your own count. ' : '') + 'Keep logging the jobs you do with Claude.'
          : 'Do a real job with Claude, then tell us how long it took before and with Claude.'
      ),
      s.best ? h('p.desk-text.muted', 'Best streak: ' + s.best + (s.best === 1 ? ' day' : ' days in a row') + '.') : null,
      h('div.btn-row', add, h('span.tag', 'Self-reported'))
    );
  };

  var baseCert = PU.steps.certificate;
  PU.steps.certificate = function (step, ctx) {
    var first = !ctx.preview && !(PU.state.data && PU.state.data.certShown);
    var out = [].concat(baseCert(step, ctx));
    if (first && crew.live()) {
      // Reaching the end is news: tell the training now, not on the next timer.
      sendSoon();
      crew.saveSoon();
    }
    return [out[0], crew.certWins()].concat(out.slice(1));
  };

  /* ---------- the team board ---------- */

  crew.hidden = function () {
    return !!data().boardHidden;
  };
  crew.setHidden = function (on) {
    if (on) data().boardHidden = true;
    else delete data().boardHidden;
    PU.save();
    PU.emit('board');
    sendSoon();
    crew.saveSoon();
  };

  /** "Hide me from the team board" as a switch (Settings, the board). */
  crew.hideSwitch = function () {
    var sw = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(crew.hidden()) }, h('span.trk'), h('span', 'Hide me from the team board'));
    sw.addEventListener('click', function () {
      crew.setHidden(!crew.hidden());
      sw.setAttribute('aria-checked', String(crew.hidden()));
      PU.toast(crew.hidden() ? 'You’re hidden from the team board.' : 'You’re back on the team board.', { icon: 'eye' });
    });
    return sw;
  };

  /** The same choice as a tick box, on the first screen. */
  crew.hideCheck = function () {
    var box = h('input#pu-hide', { type: 'checkbox', checked: crew.hidden() });
    box.addEventListener('change', function () {
      crew.setHidden(box.checked);
    });
    return h('label.hide-check', { for: 'pu-hide' }, box, h('span', 'Hide me from the team board'));
  };

  var EXAMPLE = [
    { name: 'Priya', level: 'Level 4', xp: 420, streak: 5 },
    { name: 'Sam', level: 'Level 3', xp: 285, streak: 2 },
    { name: 'Arjun', level: 'Level 2', xp: 160, streak: 0 },
    { name: 'Maya', level: 'Level 1', xp: 55, streak: 1 }
  ];

  /** The furthest level this person has opened, as people count it. */
  function myLevel() {
    var best = null;
    mainLevels().forEach(function (L) {
      var started = PU.levels.indexOf(L) === PU.state.pos.level || L.steps.some(function (st, i) {
        return PU.state.stepsDone[L.id + '.' + (st.sid || i)];
      });
      if (started) best = L;
    });
    return best ? PU.levelLabel(best) : PU.levelLabel(mainLevels()[0] || { num: 0 });
  }

  function firstName() {
    var n = String(PU.state.name || '').trim().split(/\s+/)[0];
    return n ? n.slice(0, 20) : 'You';
  }

  function boardList(people) {
    return h(
      'ol.board-list',
      people.map(function (p, i) {
        return h(
          'li.board-row',
          { class: p.me ? 'is-me' : '' },
          h('span.board-pos', String(i + 1)),
          h('span.board-who', h('b', p.name), p.me ? h('span.tag.live', 'You') : null, h('span.board-level', p.level)),
          p.streak
            ? h('span.board-streak', { title: p.streak + ' days in a row', 'aria-label': p.streak + ' days in a row' }, PU.icon('flame', 'icon-sm'), String(p.streak))
            : h('span.board-streak'),
          h('span.board-xp', String(p.xp), h('small', ' XP'))
        );
      })
    );
  }

  function exampleBoard() {
    var me = { name: firstName(), level: myLevel(), xp: PU.state.xp, streak: crew.streak().now, me: true };
    var people = EXAMPLE.concat([me]).sort(function (a, b) {
      return b.xp - a.xp;
    });
    return h(
      'div.stack-sm',
      h('div.board-example', PU.icon('info', 'icon-sm'), h('span', h('b', 'Example board. '), 'These are made-up people, to show how it looks. In your team’s own training, it shows your teammates.')),
      boardList(people)
    );
  }

  var boardCache = null;
  crew.boardView = function () {
    var wrap = h('div.stack.board');
    var head = h('p.small.muted', 'First names, level, XP and days in a row for everyone on this training.');
    if (!crew.live()) {
      PU.put(wrap, head, exampleBoard());
      return wrap;
    }
    var host = h('div.stack-sm', h('p.small.muted', 'Loading the board…'));
    var foot = h('div.setting.board-hide', h('div.st-sub', 'Anyone can hide from the board, any time.'), crew.hideSwitch());
    PU.put(wrap, head, host, foot);
    function show(d) {
      var people = (d && d.people) || [];
      var hiddenNote = crew.hidden() ? h('div.board-example', PU.icon('eye', 'icon-sm'), h('span', 'You’re hidden, so your teammates don’t see you here.')) : null;
      PU.fill(host, hiddenNote, people.length ? boardList(people) : h('p.small.muted', 'Nobody is on the board yet. Finish a step and check back.'));
    }
    function load() {
      if (boardCache && Date.now() - boardCache.at < 30000) return show(boardCache.data);
      fetch(API + '/board?me=' + encodeURIComponent(PU.state.pid || ''), { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then(function (r) {
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        })
        .then(function (d) {
          boardCache = { at: Date.now(), data: d };
          show(d);
        })
        .catch(function () {
          var again = h('button.btn.btn-ghost.btn-sm', { type: 'button' }, PU.icon('refresh', 'icon-sm'), 'Try again');
          again.addEventListener('click', function () {
            PU.fill(host, h('p.small.muted', 'Loading the board…'));
            load();
          });
          PU.fill(host, h('p.small', 'Couldn’t load the board. Check your connection.'), h('div', again));
        });
    }
    load();
    return wrap;
  };

  /* ---------- reports: the streak, the board choice and the wins ---------- */

  var baseReport = PU.progressReport;
  PU.progressReport = function () {
    var r = baseReport();
    var s = crew.streak();
    r.person.streak = s.now;
    r.person.bestStreak = s.best;
    r.person.days = s.days;
    if (crew.hidden()) r.person.boardHidden = 1;
    r.wins = crew.wins().slice(-MAX_WINS);
    r.winsGone = gone().slice(-400);
    return r;
  };

  var sendTimer = null;
  /** Send a report shortly. The server takes one report every 2 seconds per
   * person, so wait a little in case one just went. */
  function sendSoon() {
    if (!PU.report || !keeping()) return;
    clearTimeout(sendTimer);
    sendTimer = setTimeout(function () {
      PU.report.lastBody = '';
      PU.report.now(false);
    }, 2100);
  }
  crew.sendSoon = sendSoon;

  /* ---------- carry on from another device ---------- */

  var saveTimer = null;
  function snapshot() {
    var s = PU.state;
    return {
      v: 1,
      xp: s.xp,
      awarded: s.awarded,
      stepsDone: s.stepsDone,
      levelsDone: s.levelsDone,
      pace: s.pace || {},
      data: s.data,
      pos: s.pos,
      name: s.name || '',
      email: s.email || '',
      started: s.started,
      lastActive: s.lastActive,
      theme: s.theme
    };
  }

  /** A secret this device makes for itself before its first save. If the page
   * closes before the server's reply (with the resume key) arrives, the next
   * save proves with it that this device made the key, and gets it back. */
  function claim() {
    if (!PU.state.saveClaim) {
      var a = '';
      try {
        var b = new Uint8Array(18);
        window.crypto.getRandomValues(b);
        a = Array.prototype.map.call(b, function (x) {
          return ('0' + x.toString(16)).slice(-2);
        }).join('');
      } catch (e) {
        for (var i = 0; i < 4; i++) a += Math.random().toString(36).slice(2, 10);
      }
      PU.state.saveClaim = a;
      PU.saveNow();
    }
    return PU.state.saveClaim;
  }

  /** Save this person's place on the server, where it joins what their other
   * devices saved. Resolves to the resume key, or to null when it couldn't
   * (crew.lastSave has the reason). `fresh` (after "Reset my progress")
   * starts the saved copy over instead, even before a name is given. */
  crew.saveNow = function (fresh) {
    clearTimeout(saveTimer);
    saveTimer = null;
    fresh = fresh === 'fresh';
    if (!keeping() || !PU.state.pid || !(PU.state.name || (fresh && PU.state.resumeKey))) return Promise.resolve(null);
    var body = JSON.stringify({ id: PU.state.pid, key: PU.state.resumeKey || null, claim: PU.state.resumeKey ? undefined : claim(), fresh: fresh || undefined, state: snapshot() });
    if (body.length > 140000) return Promise.resolve(null);
    var opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, credentials: 'same-origin' };
    if (body.length < 60000) opts.keepalive = true; // can finish after the page closes
    return fetch(API + '/state', opts)
      .then(function (r) {
        crew.lastSave = r.status;
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        if (j && j.key) {
          if (j.key !== PU.state.resumeKey) {
            PU.state.resumeKey = j.key;
            PU.save();
          }
          return j.key;
        }
        return null;
      })
      .catch(function () {
        crew.lastSave = 0;
        return null;
      });
  };

  /** Save within 15 seconds of a change (a busy learner still gets saved). */
  crew.saveSoon = function () {
    if (!keeping() || !PU.state.name || saveTimer) return;
    saveTimer = setTimeout(crew.saveNow, 15000);
  };

  function carryLink(key) {
    return location.origin + location.pathname + '#carry=' + PU.state.pid + '.' + key;
  }

  /** Settings: make a private link that opens this person's place on another device. */
  crew.carryView = function () {
    var make = h('button.btn.btn-ghost.btn-sm', { type: 'button' }, PU.icon('external', 'icon-sm'), h('span', 'Get my link'));
    var out = h('div.stack-sm');
    make.addEventListener('click', function () {
      if (PU.state.preview) return PU.toast('Turn off Preview mode first.', { icon: 'eye' });
      if (!PU.state.name) return PU.toast('Add your name on the first screen first.', { icon: 'info' });
      make.disabled = true;
      PU.fill(out, h('p.small.muted', 'Saving your place…'));
      crew
        .saveNow()
        .then(function (key) {
          if (key || crew.lastSave !== 409) return key;
          // Not on the server yet: send a progress report first, then try again.
          if (PU.report) {
            PU.report.lastBody = '';
            PU.report.now(false);
          }
          return new Promise(function (res) {
            setTimeout(res, 2500);
          }).then(crew.saveNow);
        })
        .then(function (key) {
          make.disabled = false;
          if (!key) {
            PU.fill(out, h('p.small', 'Couldn’t save your place just now. Check your connection and try again.'));
            return;
          }
          var link = carryLink(key);
          var input = h('input.input.carry-link', { type: 'text', readOnly: true, value: link, 'aria-label': 'Your link to carry on' });
          input.addEventListener('focus', function () {
            input.select();
          });
          PU.fill(
            out,
            input,
            h('div.btn-row', PU.copyBtn(function () { return link; }, 'Copy link')),
            h('p.small.muted', 'Open it on your phone or another computer to carry on from here. Keep it to yourself: it opens your progress.')
          );
        });
    });
    return h('div.stack-sm', h('div', make), out);
  };

  function stepsCount(s) {
    return s && obj(s.stepsDone) ? Object.keys(s.stepsDone).length : 0;
  }

  function unionWins(a, b, goneIds) {
    var by = {};
    (Array.isArray(b) ? b : []).forEach(function (w) {
      if (w && w.id) by[w.id] = w;
    });
    (Array.isArray(a) ? a : []).forEach(function (w) {
      if (w && w.id) by[w.id] = w;
    });
    return Object.keys(by)
      .filter(function (k) {
        return goneIds.indexOf(k) < 0;
      })
      .map(function (k) {
        return by[k];
      })
      .sort(function (x, y) {
        return (x.at || 0) - (y.at || 0) || (x.id < y.id ? -1 : 1);
      })
      .slice(-MAX_WINS);
  }

  /** Join what another device saved into this one: nothing done on either is lost. */
  function mergeData(a, b) {
    Object.keys(b).forEach(function (k) {
      var x = a[k];
      var y = b[k];
      if (x === undefined || x === null) {
        a[k] = y;
      } else if (k === 'days' && obj(x) && obj(y)) {
        Object.keys(y).forEach(function (d) {
          x[d] = 1;
        });
      } else if (k === 'winXp' && obj(x) && obj(y)) {
        Object.keys(y).forEach(function (d) {
          x[d] = Math.max(+x[d] || 0, +y[d] || 0);
        });
      } else if (k === 'doneAt' && obj(x) && obj(y)) {
        Object.keys(y).forEach(function (id) {
          if (!x[id] || (y[id] && y[id] < x[id])) x[id] = y[id];
        });
      } else if (k === 'bestStreak') {
        a[k] = Math.max(+x || 0, +y || 0);
      } else if (k === 'certAt') {
        if (y && y < x) a[k] = y;
      } else if (k === 'winsGone' || k === 'wins') {
        /* below */
      } else if (k.indexOf('.') > 0) {
        // One step's own answers: keep this device's, unless it has none.
        if (obj(x) && !Object.keys(x).length) a[k] = y;
      } else if (obj(x) && obj(y)) {
        Object.keys(y).forEach(function (kk) {
          if (x[kk] === undefined) x[kk] = y[kk];
        });
      }
    });
    var g = (Array.isArray(a.winsGone) ? a.winsGone : []).concat(Array.isArray(b.winsGone) ? b.winsGone : []);
    g = g.filter(function (id, i) {
      return typeof id === 'string' && g.indexOf(id) === i;
    });
    if (g.length) a.winsGone = g.slice(-400);
    if (a.wins || b.wins) a.wins = unionWins(a.wins, b.wins, g);
    return a;
  }

  /**
   * A saved place from another device ({id, key, state}): a fresh device takes
   * it over; a device with its own progress joins the two. Either way this
   * device carries on as the same person, with the same resume key.
   */
  function firstWord(n) {
    return String(n || '').trim().split(/\s+/)[0].toLowerCase();
  }

  crew.merge = function (remote) {
    var R = remote && remote.state;
    if (!R || R.v !== 1 || typeof remote.id !== 'string' || !remote.key) return false;
    var L = PU.state;
    // Someone else's link on a device with its own progress: never mix two people.
    if (remote.id !== L.pid && stepsCount(L) && L.name && R.name && firstWord(L.name) !== firstWord(R.name)) return 'other';
    var ahead = stepsCount(R) > stepsCount(L);
    Object.keys(R.stepsDone || {}).forEach(function (k) {
      L.stepsDone[k] = true;
    });
    Object.keys(R.levelsDone || {}).forEach(function (k) {
      L.levelsDone[k] = true;
    });
    Object.keys(R.awarded || {}).forEach(function (k) {
      L.awarded[k] = Math.max(+L.awarded[k] || 0, +R.awarded[k] || 0);
    });
    L.xp = Object.keys(L.awarded).reduce(function (n, k) {
      return n + (+L.awarded[k] || 0);
    }, 0);
    var pace = (L.pace = obj(L.pace) ? L.pace : {});
    Object.keys(R.pace || {}).forEach(function (k) {
      var p = pace[k] || { t: 0, w: 0 };
      var q = R.pace[k] || {};
      pace[k] = { t: Math.max(+p.t || 0, +q.t || 0), w: Math.max(+p.w || 0, +q.w || 0) };
    });
    L.data = mergeData(obj(L.data) ? L.data : {}, obj(R.data) ? R.data : {});
    if (ahead && R.pos) L.pos = { level: R.pos.level || 0, step: R.pos.step || 0 };
    if (!L.name && R.name) L.name = R.name;
    if (!L.email && R.email) L.email = R.email;
    if (R.started && (!L.started || R.started < L.started)) L.started = R.started;
    if (R.lastActive && (!L.lastActive || R.lastActive > L.lastActive)) L.lastActive = R.lastActive;
    L.pid = remote.id;
    L.resumeKey = remote.key;
    PU.saveNow();
    return true;
  };

  var carried = null;
  function clearHash() {
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (e) {
      /* not allowed here: harmless */
    }
  }

  // 1. A personal link opened on another device: the page brings the saved place.
  if (crew.live() && T.resume && T.resume.state) {
    try {
      var before = stepsCount(PU.state);
      if (crew.merge(T.resume) === true && stepsCount(PU.state) > before) carried = before ? 'joined' : 'carried';
    } catch (e) {
      /* a broken saved place never stops the training */
    }
  }

  /** Ask for a saved place. `use` gets it (or null) only if it comes within
   * `ms`; the training waits that long at most, then starts without it. */
  function askResume(id, key, ms, use) {
    var late = false;
    var asked = fetch(API + '/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, key: key }), credentials: 'same-origin' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      })
      .then(function (j) {
        if (!late) use(j);
      });
    var timer = new Promise(function (res) {
      setTimeout(function () {
        late = true;
        res();
      }, ms);
    });
    return Promise.race([asked, timer]);
  }

  // 2. A "carry on" link: #carry=<person>.<key>. The training waits for it (PU.ready).
  var cm = /^#carry=(p_[a-z0-9]{6,40})\.([A-Za-z0-9_-]{10,80})$/.exec(window.location.hash || '');
  if (cm) {
    clearHash();
    if (crew.live() && window.fetch) {
      carried = 'bad'; // until the saved place arrives
      PU.ready = askResume(cm[1], cm[2], 8000, function (j) {
        var got = j && crew.merge(j);
        carried = got === 'other' ? 'other' : got ? 'carried' : 'bad';
      });
    }
  } else if (crew.live() && window.fetch && PU.state.resumeKey && PU.state.pid && !(T.resume && T.resume.id === PU.state.pid)) {
    // 3. This device saved before: catch up with what the person did on their other devices.
    var had = stepsCount(PU.state);
    PU.ready = askResume(PU.state.pid, PU.state.resumeKey, 2500, function (j) {
      if (j && crew.merge(j) === true && stepsCount(PU.state) > had) carried = 'joined';
    });
  }

  /* ---------- wiring ---------- */

  PU.on('step', function () {
    crew.markDay();
    crew.saveSoon();
  });
  PU.on('levels', function () {
    crew.saveSoon();
  });
  PU.on('name', function () {
    crew.saveSoon();
  });
  PU.on('board', function () {
    boardCache = null;
  });
  PU.on('booted', function () {
    if (carried === 'carried') PU.toast('Welcome back. You’re carrying on from your other device.', { icon: 'check', ms: 3600 });
    else if (carried === 'joined') PU.toast('Your progress from your other device is here too.', { icon: 'check', ms: 3600 });
    else if (carried === 'bad') PU.toast('That link didn’t work. Make a new one on your other device.', { icon: 'info', ms: 4200 });
    else if (carried === 'other') PU.toast('That link opens someone else’s progress, so it wasn’t used here.', { icon: 'info', ms: 4200 });
    carried = null;
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && saveTimer) crew.saveNow();
  });

  /* Starting over keeps who you are (same person id and resume key), and
     the saved copy on our side starts over too, so it can't bring the old
     progress back. */
  var baseReset = PU.resetAll;
  PU.resetAll = function () {
    var pid = PU.state.pid;
    var key = PU.state.resumeKey;
    var mine = PU.state.saveClaim;
    baseReset();
    if (pid) PU.state.pid = pid;
    if (key) PU.state.resumeKey = key;
    if (mine) PU.state.saveClaim = mine;
    PU.saveNow();
    boardCache = null;
    if (key) crew.saveNow('fresh');
  };
})();
