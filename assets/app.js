/* Controles internos Brasil - dashboard
   Le data/dataset.js (window.ICR_DATA) e monta as tres visoes. */
(function () {
  'use strict';

  var RAW = window.ICR_DATA;
  if (!RAW || !RAW.controls) {
    document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">Nao foi possivel carregar data/dataset.js.</p>';
    return;
  }

  var NF = new Intl.NumberFormat('pt-BR');
  var STATUS_ORDER = ['SA3', 'SA1', 'SA2', 'SA0'];

  var state = {
    view: 'avaliacao',
    sort: 'total',
    vision: '',
    filters: {
      codes: new Set(),
      structures: new Set(),
      owners: new Set(),
      statuses: new Set(),
      assigned: new Set(),
      frequencies: new Set()
    }
  };

  var controls = [];
  var multiselects = {};

  // ---------------------------------------------------------------- helpers

  function n(v) { return NF.format(v); }

  function pct(v) {
    return (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function initials(name) {
    var parts = String(name).split(/[\s,]+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function ownersOf(c) {
    if (!c.o) return [];
    return c.o.split(';').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function dateLabel(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d);
    var get = function (t) { var p = parts.find(function (x) { return x.type === t; }); return p ? p.value : ''; };
    return get('day') + '/' + get('month') + '/' + get('year') + ' \u00e0s ' + get('hour') + ':' + get('minute');
  }

  function dateOnly(iso) {
    var full = dateLabel(iso);
    return full.split(' \u00e0s ')[0];
  }

  function isoDay(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function badgeClass(status) {
    if (status === 'SA3') return 'badge badge-sa3';
    if (status === 'SA1') return 'badge badge-sa1';
    if (status === 'SA2') return 'badge badge-sa2';
    return 'badge badge-sa0';
  }

  function toast(message) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('is-visible'); }, 3200);
  }

  function groupCount(rows, keyFn) {
    var map = new Map();
    rows.forEach(function (r) {
      var k = keyFn(r);
      if (!map.has(k)) map.set(k, { key: k, total: 0, SA3: 0, SA1: 0, SA2: 0, SA0: 0 });
      var g = map.get(k);
      g.total++;
      if (g[r.r] !== undefined) g[r.r]++;
    });
    return Array.from(map.values());
  }

  function statsOf(rows) {
    var out = { total: rows.length, SA3: 0, SA1: 0, SA2: 0, SA0: 0, esg: 0, esgAssessed: 0 };
    rows.forEach(function (r) {
      if (out[r.r] !== undefined && r.r !== 'total') out[r.r]++;
      if (r.e) {
        out.esg++;
        if (r.r !== 'SA0') out.esgAssessed++;
      }
    });
    out.assessed = out.SA3 + out.SA1 + out.SA2;
    out.pending = out.SA0;
    out.rate = out.total ? out.assessed / out.total : 0;
    return out;
  }

  // ---------------------------------------------------------------- init

  function init() {
    RAW = window.ICR_DATA;
    controls = RAW.controls.map(function (c) {
      return {
        c: c.c, d: c.d || '', f: c.f || '—', o: c.o || '', s: c.s || '—',
        r: (c.r || 'SA0').toUpperCase(), t: c.t || '', e: c.e ? 1 : 0, i: c.i || null,
        ow: null
      };
    });
    controls.forEach(function (c) { c.ow = ownersOf(c); });

    var stats = statsOf(controls);

    document.getElementById('appTitle').textContent = 'Controles internos Brasil \u00b7 ' + RAW.semester;
    document.getElementById('positionText').textContent = dateLabel(RAW.monitoring.modified);
    document.getElementById('sa1Badge').textContent = n(stats.SA1);

    buildVision();
    buildFilters();
    renderAvaliacao();
    buildHoldingVision();
    renderHolding();
    buildPainelVision();
    renderPainel();
  }

  // ---------------------------------------------------------------- vision

  function buildVision() {
    var select = document.getElementById('visionSelect');
    var counts = {};
    controls.forEach(function (c) { counts[c.f] = (counts[c.f] || 0) + 1; });
    var freqs = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });

    select.innerHTML = '<option value="">Todas as frequ\u00eancias</option>' +
      freqs.map(function (f) {
        return '<option value="' + esc(f) + '">' + esc(f) + '</option>';
      }).join('');

    select.value = state.vision;
    select.onchange = function () {
      state.vision = select.value;
      renderAvaliacao();
    };
  }

  function updateSubtitle() {
    var stamp = dateOnly(RAW.monitoring.modified);
    var scope = state.vision ? 'frequ\u00eancia ' + state.vision : 'todas as frequ\u00eancias';
    var el = document.getElementById('pageSub');
    if (el) el.textContent = RAW.semester + ', posi\u00e7\u00e3o do Monitoring de ' + stamp + ', ' + scope;
  }

  function visionRows() {
    if (!state.vision) return controls;
    return controls.filter(function (c) { return c.f === state.vision; });
  }

  // ---------------------------------------------------------------- filters

  function optionList(values, counts, limit) {
    return values.map(function (v) {
      return { value: v, label: v, count: counts[v] };
    }).slice(0, limit || values.length);
  }

  function buildFilters() {
    var codeCounts = {}, structCounts = {}, ownerCounts = {}, assignedCounts = {}, freqCounts = {};

    controls.forEach(function (c) {
      codeCounts[c.c] = (codeCounts[c.c] || 0) + 1;
      structCounts[c.s] = (structCounts[c.s] || 0) + 1;
      freqCounts[c.f] = (freqCounts[c.f] || 0) + 1;
      if (c.t) assignedCounts[c.t] = (assignedCounts[c.t] || 0) + 1;
      c.ow.forEach(function (o) { ownerCounts[o] = (ownerCounts[o] || 0) + 1; });
    });

    var byCount = function (obj) {
      return Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; });
    };

    multiselects.code = createMultiSelect('msCode', {
      placeholder: 'Todos os c\u00f3digos',
      options: optionList(byCount(codeCounts), codeCounts),
      searchable: true,
      onChange: function (set) { state.filters.codes = set; renderTable(); }
    });

    multiselects.struct = createMultiSelect('msStruct', {
      placeholder: 'Todas as estruturas',
      options: optionList(byCount(structCounts), structCounts),
      searchable: true,
      onChange: function (set) { state.filters.structures = set; renderTable(); }
    });

    multiselects.owner = createMultiSelect('msOwner', {
      placeholder: 'Todos os control owners',
      options: optionList(byCount(ownerCounts), ownerCounts),
      searchable: true,
      onChange: function (set) { state.filters.owners = set; renderTable(); }
    });

    multiselects.assigned = createMultiSelect('msAssigned', {
      placeholder: 'Todos os respons\u00e1veis',
      options: optionList(byCount(assignedCounts), assignedCounts),
      searchable: true,
      onChange: function (set) { state.filters.assigned = set; renderTable(); }
    });

    multiselects.freq = createMultiSelect('msFreq', {
      placeholder: 'Todas as frequ\u00eancias',
      options: optionList(byCount(freqCounts), freqCounts),
      onChange: function (set) { state.filters.frequencies = set; renderTable(); }
    });

    renderStatusChips();

    document.getElementById('clearFilters').onclick = function () {
      Object.keys(multiselects).forEach(function (k) { multiselects[k].clear(); });
      state.filters.statuses = new Set();
      renderStatusChips();
      renderTable();
    };
  }

  function renderStatusChips() {
    var counts = { total: controls.length, SA0: 0, SA1: 0, SA2: 0, SA3: 0 };
    controls.forEach(function (c) { if (counts[c.r] !== undefined) counts[c.r]++; });

    var chips = [
      { id: 'total', label: 'Todos', count: counts.total, dot: '' },
      { id: 'SA0', label: 'SA0', caption: ' N\u00e3o avaliado', count: counts.SA0, dot: 'dot-red' },
      { id: 'SA1', label: 'SA1', caption: ' Avaliado, operativo e com altera\u00e7\u00e3o de desenho', count: counts.SA1, dot: 'dot-amber' },
      { id: 'SA2', label: 'SA2', caption: ' Avaliado e inoperante', count: counts.SA2, dot: 'dot-blue' },
      { id: 'SA3', label: 'SA3', caption: ' Avaliado e operativo', count: counts.SA3, dot: 'dot-green' }
    ];

    var box = document.getElementById('statusChips');
    box.innerHTML = chips.map(function (c) {
      var checked = c.id === 'total'
        ? state.filters.statuses.size === 0
        : state.filters.statuses.has(c.id);
      return '<label class="chip">' +
        '<input type="checkbox" data-status="' + c.id + '"' + (checked ? ' checked' : '') + '>' +
        (c.dot ? '<i class="dot ' + c.dot + '"></i>' : '') +
        '<span>' + (c.caption ? '<b>' + c.label + '</b>' + c.caption : c.label) + '</span>' +
        '<span class="chip-count">' + n(c.count) + '</span>' +
        '</label>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('input'), function (input) {
      input.onchange = function () {
        var id = input.getAttribute('data-status');
        if (id === 'total') {
          state.filters.statuses = new Set();
        } else if (input.checked) {
          state.filters.statuses.add(id);
        } else {
          state.filters.statuses.delete(id);
        }
        renderStatusChips();
        renderTable();
      };
    });
  }

  function createMultiSelect(id, opts) {
    var root = document.getElementById(id);
    var set = new Set();
    var open = false;
    var query = '';

    root.innerHTML = '<button type="button" class="ms-trigger" aria-haspopup="listbox" aria-expanded="false">' +
      '<span class="ms-label">' + esc(opts.placeholder) + '</span></button>' +
      '<div class="ms-panel" role="listbox">' +
      (opts.searchable ? '<input type="text" class="ms-search" placeholder="Buscar...">' : '') +
      '<div class="ms-actions"><button type="button" class="ms-action" data-act="all">Selecionar todos</button>' +
      '<button type="button" class="ms-action" data-act="none">Limpar</button></div>' +
      '<div class="ms-options"></div>' +
      '</div>';

    var trigger = root.querySelector('.ms-trigger');
    var panel = root.querySelector('.ms-panel');
    var optionsBox = root.querySelector('.ms-options');
    var search = root.querySelector('.ms-search');

    function label() {
      if (set.size === 0) return opts.placeholder;
      if (set.size === 1) return Array.from(set)[0];
      return set.size + ' selecionados';
    }

    function paint() {
      trigger.querySelector('.ms-label').textContent = label();
      trigger.classList.toggle('is-has-value', set.size > 0);
    }

    function renderOptions() {
      var q = query.toLowerCase();
      var list = opts.options.filter(function (o) {
        return !q || o.label.toLowerCase().indexOf(q) !== -1;
      });
      var shown = list.slice(0, 120);
      var html = shown.map(function (o) {
        return '<label class="ms-option"><input type="checkbox" value="' + esc(o.value) + '"' +
          (set.has(o.value) ? ' checked' : '') + '><span>' + esc(o.label) + '</span></label>';
      }).join('');
      if (!shown.length) html = '<div class="ms-empty">Nenhuma op\u00e7\u00e3o encontrada.</div>';
      if (list.length > shown.length) {
        html += '<div class="ms-empty">Mostrando ' + shown.length + ' de ' + n(list.length) + '. Use a busca para refinar.</div>';
      }
      optionsBox.innerHTML = html;
      Array.prototype.forEach.call(optionsBox.querySelectorAll('input'), function (input) {
        input.onchange = function () {
          if (input.checked) set.add(input.value); else set.delete(input.value);
          paint();
          opts.onChange(set);
        };
      });
    }

    trigger.onclick = function (e) {
      e.stopPropagation();
      open = !open;
      panel.classList.toggle('is-open', open);
      trigger.classList.toggle('is-open', open);
      trigger.setAttribute('aria-expanded', String(open));
      if (open) {
        renderOptions();
        if (search) { search.value = ''; query = ''; search.focus(); }
      }
    };

    panel.onclick = function (e) { e.stopPropagation(); };

    if (search) {
      search.oninput = function () { query = search.value; renderOptions(); };
    }

    panel.querySelector('[data-act="all"]').onclick = function () {
      opts.options.forEach(function (o) { set.add(o.value); });
      paint(); renderOptions(); opts.onChange(set);
    };

    panel.querySelector('[data-act="none"]').onclick = function () {
      set.clear();
      paint(); renderOptions(); opts.onChange(set);
    };

    document.addEventListener('click', function () {
      if (!open) return;
      open = false;
      panel.classList.remove('is-open');
      trigger.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    });

    paint();

    return {
      clear: function () {
        set.clear();
        paint();
        if (open) renderOptions();
      }
    };
  }

  // ---------------------------------------------------------------- view: avaliacao

  function renderAvaliacao() {
    var rows = visionRows();
    var st = statsOf(rows);

    updateSubtitle();

    document.getElementById('visionCount').textContent =
      n(rows.length) + ' de ' + n(controls.length) + ' controles na sele\u00e7\u00e3o';

    document.getElementById('kpiTotal').textContent = n(st.total);
    document.getElementById('kpiPercent').textContent = pct(st.rate);
    document.getElementById('kpiSideCaption').textContent = 'avaliados, ' + n(st.pending) + ' pendentes';

    var bar = document.getElementById('kpiBar');
    bar.innerHTML = [
      '<span class="seg-sa3" style="width:' + (st.total ? st.SA3 / st.total * 100 : 0) + '%"></span>',
      '<span class="seg-sa1" style="width:' + (st.total ? st.SA1 / st.total * 100 : 0) + '%"></span>',
      '<span class="seg-sa2" style="width:' + (st.total ? st.SA2 / st.total * 100 : 0) + '%"></span>',
      '<span class="seg-sa0" style="width:' + (st.total ? st.SA0 / st.total * 100 : 0) + '%"></span>'
    ].join('');
    bar.setAttribute('aria-label', 'SA3 ' + st.SA3 + ', SA1 ' + st.SA1 + ', SA2 ' + st.SA2 + ', SA0 ' + st.SA0);

    document.getElementById('statAssessed').textContent = n(st.assessed);
    document.getElementById('statSA3').textContent = n(st.SA3);
    document.getElementById('statSA1').textContent = n(st.SA1);
    document.getElementById('statSA2').textContent = n(st.SA2);
    document.getElementById('statSA0').textContent = n(st.SA0);
    document.getElementById('statSA0Note').textContent =
      (st.total ? pct(st.SA0 / st.total) : '0,0%') + ' do total';
    document.getElementById('statEsg').textContent = n(st.esg);
    document.getElementById('statEsgNote').textContent =
      n(st.esgAssessed) + ' avaliados (' + (st.esg ? pct(st.esgAssessed / st.esg) : '0,0%') + '), ' +
      n(st.esg - st.esgAssessed) + ' pendentes';

    renderStructures(rows, st);
    renderSa1ByStructure(rows, st);
    renderSa0Offenders(rows, st);
    renderTable();
  }

  function renderStructures(rows, st) {
    var groups = groupCount(rows, function (r) { return r.s; });
    var maxTotal = groups.reduce(function (m, g) { return Math.max(m, g.total); }, 1);

    groups.forEach(function (g) {
      g.assessed = g.SA3 + g.SA1 + g.SA2;
      g.rate = g.total ? g.assessed / g.total : 0;
    });

    if (state.sort === 'pct-asc') {
      groups.sort(function (a, b) { return a.rate - b.rate || b.total - a.total; });
    } else if (state.sort === 'pct-desc') {
      groups.sort(function (a, b) { return b.rate - a.rate || b.total - a.total; });
    } else {
      groups.sort(function (a, b) { return b.total - a.total || a.key.localeCompare(b.key); });
    }

    document.getElementById('structList').innerHTML = groups.map(function (g) {
      var w = function (v) { return (v / maxTotal * 100).toFixed(3); };
      var cls = g.rate === 0 ? ' is-zero' : (g.rate >= 0.85 ? ' is-good' : '');
      return '<div class="struct-row">' +
        '<div class="struct-name" title="' + esc(g.key) + '">' + esc(g.key) + '</div>' +
        '<div class="struct-track">' +
        '<span class="seg seg-sa3" style="width:' + w(g.SA3) + '%"></span>' +
        '<span class="seg seg-sa1" style="width:' + w(g.SA1) + '%"></span>' +
        '<span class="seg seg-sa2" style="width:' + w(g.SA2) + '%"></span>' +
        '<span class="seg seg-sa0" style="width:' + w(g.SA0) + '%"></span>' +
        '</div>' +
        '<div class="struct-figures"><b>' + n(g.assessed) + '</b> de ' + n(g.total) + '</div>' +
        '<div class="struct-pct' + cls + '">' + pct(g.rate) + '</div>' +
        '</div>';
    }).join('');
  }

  function rankList(el, groups, opts) {
    var total = opts.total;
    var max = groups.reduce(function (m, g) { return Math.max(m, g.total); }, 1);
    var out = groups.map(function (g, i) {
      var share = total ? g.total / total : 0;
      var note = opts.note(g, share);
      return '<div class="rank-row">' +
        '<div class="rank-pos">' + (i + 1) + '\u00ba</div>' +
        '<div class="rank-body">' +
        '<div class="rank-name" title="' + esc(g.key) + '">' + esc(g.key) + '</div>' +
        '<div class="rank-bar"><span class="' + opts.barClass + '" style="width:' + (g.total / max * 100).toFixed(2) + '%"></span></div>' +
        (note ? '<div class="rank-note">' + note + '</div>' : '') +
        '</div>' +
        '<div class="rank-value ' + (opts.valueClass || '') + '">' + n(g.total) + '</div>' +
        '</div>';
    }).join('');
    el.innerHTML = out || '<p class="card-sub">Sem dados para a sele\u00e7\u00e3o.</p>';
  }

  function renderSa1ByStructure(rows, st) {
    var groups = groupCount(rows.filter(function (r) { return r.r === 'SA1'; }), function (r) { return r.s; })
      .sort(function (a, b) { return b.total - a.total || a.key.localeCompare(b.key); })
      .slice(0, 20);

    rankList(document.getElementById('sa1ByStruct'), groups, {
      total: st.SA1,
      barClass: 'bar-amber',
      valueClass: 'amber',
      note: function (g, share) { return pct(share) + ' do SA1'; }
    });
  }

  function renderSa0Offenders(rows, st) {
    var groups = groupCount(rows.filter(function (r) { return r.r === 'SA0'; }), function (r) { return r.s; })
      .sort(function (a, b) { return b.total - a.total || a.key.localeCompare(b.key); })
      .slice(0, 20);

    var totalsByStruct = {};
    rows.forEach(function (r) { totalsByStruct[r.s] = (totalsByStruct[r.s] || 0) + 1; });

    rankList(document.getElementById('sa0Offenders'), groups, {
      total: st.SA0,
      barClass: 'bar-red',
      valueClass: 'red',
      note: function (g, share) {
        var own = totalsByStruct[g.key] ? g.total / totalsByStruct[g.key] : 0;
        return pct(share) + ' do SA0, ' + pct(own) + ' da estrutura';
      }
    });
  }

  // ---------------------------------------------------------------- table + filters

  function filteredRows() {
    var f = state.filters;
    return controls.filter(function (c) {
      if (f.statuses.size && !f.statuses.has(c.r)) return false;
      if (f.codes.size && !f.codes.has(c.c)) return false;
      if (f.structures.size && !f.structures.has(c.s)) return false;
      if (f.frequencies.size && !f.frequencies.has(c.f)) return false;
      if (f.assigned.size && !f.assigned.has(c.t)) return false;
      if (f.owners.size) {
        var ok = c.ow.some(function (o) { return f.owners.has(o); });
        if (!ok) return false;
      }
      return true;
    });
  }

  function hasFilters() {
    var f = state.filters;
    return !!(f.statuses.size || f.codes.size || f.structures.size || f.frequencies.size ||
      f.assigned.size || f.owners.size);
  }

  function renderTable() {
    var rows = filteredRows();
    var st = statsOf(rows);

    document.getElementById('tableTitle').textContent =
      n(rows.length) + (rows.length === 1 ? ' controle para download' : ' controles para download') +
      (hasFilters() ? ' (com filtros)' : ' (todos, sem filtro)');

    document.getElementById('tableSummary').textContent =
      'Na sele\u00e7\u00e3o: ' + n(rows.length) + ' controles, ' + n(st.assessed) + ' avaliados (' + pct(st.rate) + ')';

    document.getElementById('tableMiniBar').innerHTML =
      '<span class="seg-sa3" style="width:' + (st.total ? st.SA3 / st.total * 100 : 0) + '%"></span>' +
      '<span class="seg-sa1" style="width:' + (st.total ? st.SA1 / st.total * 100 : 0) + '%"></span>' +
      '<span class="seg-sa0" style="width:' + (st.total ? st.SA0 / st.total * 100 : 0) + '%"></span>';

    document.getElementById('miniSA3').textContent = n(st.SA3);
    document.getElementById('miniSA1').textContent = n(st.SA1);
    document.getElementById('miniSA0').textContent = n(st.SA0);

    document.getElementById('tableBody').innerHTML = rows.map(function (c) {
      var owners = c.ow.slice(0, 3).map(function (o) {
        return '<div title="' + esc(o) + '">' + esc(o) + '</div>';
      }).join('');
      if (c.ow.length > 3) owners += '<div class="cell-assigned">+' + (c.ow.length - 3) + '</div>';
      return '<tr>' +
        '<td class="col-code">' + esc(c.c) + '</td>' +
        '<td><div class="cell-desc" title="' + esc(c.d) + '">' + esc(c.d) + '</div></td>' +
        '<td>' + esc(c.f) + '</td>' +
        '<td class="cell-owners">' + (owners || '—') + '</td>' +
        '<td class="cell-struct">' + esc(c.s) + '</td>' +
        '<td><span class="' + badgeClass(c.r) + '">' + esc(c.r) + '</span></td>' +
        '<td class="cell-assigned">' + (c.t ? esc(c.t) : '—') + '</td>' +
        '</tr>';
    }).join('');

    document.getElementById('tableFoot').textContent =
      n(rows.length) + (rows.length === 1 ? ' controle na sele\u00e7\u00e3o. ' : ' controles na sele\u00e7\u00e3o. ') +
      'Fonte: ' + RAW.monitoring.file + ' (Monitoring) e ' + RAW.issues.file + ' (Report Issue). ' +
      'Gerado em ' + dateLabel(RAW.generatedAt) + '.';
  }

  // ---------------------------------------------------------------- view: holding

  var HOLD = {
    freq: '',
    icrResp: '',
    icrStruct: '',
    icrSearch: '',
    holdingName: '',
    validator: '',
    status: 'both',
    search: ''
  };

  // O SAP grafa o mesmo nome de formas diferentes ("SOBRENOME,NOME" e "NOME SOBRENOME").
  // A chave e o conjunto de palavras em ordem alfabetica, entao os dois formatos
  // caem na mesma entrada e o nome exibido segue o padrao usado no painel.
  var PERSON_NAMES = {
    'arthur de igrejas souza': 'Arthur Igrejas',
    'barreira barthe leticia maceira': 'Leticia Barthe',
    'barros livia silva vitoria': 'Livia Barros da Silva',
    'antunes ferreira talita': 'Talita Ferreira',
    'maltagliati matteo': 'Matteo Maltagliati',
    'chiara flumeri': 'Chiara Flumeri',
    'mario pio ricci': 'Mario Pio Ricci',
    'amir ferjani': 'Amir Ferjani',
    'cancellara dos santos thadeu victor': 'Victor Cancellara',
    'carreiro fernando garcia': 'Fernando Carreiro'
  };

  function personName(raw) {
    if (!raw) return '';
    var s = String(raw).trim();
    if (!s) return '';
    var words;
    if (s.indexOf(',') >= 0) {
      var parts = s.split(',');
      var surname = parts[0].trim().split(/\s+/).filter(Boolean);
      var given = parts.slice(1).join(' ').trim().split(/\s+/).filter(Boolean);
      words = given.concat(surname);
    } else {
      words = s.split(/\s+/).filter(Boolean);
    }
    if (!words.length) return '';
    var key = words.map(function (w) { return w.toLowerCase(); }).sort().join(' ');
    if (PERSON_NAMES[key]) return PERSON_NAMES[key];
    return words.map(function (w) {
      var low = w.toLowerCase();
      return low.charAt(0).toUpperCase() + low.slice(1);
    }).join(' ');
  }

  function personList(raw) {
    if (!raw) return '';
    return String(raw).split(';').map(function (p) { return personName(p); }).filter(Boolean).join('; ');
  }

  // "Hoje" e a posicao do Monitoring, nao a data do relogio: assim os dias
  // paramados acompanham a foto da planilha.
  function todayDay() {
    return isoDay(RAW.monitoring.modified) || isoDay(new Date().toISOString());
  }

  function dayNum(day) {
    if (!day) return null;
    var p = String(day).slice(0, 10).split('-');
    if (p.length !== 3) return null;
    var t = Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(t) ? null : t;
  }

  function daysBetween(fromDay, toDay) {
    var a = dayNum(fromDay);
    var b = dayNum(toDay || todayDay());
    if (a === null || b === null) return null;
    return Math.round((b - a) / 86400000);
  }

  function dayLabel(day) {
    if (!day) return '\u2014';
    var p = String(day).slice(0, 10).split('-');
    if (p.length !== 3) return '\u2014';
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function sa1Rows() {
    return controls.filter(function (c) { return c.r === 'SA1'; });
  }

  function sa1Stage(c) {
    if (!c.i) return 'sem';
    if (/^Closed/i.test(c.i.st || '')) return 'aprovado';
    if (!c.i.dn) return 'devolvido';
    if (c.i.vd) return 'holding';
    return 'icr';
  }

  function sa1Base() {
    var rows = sa1Rows();
    if (!HOLD.freq) return rows;
    return rows.filter(function (c) { return c.f === HOLD.freq; });
  }

  function meanDays(rows, field) {
    var vals = rows.map(function (c) {
      return daysBetween(c.i ? c.i[field] : '', todayDay());
    }).filter(function (v) { return v !== null && v >= 0; });
    if (!vals.length) return { mean: null, max: null };
    var sum = vals.reduce(function (a, b) { return a + b; }, 0);
    return { mean: Math.round(sum / vals.length), max: Math.max.apply(null, vals) };
  }

  function fillSelect(el, values, allLabel) {
    if (!el) return;
    var current = el.value;
    el.innerHTML = '<option value="">' + esc(allLabel) + '</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
    el.value = values.indexOf(current) >= 0 ? current : '';
  }

  function buildHoldingVision() {
    var select = document.getElementById('holdingVision');
    if (!select) return;
    var counts = {};
    sa1Rows().forEach(function (c) { counts[c.f] = (counts[c.f] || 0) + 1; });
    var freqs = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    select.innerHTML = '<option value="">Todas as frequ\u00eancias</option>' + freqs.map(function (f) {
      return '<option value="' + esc(f) + '">' + esc(f) + ' (' + n(counts[f]) + ')</option>';
    }).join('');
    select.value = HOLD.freq;
    select.onchange = function () {
      HOLD.freq = select.value;
      renderHolding();
    };
  }

  function renderHolding() {
    var base = sa1Base();
    var groups = { icr: [], holding: [], aprovado: [], devolvido: [], sem: [] };
    base.forEach(function (c) { groups[sa1Stage(c)].push(c); });

    var countEl = document.getElementById('holdingVisionCount');
    if (countEl) {
      countEl.textContent = n(base.length) + ' de ' + n(sa1Rows().length) + ' controles SA1 na sele\u00e7\u00e3o';
    }

    renderFunnel(groups);
    renderIcr(groups.icr);
    renderDevolvidos(groups.devolvido);
    renderHoldingView(groups.holding, groups.aprovado);
  }

  function renderFunnel(groups) {
    var stages = [
      { key: 'icr', title: 'Em ICR Brasil', tone: 'amber', note: 'pendentes de valida\u00e7\u00e3o do ICR Divisional' },
      { key: 'holding', title: 'Com a Holding (It\u00e1lia)', tone: 'blue', note: 'validados pelo ICR Brasil, aguardando aprova\u00e7\u00e3o' },
      { key: 'aprovado', title: 'Aprovados pela Holding', tone: 'green', note: 'issue encerrado; ainda SA1 no Monitoring, com o control owner para atualizar cadastro' }
    ];

    var host = document.getElementById('funnelStages');
    if (host) {
      host.innerHTML = stages.map(function (st, i) {
        var value = groups[st.key].length;
        var card = '<div class="funnel-stage funnel-' + st.tone + '">' +
          '<div class="funnel-stage-title">' + esc(st.title) + '</div>' +
          '<div class="funnel-value">' + n(value) + '</div>' +
          '<div class="funnel-stage-note">' + esc(st.note) + '</div>' +
          '</div>';
        return i === 0 ? card : '<span class="funnel-arrow" aria-hidden="true">\u2192</span>' + card;
      }).join('');
    }

    var total = stages.reduce(function (sum, st) { return sum + groups[st.key].length; }, 0) || 1;
    var stack = document.getElementById('funnelStack');
    if (stack) {
      stack.innerHTML = stages.map(function (st) {
        var value = groups[st.key].length;
        return '<span class="funnel-seg funnel-seg-' + st.tone + '" style="width:' + (value / total * 100).toFixed(2) +
          '%" title="' + esc(st.title + ': ' + n(value)) + '"></span>';
      }).join('');
    }

    var note = document.getElementById('funnelNote');
    if (note) {
      var dev = groups.devolvido.length;
      note.innerHTML = 'Al\u00e9m disso, <b>' + n(dev) + ' SA1</b> ' +
        (dev === 1 ? 'est\u00e1 devolvido' : 'est\u00e3o devolvidos') +
        ' ao control owner. <a href="#" class="link" id="devLink">Ver lista</a>';
      var link = document.getElementById('devLink');
      if (link) link.onclick = function (e) {
        e.preventDefault();
        expandSection('secDev');
        document.getElementById('secDev').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    }
  }

  function renderIcr(rows) {
    var badge = document.getElementById('icrBadge');
    if (badge) badge.textContent = n(rows.length) + ' SA1';

    var byPerson = new Map();
    rows.forEach(function (c) {
      var name = personList(c.t) || 'Sem respons\u00e1vel';
      if (!byPerson.has(name)) byPerson.set(name, []);
      byPerson.get(name).push(c);
    });

    var cards = Array.from(byPerson.entries()).map(function (entry) {
      var stats = meanDays(entry[1], 'co');
      return { name: entry[0], count: entry[1].length, mean: stats.mean, max: stats.max };
    }).sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });

    var max = cards.reduce(function (m, p) { return Math.max(m, p.count); }, 1);
    var people = document.getElementById('icrPeople');
    if (people) {
      people.innerHTML = cards.map(function (p) {
        var meta = p.mean === null
          ? 'sem data de avalia\u00e7\u00e3o do control owner'
          : 'm\u00e9dia de ' + p.mean + ' dias desde a avalia\u00e7\u00e3o do CO \u00b7 mais antigo: ' + p.max + ' dias';
        return '<div class="person-card">' +
          '<div class="person-top"><span class="person-name">' + esc(p.name) + '</span>' +
          '<span class="person-count">' + n(p.count) + '</span></div>' +
          '<div class="person-meta">' + esc(meta) + '</div>' +
          '<div class="person-bar"><span class="person-bar-fill bar-amber" style="width:' +
          (p.count / max * 100).toFixed(1) + '%"></span></div>' +
          '</div>';
      }).join('') || '<p class="card-sub">Nenhum SA1 em valida\u00e7\u00e3o do ICR Brasil na sele\u00e7\u00e3o.</p>';
    }

    var respSelect = document.getElementById('icrResp');
    fillSelect(respSelect, cards.map(function (p) { return p.name; }), 'Todos');
    if (respSelect) respSelect.onchange = function () { HOLD.icrResp = respSelect.value; renderIcrTable(filterIcr(rows)); };

    var structs = Array.from(new Set(rows.map(function (c) { return c.s; }))).sort();
    var structSelect = document.getElementById('icrStruct');
    fillSelect(structSelect, structs, 'Todas');
    if (structSelect) structSelect.onchange = function () { HOLD.icrStruct = structSelect.value; renderIcrTable(filterIcr(rows)); };

    var search = document.getElementById('icrSearch');
    if (search) search.oninput = function () { HOLD.icrSearch = search.value; renderIcrTable(filterIcr(rows)); };

    var excel = document.getElementById('icrExcel');
    if (excel) {
      excel.onclick = function () {
        exportXlsx('sa1_em_icr_brasil', ICR_COLUMNS, filterIcr(rows));
      };
    }

    renderIcrTable(filterIcr(rows));
  }

  function filterIcr(rows) {
    var q = (HOLD.icrSearch || '').toLowerCase().trim();
    return rows.filter(function (c) {
      if (HOLD.icrResp && (personList(c.t) || 'Sem respons\u00e1vel') !== HOLD.icrResp) return false;
      if (HOLD.icrStruct && c.s !== HOLD.icrStruct) return false;
      if (q) {
        var hay = (c.c + ' ' + c.d + ' ' + (c.i.dc || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  var ICR_COLUMNS = [
    { label: 'C\u00f3digo', value: function (c) { return c.c; } },
    { label: 'Estrutura', value: function (c) { return c.s; } },
    { label: 'Respons\u00e1vel ICR', value: function (c) { return personList(c.t); } },
    { label: 'Dias desde a avalia\u00e7\u00e3o do CO', value: function (c) { return daysBetween(c.i.co, todayDay()); } },
    { label: 'Control owner', value: function (c) { return c.ow.join('; '); } },
    { label: 'O que o control owner pede', value: function (c) { return c.i.dc || ''; } }
  ];

  function renderIcrTable(rows) {
    var list = rows.slice().sort(function (a, b) {
      var da = daysBetween(a.i.co, todayDay());
      var db = daysBetween(b.i.co, todayDay());
      if (da === null && db === null) return a.c.localeCompare(b.c);
      if (da === null) return 1;
      if (db === null) return -1;
      return db - da || a.c.localeCompare(b.c);
    });

    var countEl = document.getElementById('icrCount');
    if (countEl) countEl.textContent = n(list.length) + (list.length === 1 ? ' controle' : ' controles');

    var body = document.getElementById('icrBody');
    if (!body) return;
    body.innerHTML = list.map(function (c) {
      var d = daysBetween(c.i.co, todayDay());
      return '<tr>' +
        '<td class="col-code">' + esc(c.c) + '</td>' +
        '<td class="cell-struct">' + esc(c.s) + '</td>' +
        '<td>' + esc(personList(c.t) || '\u2014') + '</td>' +
        '<td class="cell-days">' + (d === null ? '\u2014' : n(d)) + '</td>' +
        '<td class="cell-owners">' + (c.ow.length ? esc(c.ow.join('; ')) : '\u2014') + '</td>' +
        '<td class="cell-ask" title="' + esc(c.i.dc || '') + '">' + esc(c.i.dc || '\u2014') + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderDevolvidos(rows) {
    var badge = document.getElementById('devBadge');
    if (badge) badge.textContent = n(rows.length) + ' SA1';

    var list = rows.slice().sort(function (a, b) {
      var da = daysBetween(a.i.co, todayDay());
      var db = daysBetween(b.i.co, todayDay());
      if (da === null && db === null) return a.c.localeCompare(b.c);
      if (da === null) return 1;
      if (db === null) return -1;
      return db - da;
    });

    var body = document.getElementById('devBody');
    if (!body) return;
    body.innerHTML = list.map(function (c) {
      return '<tr>' +
        '<td class="col-code">' + esc(c.c) + '</td>' +
        '<td class="cell-struct">' + esc(c.s) + '</td>' +
        '<td>' + esc(personList(c.t) || '\u2014') + '</td>' +
        '<td>' + esc(c.i.dn ? personName(c.i.dn) : 'Sem ICR Divisional atribu\u00eddo') + '</td>' +
        '<td class="cell-muted">' + (c.i.vd ? dayLabel(c.i.vd) : '\u2014') + '</td>' +
        '<td class="cell-ask" title="' + esc(c.i.dc || '') + '">' + esc(c.i.dc || '\u2014') + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderHoldingView(waiting, approved) {
    var badge = document.getElementById('holdingBadge');
    if (badge) badge.textContent = n(waiting.length) + ' aguardando \u00b7 ' + n(approved.length) + ' aprovados';

    var buckets = [
      { label: 'at\u00e9 2 dias aguardando', test: function (d) { return d !== null && d <= 2; } },
      { label: '3 a 5 dias aguardando', test: function (d) { return d !== null && d >= 3 && d <= 5; } },
      { label: '6 a 10 dias aguardando', test: function (d) { return d !== null && d >= 6 && d <= 10; } },
      { label: 'mais de 10 dias aguardando', test: function (d) { return d === null || d > 10; }, alert: true }
    ];

    var bucketHost = document.getElementById('holdingBuckets');
    if (bucketHost) {
      bucketHost.innerHTML = buckets.map(function (b) {
        var count = waiting.filter(function (c) { return b.test(daysBetween(c.i.vd, todayDay())); }).length;
        return '<div class="bucket' + (b.alert ? ' is-alert' : '') + '">' +
          '<div class="bucket-value">' + n(count) + '</div>' +
          '<div class="bucket-label">' + esc(b.label) + '</div>' +
          '</div>';
      }).join('');
    }

    var byHolding = new Map();
    waiting.forEach(function (c) {
      var name = personName(c.i.hd) || 'Sem ICR Holding';
      if (!byHolding.has(name)) byHolding.set(name, []);
      byHolding.get(name).push(c);
    });

    var cards = Array.from(byHolding.entries()).map(function (entry) {
      var stats = meanDays(entry[1], 'vd');
      var validators = new Set(entry[1].map(function (c) { return personName(c.i.dn) || '\u2014'; }));
      return { name: entry[0], count: entry[1].length, mean: stats.mean, validators: validators.size };
    }).sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });

    var max = cards.reduce(function (m, p) { return Math.max(m, p.count); }, 1);
    var people = document.getElementById('holdingPeople');
    if (people) {
      people.innerHTML = cards.map(function (p) {
        var meta = 'm\u00e9dia de ' + (p.mean === null ? 0 : p.mean) + ' dias aguardando \u00b7 validados por ' +
          p.validators + ' pessoa(s) do ICR Brasil';
        return '<div class="person-card">' +
          '<div class="person-top"><span class="person-name">' + esc(p.name) + '</span>' +
          '<span class="person-count">' + n(p.count) + '</span></div>' +
          '<div class="person-meta">' + esc(meta) + '</div>' +
          '<div class="person-bar"><span class="person-bar-fill bar-blue" style="width:' +
          (p.count / max * 100).toFixed(1) + '%"></span></div>' +
          '</div>';
      }).join('') || '<p class="card-sub">Nenhum SA1 aguardando a Holding na sele\u00e7\u00e3o.</p>';
    }

    var all = waiting.concat(approved);

    var holdingSelect = document.getElementById('hHolding');
    fillSelect(holdingSelect, Array.from(new Set(waiting.map(function (c) { return personName(c.i.hd); }).filter(Boolean))).sort(), 'Todos');
    if (holdingSelect) holdingSelect.onchange = function () { HOLD.holdingName = holdingSelect.value; renderHoldingTable(filterHolding(all)); };

    var validatorSelect = document.getElementById('hValidator');
    fillSelect(validatorSelect, Array.from(new Set(all.map(function (c) { return personName(c.i.dn); }).filter(Boolean))).sort(), 'Todos');
    if (validatorSelect) validatorSelect.onchange = function () { HOLD.validator = validatorSelect.value; renderHoldingTable(filterHolding(all)); };

    var statusSelect = document.getElementById('hStatus');
    if (statusSelect) {
      statusSelect.value = HOLD.status;
      statusSelect.onchange = function () { HOLD.status = statusSelect.value; renderHoldingTable(filterHolding(all)); };
    }

    var search = document.getElementById('hSearch');
    if (search) search.oninput = function () { HOLD.search = search.value; renderHoldingTable(filterHolding(all)); };

    var excel = document.getElementById('holdingExcel');
    if (excel) {
      excel.onclick = function () {
        exportXlsx('sa1_aguardando_holding', HOLDING_COLUMNS, filterHolding(all));
      };
    }

    renderHoldingTable(filterHolding(all));
  }

  function filterHolding(rows) {
    var q = (HOLD.search || '').toLowerCase().trim();
    return rows.filter(function (c) {
      var isApproved = sa1Stage(c) === 'aprovado';
      if (HOLD.status === 'waiting' && isApproved) return false;
      if (HOLD.status === 'approved' && !isApproved) return false;
      if (HOLD.holdingName && (personName(c.i.hd) || 'Sem ICR Holding') !== HOLD.holdingName) return false;
      if (HOLD.validator && (personName(c.i.dn) || '\u2014') !== HOLD.validator) return false;
      if (q) {
        var hay = (c.c + ' ' + c.d + ' ' + c.s).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function holdingDays(c) {
    // Aguardando: desde a validacao do ICR Divisional. Aprovado: tempo que a Holding levou.
    if (sa1Stage(c) === 'aprovado') return daysBetween(c.i.vd, c.i.ap);
    return daysBetween(c.i.vd, todayDay());
  }

  var HOLDING_COLUMNS = [
    { label: 'C\u00f3digo', value: function (c) { return c.c; } },
    { label: 'Estrutura', value: function (c) { return c.s; } },
    { label: 'ICR Holding', value: function (c) { return personName(c.i.hd); } },
    { label: 'Validado por (ICR Brasil)', value: function (c) { return personName(c.i.dn); } },
    { label: 'Validado em', value: function (c) { return dayLabel(c.i.vd); } },
    { label: 'Dias aguardando', value: function (c) { return holdingDays(c); } },
    { label: 'Situa\u00e7\u00e3o', value: function (c) { return sa1Stage(c) === 'aprovado' ? 'Aprovado pela Holding' : 'Aguardando Holding'; } }
  ];

  function renderHoldingTable(rows) {
    var list = rows.slice().sort(function (a, b) {
      var aa = sa1Stage(a) === 'aprovado' ? 1 : 0;
      var bb = sa1Stage(b) === 'aprovado' ? 1 : 0;
      if (aa !== bb) return aa - bb;
      var da = holdingDays(a);
      var db = holdingDays(b);
      if (da === null && db === null) return a.c.localeCompare(b.c);
      if (da === null) return 1;
      if (db === null) return -1;
      return db - da || a.c.localeCompare(b.c);
    });

    var countEl = document.getElementById('holdingCount');
    if (countEl) countEl.textContent = n(list.length) + (list.length === 1 ? ' controle' : ' controles');

    var body = document.getElementById('holdingBody');
    if (!body) return;
    body.innerHTML = list.map(function (c) {
      var approved = sa1Stage(c) === 'aprovado';
      var days = holdingDays(c);
      return '<tr>' +
        '<td class="col-code">' + esc(c.c) + '</td>' +
        '<td class="cell-struct">' + esc(c.s) + '</td>' +
        '<td>' + esc(personName(c.i.hd) || '\u2014') + '</td>' +
        '<td>' + esc(personName(c.i.dn) || '\u2014') + '</td>' +
        '<td class="cell-muted">' + dayLabel(c.i.vd) + '</td>' +
        '<td class="cell-days' + (approved ? ' is-done' : '') + '">' + (days === null ? '\u2014' : n(days)) + '</td>' +
        '<td class="cell-status' + (approved ? ' is-done' : '') + '">' +
        (approved ? 'Aprovado pela Holding' : 'Aguardando Holding') + '</td>' +
        '</tr>';
    }).join('');
  }

  function expandSection(id) {
    var section = document.getElementById(id);
    if (!section) return;
    section.classList.remove('is-collapsed');
    var btn = section.querySelector('.section-toggle');
    if (btn) {
      btn.setAttribute('aria-expanded', 'true');
      btn.title = 'Recolher se\u00e7\u00e3o';
    }
  }

  function bindSections() {
    Array.prototype.forEach.call(document.querySelectorAll('.section-toggle'), function (btn) {
      btn.onclick = function () {
        var section = document.getElementById(btn.getAttribute('data-section'));
        if (!section) return;
        var collapsed = section.classList.toggle('is-collapsed');
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        btn.title = collapsed ? 'Expandir se\u00e7\u00e3o' : 'Recolher se\u00e7\u00e3o';
      };
    });
  }

  // ---------------------------------------------------------------- view: painel sa1

  var PAINEL = {
    freq: '',
    task: '',
    struct: '',
    system: '',
    search: '',
    showAllStructs: false
  };

  // Ordem fixa do time ICR Brasil usada nos cartoes e nos medidores.
  var ROSTER = [
    'Talita Ferreira',
    'Arthur Igrejas',
    'Fernando Carreiro',
    'Leticia Barthe',
    'Livia Barros da Silva',
    'Victor Cancellara'
  ];

  var HOLDING_ROSTER = ['Matteo Maltagliati', 'Chiara Flumeri', 'Mario Pio Ricci', 'Amir Ferjani'];

  var GROUP_LABEL = {
    icr: 'ICR Brasil',
    holding: 'Holding (It\u00e1lia)',
    owner: 'Control owner',
    none: 'Sem tarefa aberta no GRC'
  };

  // Sistemas citados no texto do controle ou da prova. Nao existe coluna
  // "Sistema" no Monitoring, entao o painel destaca os sistemas conhecidos
  // que aparecem na descricao.
  var SYSTEM_RULES = [
    { re: /new\s*p\.?\s*r\.?\s*i\.?\s*m\.?\s*o/i, name: 'New P.R.I.MO' },
    { re: /sap\s*e4e|sap\s*r4p|sap\s*d4p|\br4p\b|\bd4p\b/i, name: 'SAP E4E' },
    { re: /sap\s*ccs/i, name: 'SAP CCS' },
    { re: /master\s*budget/i, name: 'Master Budget' },
    { re: /\be-?report\b/i, name: 'E-Report' },
    { re: /operational\s*reporting/i, name: 'Operational Reporting' },
    { re: /sap\s*grc/i, name: 'SAP GRC' },
    { re: /\bsap\b/i, name: 'SAP' }
  ];

  function systemsOf(c) {
    var text = (c.d || '') + ' ' + (c.p || '');
    var out = [];
    SYSTEM_RULES.forEach(function (rule) {
      if (out.indexOf(rule.name) < 0 && rule.re.test(text)) out.push(rule.name);
    });
    // "SAP" generico so entra quando nenhum sistema SAP especifico foi achado.
    if (out.length > 1 && out[out.length - 1] === 'SAP') out.pop();
    return out;
  }

  function painelBase() {
    var rows = sa1Rows();
    if (!PAINEL.freq) return rows;
    return rows.filter(function (c) { return c.f === PAINEL.freq; });
  }

  function painelGroup(c) {
    if (!c.t) return 'none';
    var name = personName(c.t);
    if (ROSTER.indexOf(name) >= 0) return 'icr';
    if (HOLDING_ROSTER.indexOf(name) >= 0) return 'holding';
    return 'owner';
  }

  function painelTaskLabel(c) {
    if (!c.t) return GROUP_LABEL.none;
    return personList(c.t) || GROUP_LABEL.none;
  }

  function buildPainelVision() {
    var select = document.getElementById('painelVision');
    if (!select) return;
    var counts = {};
    sa1Rows().forEach(function (c) { counts[c.f] = (counts[c.f] || 0) + 1; });
    var freqs = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    select.innerHTML = '<option value="">Todas as frequ\u00eancias</option>' + freqs.map(function (f) {
      return '<option value="' + esc(f) + '">' + esc(f) + ' (' + n(counts[f]) + ')</option>';
    }).join('');
    select.value = PAINEL.freq;
    select.onchange = function () {
      PAINEL.freq = select.value;
      renderPainel();
    };
  }

  function pctLabel(part, total) {
    if (!total) return '0,0%';
    return (part / total * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  function renderPainel() {
    var base = painelBase();
    var all = sa1Rows();

    var countEl = document.getElementById('painelVisionCount');
    if (countEl) countEl.textContent = n(base.length) + ' de ' + n(all.length) + ' controles SA1 na sele\u00e7\u00e3o';

    renderPainelHero(base);
    renderPainelPeople(base);
    renderPainelGauges(base);
    renderPainelStructs(base);
    renderPainelTable(base);
  }

  function renderPainelHero(base) {
    var host = document.getElementById('painelHero');
    if (!host) return;
    var validated = base.filter(function (c) { return c.i && c.i.vd; }).length;
    var structs = new Set(base.map(function (c) { return c.s; })).size;
    var esg = base.filter(function (c) { return c.e; }).length;

    host.innerHTML = '<div class="hero-grid">' +
      '<div class="hero-main">' +
      '<div class="hero-number">' + n(base.length) + '</div>' +
      '<div class="hero-label">controles em SA1</div>' +
      '<div class="hero-note">no per\u00edmetro do painel de avalia\u00e7\u00e3o</div>' +
      '</div>' +
      '<div class="hero-stat"><div class="hero-stat-value">' + n(validated) + '</div>' +
      '<div class="hero-stat-note">j\u00e1 validados pelo ICR Divisional no Issue report</div></div>' +
      '<div class="hero-stat"><div class="hero-stat-value">' + n(structs) + '</div>' +
      '<div class="hero-stat-note">estruturas organizacionais</div></div>' +
      '<div class="hero-stat"><div class="hero-stat-value">' + n(esg) + '</div>' +
      '<div class="hero-stat-note">controles ESG</div></div>' +
      '</div>';
  }

  function personCard(name, count, total, group, initialsText) {
    var ini = initialsText || initials(name);
    var avatarClass = group === 'icr' ? 'avatar-icr' : (group === 'holding' ? 'avatar-holding' : 'avatar-owner');
    return '<button type="button" class="who-card" data-task="' + esc(name) + '">' +
      '<span class="who-avatar ' + avatarClass + '">' + esc(ini) + '</span>' +
      '<span class="who-text"><span class="who-name">' + esc(name) + '</span>' +
      '<span class="who-pct"> \u00b7 ' + pctLabel(count, total) + '</span></span>' +
      '<span class="who-count">' + n(count) + '</span>' +
      '</button>';
  }

  function renderPainelPeople(base) {
    var host = document.getElementById('painelPeople');
    if (!host) return;

    var byIcr = {};
    var byHolding = {};
    var owners = {};
    var none = 0;

    base.forEach(function (c) {
      var group = painelGroup(c);
      if (group === 'none') { none++; return; }
      var key = group === 'owner' ? painelTaskLabel(c) : personName(c.t);
      var bucket = group === 'icr' ? byIcr : (group === 'holding' ? byHolding : owners);
      bucket[key] = (bucket[key] || 0) + 1;
    });

    var icrCards = ROSTER.map(function (name) {
      return personCard(name, byIcr[name] || 0, base.length, 'icr');
    }).join('');

    var holdingCards = HOLDING_ROSTER.filter(function (name) { return byHolding[name]; })
      .sort(function (a, b) { return byHolding[b] - byHolding[a]; })
      .map(function (name) { return personCard(name, byHolding[name], base.length, 'holding'); }).join('') ||
      Object.keys(byHolding).sort(function (a, b) { return byHolding[b] - byHolding[a]; })
        .map(function (name) { return personCard(name, byHolding[name], base.length, 'holding'); }).join('');

    var ownerCards = Object.keys(owners).sort(function (a, b) {
      return owners[b] - owners[a] || a.localeCompare(b);
    }).map(function (name) { return personCard(name, owners[name], base.length, 'owner'); }).join('');

    var noneCard = none
      ? personCard(GROUP_LABEL.none, none, base.length, 'none', 'ST')
      : '';

    host.innerHTML = '<div class="who-group"><h4>ICR Brasil</h4><div class="who-grid">' + icrCards + '</div></div>' +
      '<div class="who-group"><h4>Holding (It\u00e1lia)</h4><div class="who-grid">' + holdingCards + '</div></div>' +
      '<div class="who-group"><h4>Control owner</h4><div class="who-grid">' + ownerCards + '</div></div>' +
      (noneCard ? '<div class="who-group"><h4>Sem tarefa aberta no GRC</h4><div class="who-grid">' + noneCard + '</div></div>' : '');

    Array.prototype.forEach.call(host.querySelectorAll('.who-card'), function (card) {
      card.onclick = function () {
        PAINEL.task = card.getAttribute('data-task');
        Array.prototype.forEach.call(host.querySelectorAll('.who-card'), function (c) {
          c.classList.toggle('is-active', c === card);
        });
        renderPainelTable(painelBase());
        var el = document.getElementById('pTask');
        if (el) el.value = PAINEL.task;
        scrollToPainelTable();
      };
    });
  }

  function scrollToPainelTable() {
    var target = document.getElementById('painelBody');
    if (target) target.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  var GAUGE_ZONES = [
    { from: 0, to: 100 / 3, color: '#e6b6b1' },
    { from: 100 / 3, to: 200 / 3, color: '#ead9bd' },
    { from: 200 / 3, to: 100, color: '#b6d2ce' }
  ];

  function gaugeSvg(ratio, color) {
    var pctValue = Math.max(0, Math.min(1, ratio)) * 100;
    var centerX = 110;
    var centerY = 105;
    var zones = GAUGE_ZONES.map(function (z) {
      return '<path class="gauge-zone" d="M30 105 A80 80 0 0 1 190 105" pathLength="100"' +
        ' stroke="' + z.color + '" stroke-dasharray="' + (z.to - z.from).toFixed(3) + ' 100"' +
        ' stroke-dashoffset="' + (-z.from).toFixed(3) + '"/>';
    }).join('');

    var angle = Math.PI - Math.PI * (pctValue / 100);
    var nx = centerX + Math.cos(angle) * 62;
    var ny = centerY - Math.sin(angle) * 62;

    var ticks = [0, 100 / 3, 200 / 3, 100].map(function (v) {
      var a = Math.PI - Math.PI * (v / 100);
      var x1 = centerX + Math.cos(a) * 88;
      var y1 = centerY - Math.sin(a) * 88;
      var x2 = centerX + Math.cos(a) * 94;
      var y2 = centerY - Math.sin(a) * 94;
      return '<line class="gauge-tick" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
    }).join('');

    return '<svg class="gauge" viewBox="0 0 220 122" role="img" aria-label="' + pctValue.toFixed(1) + '% validado">' +
      '<g fill="none" stroke-width="15" stroke-linecap="butt">' + zones +
      '<path d="M30 105 A80 80 0 0 1 190 105" pathLength="100" stroke="' + color + '"' +
      ' stroke-dasharray="' + pctValue.toFixed(3) + ' 100" stroke-dashoffset="0"/></g>' +
      ticks +
      '<line class="gauge-needle" x1="' + centerX + '" y1="' + centerY + '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '"/>' +
      '<circle class="gauge-hub" cx="' + centerX + '" cy="' + centerY + '" r="5.5"/>' +
      '</svg>';
  }

  function renderPainelGauges(base) {
    var host = document.getElementById('painelGauges');
    if (!host) return;

    var byPerson = new Map();
    base.forEach(function (c) {
      var name = c.i && c.i.dn ? personName(c.i.dn) : '';
      if (!name) return;
      if (!byPerson.has(name)) byPerson.set(name, { total: 0, valid: 0, last: '' });
      var entry = byPerson.get(name);
      entry.total++;
      if (c.i.vd) {
        entry.valid++;
        if (c.i.vd > entry.last) entry.last = c.i.vd;
      }
    });

    var names = ROSTER.filter(function (name) { return byPerson.has(name); });
    // Quem responde pela Holding aparece na aba SA1 x Holding, nao aqui.
    byPerson.forEach(function (_, name) {
      if (names.indexOf(name) < 0 && HOLDING_ROSTER.indexOf(name) < 0) names.push(name);
    });

    host.innerHTML = names.map(function (name) {
      var entry = byPerson.get(name);
      var ratio = entry.total ? entry.valid / entry.total : 0;
      var color = ratio <= 1 / 3 ? '#c9524d' : (ratio <= 2 / 3 ? '#d29a1a' : '#12857c');
      var pending = entry.total - entry.valid;
      var last = entry.last ? dayLabel(entry.last).slice(0, 5) : '\u2014';
      return '<div class="gauge-card">' +
        '<div class="gauge-name">' + esc(name) + '</div>' +
        gaugeSvg(ratio, color) +
        '<div class="gauge-value" style="color:' + color + '">' +
        (ratio * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%</div>' +
        '<div class="gauge-count"><b>' + n(entry.valid) + ' de ' + n(entry.total) + '</b> validados \u00b7 ' +
        n(pending) + (pending === 1 ? ' pendente' : ' pendentes') + '</div>' +
        '<div class="gauge-last">\u00faltima valida\u00e7\u00e3o em ' + last + '</div>' +
        '</div>';
    }).join('') || '<p class="card-sub">Sem SA1 com ICR Divisional atribu\u00eddo na sele\u00e7\u00e3o.</p>';
  }

  function renderPainelStructs(base) {
    var host = document.getElementById('painelStructs');
    var button = document.getElementById('painelStructMore');
    if (!host) return;

    var counts = {};
    base.forEach(function (c) { counts[c.s] = (counts[c.s] || 0) + 1; });
    var list = Object.keys(counts).map(function (k) { return { name: k, count: counts[k] }; })
      .sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });

    var visible = PAINEL.showAllStructs ? list : list.slice(0, 10);
    var max = list.reduce(function (m, g) { return Math.max(m, g.count); }, 1);
    var half = Math.ceil(visible.length / 2);

    var row = function (g) {
      return '<div class="struct-line">' +
        '<span class="struct-line-name" title="' + esc(g.name) + '">' + esc(g.name) + '</span>' +
        '<span class="struct-line-bar"><i style="width:' + (g.count / max * 100).toFixed(1) + '%"></i></span>' +
        '<span class="struct-line-count">' + n(g.count) + '</span>' +
        '</div>';
    };

    host.innerHTML = '<div class="struct-col">' + visible.slice(0, half).map(row).join('') + '</div>' +
      '<div class="struct-col">' + visible.slice(half).map(row).join('') + '</div>';

    if (button) {
      button.textContent = PAINEL.showAllStructs ? 'Mostrar menos' : 'Mostrar todos (' + list.length + ')';
      button.style.display = list.length > 10 ? '' : 'none';
      button.onclick = function () {
        PAINEL.showAllStructs = !PAINEL.showAllStructs;
        renderPainelStructs(base);
      };
    }
  }

  function painelFiltered(base) {
    var q = (PAINEL.search || '').toLowerCase().trim();
    return base.filter(function (c) {
      if (PAINEL.task && painelTaskLabel(c) !== PAINEL.task) return false;
      if (PAINEL.struct && c.s !== PAINEL.struct) return false;
      if (PAINEL.system && systemsOf(c).indexOf(PAINEL.system) < 0) return false;
      if (q) {
        var hay = (c.c + ' ' + c.d + ' ' + c.s + ' ' + (c.i && c.i.dc ? c.i.dc : '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  var PAINEL_COLUMNS = [
    { label: 'C\u00f3digo', value: function (c) { return c.c; } },
    { label: 'Estrutura', value: function (c) { return c.s; } },
    { label: 'Frequ\u00eancia', value: function (c) { return c.f; } },
    { label: 'Sistemas', value: function (c) { return systemsOf(c).join('; '); } },
    { label: 'Control owner', value: function (c) { return c.ow.join('; '); } },
    { label: 'Com quem est\u00e1', value: function (c) { return painelTaskLabel(c); } },
    { label: 'Grupo', value: function (c) { return GROUP_LABEL[painelGroup(c)]; } },
    { label: 'O que o control owner pede', value: function (c) { return c.i && c.i.dc ? c.i.dc : ''; } }
  ];

  function renderPainelTable(base) {
    var list = painelFiltered(base);

    // Selects de filtro
    var taskSelect = document.getElementById('pTask');
    if (taskSelect) {
      var taskNames = Array.from(new Set(base.map(painelTaskLabel))).sort();
      fillSelect(taskSelect, taskNames, 'Todos');
      taskSelect.onchange = function () { PAINEL.task = taskSelect.value; renderPainelTable(painelBase()); };
    }

    var structSelect = document.getElementById('pStruct');
    if (structSelect) {
      var structNames = Array.from(new Set(base.map(function (c) { return c.s; }))).sort();
      fillSelect(structSelect, structNames, 'Todas');
      structSelect.onchange = function () { PAINEL.struct = structSelect.value; renderPainelTable(painelBase()); };
    }

    var systemSelect = document.getElementById('pSystem');
    if (systemSelect) {
      var systemNames = Array.from(new Set(base.reduce(function (acc, c) { return acc.concat(systemsOf(c)); }, []))).sort();
      fillSelect(systemSelect, systemNames, 'Todos');
      systemSelect.onchange = function () { PAINEL.system = systemSelect.value; renderPainelTable(painelBase()); };
    }

    var freqSelect = document.getElementById('pFreq');
    if (freqSelect) {
      var freqNames = Array.from(new Set(base.map(function (c) { return c.f; }))).sort();
      fillSelect(freqSelect, freqNames, 'Todas');
      freqSelect.onchange = function () { PAINEL.freq = freqSelect.value; renderPainel(); };
    }

    var search = document.getElementById('pSearch');
    if (search) search.oninput = function () { PAINEL.search = search.value; renderPainelTable(painelBase()); };

    var clear = document.getElementById('pClear');
    if (clear) {
      clear.onclick = function () {
        PAINEL.task = '';
        PAINEL.struct = '';
        PAINEL.system = '';
        PAINEL.search = '';
        if (search) search.value = '';
        Array.prototype.forEach.call(document.querySelectorAll('#painelPeople .who-card'), function (c) {
          c.classList.remove('is-active');
        });
        renderPainelTable(painelBase());
      };
    }

    var excel = document.getElementById('pExcel');
    if (excel) {
      excel.onclick = function () { exportXlsx('painel_sa1', PAINEL_COLUMNS, list); };
    }

    var countEl = document.getElementById('painelListCount');
    if (countEl) countEl.textContent = n(list.length) + ' controles na lista';

    var body = document.getElementById('painelBody');
    if (!body) return;

    body.innerHTML = list.map(function (c) {
      var group = painelGroup(c);
      var chips = systemsOf(c).map(function (s) { return '<span class="sys-chip">' + esc(s) + '</span>'; }).join('');
      var esg = c.e ? '<span class="badge badge-esg">ESG</span>' : '';
      return '<tr class="painel-row" data-code="' + esc(c.c) + '">' +
        '<td class="col-toggle"><span class="row-arrow" aria-hidden="true">\u25b6</span></td>' +
        '<td class="col-code">' + esc(c.c) + ' ' + esg + '</td>' +
        '<td class="cell-struct">' + esc(c.s) + '</td>' +
        '<td>' + esc(c.f) + '</td>' +
        '<td class="cell-sys">' + (chips || '<span class="cell-muted">\u2014</span>') + '</td>' +
        '<td class="cell-owners">' + (c.ow.length ? esc(c.ow.join('; ')) : '\u2014') + '</td>' +
        '<td class="cell-who">' + esc(painelTaskLabel(c)) +
        '<div class="cell-who-group">' + esc(GROUP_LABEL[group]) + '</div></td>' +
        '<td class="cell-ask">' + esc(c.i && c.i.dc ? c.i.dc : '\u2014') + '</td>' +
        '</tr>' +
        '<tr class="painel-detail" data-detail="' + esc(c.c) + '" hidden><td colspan="8">' +
        '<div class="detail-grid">' +
        '<div><h5>Descri\u00e7\u00e3o do controle</h5><p>' + esc(c.d || '\u2014') + '</p></div>' +
        '<div><h5>Prova (evid\u00eancia)</h5><p>' + esc(c.p || '\u2014') + '</p></div>' +
        '<div><h5>Pedido do control owner</h5><p>' + esc(c.i && c.i.dc ? c.i.dc : '\u2014') + '</p></div>' +
        '</div></td></tr>';
    }).join('');

    Array.prototype.forEach.call(body.querySelectorAll('.painel-row'), function (row) {
      row.onclick = function () {
        var code = row.getAttribute('data-code');
        var detail = body.querySelector('[data-detail="' + code + '"]');
        if (!detail) return;
        var open = detail.hidden;
        detail.hidden = !open;
        row.classList.toggle('is-open', open);
      };
    });
  }
  // ---------------------------------------------------------------- xlsx export

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8(str) { return new TextEncoder().encode(str); }

  function zipStore(files) {
    var chunks = [];
    var central = [];
    var offset = 0;

    files.forEach(function (f) {
      var nameBytes = utf8(f.name);
      var data = typeof f.data === 'string' ? utf8(f.data) : f.data;
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0x0021, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      chunks.push(local, data);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x0021, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + data.length;
    });

    var centralSize = central.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    var all = chunks.concat(central, [end]);
    var total = all.reduce(function (s, c) { return s + c.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    all.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  }

  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  function colLetter(i) {
    var s = '';
    var n0 = i + 1;
    while (n0 > 0) {
      var rem = (n0 - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n0 = Math.floor((n0 - 1) / 26);
    }
    return s;
  }

  function buildSheet(headers, rows) {
    var widths = headers.map(function (h) { return Math.min(Math.max(h.length + 4, 14), 60); });
    var cols = '<cols>' + widths.map(function (w, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join('') + '</cols>';

    var body = rows.map(function (row, r) {
      var cells = row.map(function (val, i) {
        return '<c r="' + colLetter(i) + (r + 2) + '" t="inlineStr"><is><t xml:space="preserve">' +
          xmlEsc(val) + '</t></is></c>';
      }).join('');
      return '<row r="' + (r + 2) + '">' + cells + '</row>';
    }).join('');

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      cols +
      '<sheetData>' +
      '<row r="1">' + headers.map(function (h, i) {
        return '<c r="' + colLetter(i) + '1" t="inlineStr"><is><t>' + xmlEsc(h) + '</t></is></c>';
      }).join('') + '</row>' +
      body +
      '</sheetData></worksheet>';
  }

  function buildXlsx(headers, rows) {
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Controles" sheetId="1" r:id="rId1"/></sheets></workbook>';

    var workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
      '</styleSheet>';

    return zipStore([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
      { name: 'xl/styles.xml', data: styles },
      { name: 'xl/worksheets/sheet1.xml', data: buildSheet(headers, rows) }
    ]);
  }

  function saveBlob(bytes, filename, mime) {
    var blob = new Blob([bytes], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function exportXlsx(basename, columns, rows) {
    var headers = columns.map(function (c) { return c.label; });
    var data = rows.map(function (row) {
      return columns.map(function (c) { return c.value(row); });
    });
    var bytes = buildXlsx(headers, data);
    var stamp = isoDay(RAW.monitoring.modified) || isoDay(new Date().toISOString());
    saveBlob(bytes, basename + '_' + stamp + '.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast(n(rows.length) + ' controles exportados para Excel.');
  }

  // ---------------------------------------------------------------- pdf

  function downloadPdf() {
    var rows = filteredRows();
    var area = document.getElementById('printArea');
    var head = '<tr><th>C\u00f3digo</th><th>Descri\u00e7\u00e3o</th><th>Frequ\u00eancia</th>' +
      '<th>Control owners</th><th>Estrutura</th><th>Status</th><th>Avalia\u00e7\u00e3o atribu\u00edda a</th></tr>';
    var body = rows.map(function (c) {
      return '<tr><td>' + esc(c.c) + '</td><td>' + esc(c.d) + '</td><td>' + esc(c.f) + '</td>' +
        '<td>' + esc(c.ow.join('; ')) + '</td><td>' + esc(c.s) + '</td><td>' + esc(c.r) + '</td>' +
        '<td>' + esc(c.t || '—') + '</td></tr>';
    }).join('');

    area.innerHTML = '<h1>Controles internos Brasil \u00b7 ' + esc(RAW.semester) + '</h1>' +
      '<p>' + esc(n(rows.length)) + ' controles \u00b7 posi\u00e7\u00e3o do Monitoring de ' +
      esc(dateLabel(RAW.monitoring.modified)) + '</p>' +
      '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';

    window.print();
  }

  // ---------------------------------------------------------------- refresh / help

  var REFRESH_LABELS = {
    starting: 'Iniciando verifica\u00e7\u00e3o...',
    checking: 'Consultando o SharePoint...',
    downloading: 'Baixando planilhas novas...',
    building: 'Reconstruindo o dataset...'
  };

  // O SharePoint so responde com a sessao corporativa desta maquina, entao a
  // pagina publicada no Netlify pede a atualizacao ao servidor local
  // (Abrir Dashboard.cmd) em 127.0.0.1:8123. Servida do proprio servidor, ela
  // usa a mesma origem.
  var LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i;
  var AGENT_PORT = '8123';
  var SAME_AGENT = LOCAL_HOST.test(location.hostname) && location.port === AGENT_PORT;
  var AGENT = {
    base: SAME_AGENT ? '' : 'http://127.0.0.1:' + AGENT_PORT,
    external: !SAME_AGENT
  };

  var AGENT_HINT = 'O link publicado atualiza atraves desta maquina: abra o atalho "Abrir Dashboard.cmd" e clique em Atualizar dados de novo.';

  function agentUrl(path) { return AGENT.base + path; }

  function agentHint() {
    var btn = document.getElementById('refreshBtn');
    if (btn && !btn.title) btn.title = AGENT_HINT;
  }

  function probeAgent() {
    if (!AGENT.external) return;
    fetch(agentUrl('/api/refresh/state'), { cache: 'no-store' }).then(function (r) {
      if (r.ok) {
        var btn = document.getElementById('refreshBtn');
        if (btn) btn.title = 'Atualiza as planilhas do SharePoint usando a sessao desta maquina.';
      } else {
        agentHint();
      }
    }).catch(agentHint);
  }

  function setRefreshUi(text, busy) {
    var label = document.getElementById('refreshLabel');
    var btn = document.getElementById('refreshBtn');
    if (label) label.textContent = text;
    if (btn) {
      btn.disabled = !!busy;
      btn.classList.toggle('is-busy', !!busy);
    }
  }

  function applyDataset(prefix) {
    Object.keys(multiselects).forEach(function (k) { multiselects[k] = null; });
    state.filters = {
      codes: new Set(), structures: new Set(), owners: new Set(),
      statuses: new Set(), assigned: new Set(), frequencies: new Set()
    };
    state.vision = '';
    init();
    toast((prefix || '') + 'Base de data/dataset.js recarregada (posi\u00e7\u00e3o de ' +
      dateLabel(RAW.monitoring.modified) + ').');
  }

  function reloadDataset(prefix) {
    if (AGENT.external) {
      // Pagina publicada: o dataset novo esta no servidor local, nao no Netlify.
      fetch(agentUrl('/data/dataset.js?v=' + Date.now()), { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('status ' + r.status);
          return r.text();
        })
        .then(function (text) {
          var script = document.createElement('script');
          script.textContent = text;
          document.body.appendChild(script);
          script.remove();
          applyDataset(prefix);
        })
        .catch(function () { toast(AGENT_HINT); });
      return;
    }

    var script = document.createElement('script');
    script.src = 'data/dataset.js?v=' + Date.now();
    script.onload = function () { applyDataset(prefix); };
    script.onerror = function () {
      toast('N\u00e3o foi poss\u00edvel recarregar data/dataset.js.');
    };
    document.body.appendChild(script);
  }

  function watchRefresh(tries) {
    fetch(agentUrl('/api/refresh/state'), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (st) {
      var current = st.state || 'idle';
      if (REFRESH_LABELS[current]) {
        setRefreshUi(REFRESH_LABELS[current], true);
        if (tries < 200) {
          setTimeout(function () { watchRefresh(tries + 1); }, 1200);
        } else {
          setRefreshUi('Atualizar dados', false);
          toast('A verifica\u00e7\u00e3o continua em segundo plano; recarregue a p\u00e1gina em instantes.');
        }
        return;
      }
      if (current === 'idle' && tries < 4) {
        setTimeout(function () { watchRefresh(tries + 1); }, 700);
        return;
      }
      setRefreshUi('Atualizar dados', false);
      if (current === 'updated') {
        reloadDataset('Planilhas do SharePoint aplicadas. ');
      } else if (current === 'same') {
        toast(st.message || 'As planilhas do SharePoint j\u00e1 s\u00e3o as carregadas.');
      } else if (current === 'need-login') {
        toast(st.message || 'Entre no SharePoint na janela do navegador que abriu e clique em Atualizar dados de novo.');
      } else if (current === 'error') {
        toast('Falha ao atualizar: ' + (st.message || 'erro desconhecido'));
      } else {
        toast('Nenhuma atualiza\u00e7\u00e3o pendente.');
      }
    }).catch(function () {
      setRefreshUi('Atualizar dados', false);
      agentHint();
      toast(AGENT_HINT);
    });
  }

  function refresh() {
    // Aberto direto do disco (file://) n\u00e3o existe servidor local: sem ele nao
    // ha como falar com o SharePoint, entao avisa em vez de nao fazer nada.
    if (location.protocol === 'file:') {
      toast('Para buscar no SharePoint, abra o dashboard pelo atalho "Abrir Dashboard.cmd".');
      return;
    }
    setRefreshUi('Verificando o SharePoint...', true);
    fetch(agentUrl('/api/refresh'), { method: 'POST', cache: 'no-store' }).then(function (r) {
      return r.json();
    }).then(function () {
      watchRefresh(0);
    }).catch(function () {
      setRefreshUi('Atualizar dados', false);
      agentHint();
      toast(AGENT_HINT);
    });
  }

  function showHelp() {
    var dialog = document.createElement('dialog');
    dialog.style.cssText = 'max-width:640px;border:1px solid #dde3ea;border-radius:14px;padding:26px 28px;' +
      'font-family:inherit;color:#16202c;box-shadow:0 20px 50px rgba(22,32,44,.2)';
    dialog.innerHTML =
      '<h3 style="font-size:19px;margin-bottom:10px">Como usar o painel</h3>' +
      '<p style="font-size:14.5px;color:#4a5566;margin:0 0 12px">' +
      'A aba <b>Avalia\u00e7\u00e3o de controles</b> mostra a base completa do Monitoring com a vis\u00e3o por frequ\u00eancia no topo. ' +
      'Os filtros da parte de baixo s\u00e3o independentes dessa vis\u00e3o e alimentam a tabela e os downloads.</p>' +
      '<p style="font-size:14.5px;color:#4a5566;margin:0 0 12px">' +
      'A aba <b>SA1: ICR Brasil \u00d7 Holding</b> mostra onde cada SA1 est\u00e1: em valida\u00e7\u00e3o do ICR Brasil, ' +
      'aguardando a Holding ou j\u00e1 aprovado, com as listas por respons\u00e1vel. A aba <b>Painel SA1</b> mostra com quem est\u00e1 cada SA1, ' +
      'o avan\u00e7o de valida\u00e7\u00e3o por respons\u00e1vel do ICR Divisional e a lista de pedidos de altera\u00e7\u00e3o de desenho.</p>' +
      '<p style="font-size:14.5px;color:#4a5566;margin:0 0 16px">' +
      'Fontes desta carga: <b>' + esc(RAW.monitoring.file) + '</b> e <b>' + esc(RAW.issues.file) + '</b>. ' +
      '<b>Atualizar dados</b> consulta as pastas de Monitoring e Report Issue no SharePoint, baixa a planilha ' +
      'mais recente de cada uma quando mudou e reconstr\u00f3i a base das tr\u00eas abas. Na primeira vez o navegador ' +
      'auxiliar abre para o login corporativo; depois disso a verifica\u00e7\u00e3o \u00e9 autom\u00e1tica.</p>' +
      '<p style="font-size:14.5px;color:#4a5566;margin:0 0 16px">' +
      'No link publicado (netlify.app) o painel funciona em qualquer lugar, mas <b>Atualizar dados</b> depende ' +
      'desta m\u00e1quina: mantenha o <b>Abrir Dashboard.cmd</b> aberto e a p\u00e1gina passa a ler as planilhas do ' +
      'SharePoint assim que voc\u00ea clicar no bot\u00e3o.</p>' +
      '<button type="button" class="btn btn-dark">Fechar</button>';
    document.body.appendChild(dialog);
    dialog.querySelector('button').onclick = function () { dialog.close(); dialog.remove(); };
    dialog.addEventListener('close', function () { dialog.remove(); });
    dialog.showModal();
  }

  // ---------------------------------------------------------------- wire up

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.onclick = function () {
      var view = tab.getAttribute('data-view');
      state.view = view;
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
        var active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      ['avaliacao', 'holding', 'painel'].forEach(function (v) {
        document.getElementById('view-' + v).hidden = v !== view;
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  });

  Array.prototype.forEach.call(document.querySelectorAll('#structSort .segmented-item'), function (btn) {
    btn.onclick = function () {
      state.sort = btn.getAttribute('data-sort');
      Array.prototype.forEach.call(document.querySelectorAll('#structSort .segmented-item'), function (b) {
        b.classList.toggle('is-active', b === btn);
      });
      renderStructures(visionRows(), statsOf(visionRows()));
    };
  });

  document.getElementById('refreshBtn').onclick = refresh;
  probeAgent();
  document.getElementById('helpLink').onclick = function (e) { e.preventDefault(); showHelp(); };
  bindSections();
  document.getElementById('downloadPdf').onclick = downloadPdf;

  document.getElementById('downloadExcel').onclick = function () {
    exportXlsx('controles_brasil', [
      { label: 'C\u00f3digo do controle', value: function (c) { return c.c; } },
      { label: 'Descri\u00e7\u00e3o do controle', value: function (c) { return c.d; } },
      { label: 'Frequ\u00eancia', value: function (c) { return c.f; } },
      { label: 'Control owners', value: function (c) { return c.ow.join('; '); } },
      { label: 'Estrutura', value: function (c) { return c.s; } },
      { label: 'Status', value: function (c) { return c.r; } },
      { label: 'Avalia\u00e7\u00e3o atribu\u00edda a', value: function (c) { return c.t; } },
      { label: 'Issue', value: function (c) { return c.i ? c.i.st : ''; } },
      { label: 'Avaliador (tester)', value: function (c) { return c.i ? c.i.ow : ''; } },
      { label: 'Aprovador Holding', value: function (c) { return c.i ? c.i.hd : ''; } }
    ], filteredRows());
  };

  init();
})();
