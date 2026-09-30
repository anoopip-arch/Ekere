/* Year tab of the lakes dashboard.
 * Shows one lake: year.html?lake=<slug>
 * Reads data/<slug>.js (written by build_lake_year.py) and frames/<slug>/YYYY-MM_drawing.svg or _classes.jpg.
 * Sections: 1 settings and rules, 2 loading, 3 helpers, 4 rules, 5 drawing, 6 controls.
 */
(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════
  // 1. SETTINGS AND RULE THRESHOLDS (the only place to change them)
  // ════════════════════════════════════════════════════════════════════════
  const LAYERS = [                       // habitat layers, bottom-up in the legend
    ['water', 'Open water', '--water'],
    ['veg_on_water', 'Vegetation on water', '--vow'],
    ['veg_permanent', 'Permanent vegetation', '--perm'],
    ['veg_unknown', 'Vegetation, origin unknown', '--unk'],
    ['veg_on_bed', 'Vegetation on exposed bed', '--vob'],
    ['exposed_and_bund', 'Exposed bed and bund', '--bed']
  ];
  const VEG = ['veg_on_water', 'veg_permanent', 'veg_unknown', 'veg_on_bed'];
  const VEG_NAMES = { veg_on_water: 'on water', veg_on_bed: 'on exposed bed',
                      veg_permanent: 'permanent', veg_unknown: 'of unknown origin' };

  const INAT_ROWS = [                    // other wildlife rows, from iNaturalist
    ['lepidoptera', 'Butterflies and moths'], ['odonata', 'Dragonflies and damselflies'], ['spiders', 'Spiders'], ['amphibians', 'Amphibians']
  ];
  const MICROHABITATS = [                // bird rows, coloured to match the habitat layers
    ['Deep Water', '--water'], ['Shallow Water', '--shallow'],
    ['Water with Shoreline', '--bed'], ['Water with Vegetation', '--vow']
  ];

  const STATE = {                        // lake state, as shares of the lake outline
    dryWaterBelow: 0.10, dryExposedAtLeast: 0.5,
    vegAtLeast: 0.5, openAtLeast: 0.6, drawnAtLeast: 0.2
  };
  const FINDING_VEG_SHARE = 1 / 3;       // vegetation leads the finding if it dominated this share of clear months

  const WQ_ROWS = [['DO', 'DO', 'mg/L'], ['BOD', 'BOD', 'mg/L']];
  const WQ_STANDARDS = {                 // CPCB designated-best-use criteria
    DO:  { test: v => v < 4,              text: 'below 4 mg/L, the Class D (wildlife and fisheries) minimum' },
    pH:  { test: v => v < 6.5 || v > 8.5, text: 'outside 6.5–8.5, the Class D range' },
    BOD: { test: v => v > 3,              text: 'above 3 mg/L, the Class B/C limit' }
  };
  const WQ_SWING = {                     // unusual for this lake: beyond quartiles ± 1.5 × IQR
    keys: { DO: 'dissolved oxygen', BOD: 'BOD', pH: 'pH', Fecal_Coliform: 'fecal coliform',
            Total_Coliform: 'total coliform', Nitrate: 'nitrate', TDS: 'TDS', Turbidity: 'turbidity' },
    iqrFactor: 1.5, minReadings: 8
  };

  const SEASON_RANGE = [2015, 2024];   // fallback only; each lake's own years are set as 'years' in build_lake_year.py
  const PLAY_MS = 1100;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                  'August', 'September', 'October', 'November', 'December'];

  // ════════════════════════════════════════════════════════════════════════
  // 2. LOADING (a script tag, so it also works when the page is opened as a file)
  // ════════════════════════════════════════════════════════════════════════
  const slug = new URLSearchParams(location.search).get('lake');
  const $ = id => document.getElementById(id);

  function load() {
    if (!slug) return fail('No lake given. Open this page as year.html?lake=<lake id>.');
    const s = document.createElement('script');
    s.src = `data/${slug}.js?v=${Date.now()}`;   // always the latest build
    s.onload = () => (window.LAKE_YEAR ? start(window.LAKE_YEAR) : fail(`data/${slug}.js has no data.`));
    s.onerror = () => fail(`No data for this lake yet (data/${slug}.js). Run build_lake_year.py.`);
    document.head.appendChild(s);
  }
  function fail(msg) { $('finding').innerHTML = `<span class="error">${msg}</span>`; }

  // ════════════════════════════════════════════════════════════════════════
  // 3. HELPERS
  // ════════════════════════════════════════════════════════════════════════
  const monthsOfSeason = s => Array.from({ length: 12 }, (_, i) => {
    const y = s + (i >= 7 ? 1 : 0), m = ((i + 5) % 12) + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
  const seasonOf = m => { const [y, mm] = m.split('-').map(Number); return mm >= 6 ? y : y - 1; };
  const monthName = m => MONTHS[+m.split('-')[1] - 1];
  const monthShort = m => monthName(m).slice(0, 3);
  const monthLabel = m => `${monthShort(m)} ${m.slice(0, 4)}`;
  const fortnightLabel = f => `${f.endsWith('a') ? 'early' : 'late'} ${monthShort(f.slice(0, 7))} ${f.slice(0, 4)}`;
  const fmt = n => (n === null || n === undefined ? 'n/a' : Number(n).toLocaleString('en-IN'));
  const r1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

  // ════════════════════════════════════════════════════════════════════════
  // 4. RULES
  // ════════════════════════════════════════════════════════════════════════
  function makeRules(D) {
    const A = D.area_ha;
    const vegTotal = h => VEG.reduce((a, k) => a + h[k], 0);

    function lakeState(h) {
      if (!h) return { name: 'No clear image', short: '', color: 'var(--gap)', text: 'var(--muted)' };
      const w = h.water / A, v = vegTotal(h) / A, e = h.exposed_and_bund / A;
      if (w < STATE.dryWaterBelow && e >= STATE.dryExposedAtLeast) return { name: 'Dry', short: 'Dry', color: 'var(--bed)' };
      if (v >= STATE.vegAtLeast) return { name: 'Vegetation-dominated', short: 'Veg', color: 'var(--vow)' };
      if (w >= STATE.openAtLeast) return { name: e >= STATE.drawnAtLeast ? 'Open, drawn down' : 'Open', short: 'Open', color: 'var(--water)' };
      if (e >= STATE.drawnAtLeast) return { name: 'Drawn down', short: 'Drawn', color: 'var(--bed)' };
      return { name: 'Mixed', short: 'Mix', color: 'var(--ph)' };
    }

    // One key finding, by priority: vegetation, dry, drawdown, open water.
    function keyFinding(months) {
      const rows = months.map(m => D.habitat[m] && { m, ...D.habitat[m] }).filter(Boolean);
      if (!rows.length) return 'No clear satellite images this year.';
      const N = rows.length, pick = f => rows.filter(f);
      const span = sel => {
        const run = sel.every((r, k) => k === 0 || rows.indexOf(r) === rows.indexOf(sel[k - 1]) + 1);
        return run && sel.length > 1 ? ` (${monthName(sel[0].m)} to ${monthName(sel[sel.length - 1].m)})` : '';
      };
      const veg = pick(r => vegTotal(r) / A >= STATE.vegAtLeast);
      if (veg.length && veg.length >= N * FINDING_VEG_SHARE)
        return `Vegetation covered more than half the lake in ${veg.length} of ${N} clear months${span(veg)}.`;
      const dry = pick(r => lakeState(r).name === 'Dry');
      if (dry.length) return `The lake was dry in ${dry.length} of ${N} clear months${span(dry)}.`;
      const dd = pick(r => r.exposed_and_bund / A >= STATE.drawnAtLeast);
      if (dd.length) {
        const pk = dd.reduce((a, b) => (b.exposed_and_bund > a.exposed_and_bund ? b : a));
        return `The lake was drawn down in ${dd.length} of ${N} clear months, exposing up to ${r1(pk.exposed_and_bund)} ha of bed in ${monthName(pk.m)}.`;
      }
      const open = pick(r => r.water / A >= STATE.openAtLeast);
      return `Open water covered most of the lake in ${open.length} of ${N} clear months${span(open)}.`;
    }

    // Water quality: standards, swings against the lake's own record, and a data check.
    const WQ = D.water_quality || {};
    const badColiform = w => w.Fecal_Coliform != null && w.Total_Coliform != null && w.Fecal_Coliform > w.Total_Coliform;
    const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y), p = (s.length - 1) * q, b = Math.floor(p);
      return s[b] + (s[Math.min(b + 1, s.length - 1)] - s[b]) * (p - b); };
    const fences = {};
    Object.keys(WQ_SWING.keys).forEach(k => {
      const vals = Object.values(WQ).filter(w => w[k] != null && !(k.includes('Coliform') && badColiform(w))).map(w => w[k]);
      if (vals.length < WQ_SWING.minReadings) return;
      const q1 = quantile(vals, 0.25), q3 = quantile(vals, 0.75), r = q3 - q1;
      fences[k] = [q1 - WQ_SWING.iqrFactor * r, q3 + WQ_SWING.iqrFactor * r];
    });
    function wqFlags(m) {
      const w = WQ[m]; if (!w) return null;
      const f = { breach: {}, swing: {}, bad: badColiform(w) };
      Object.entries(WQ_STANDARDS).forEach(([k, s]) => { if (w[k] != null && s.test(w[k])) f.breach[k] = s.text; });
      Object.entries(fences).forEach(([k, [lo, hi]]) => {
        if (w[k] == null || (k.includes('Coliform') && f.bad)) return;
        if (w[k] > hi) f.swing[k] = 'high'; else if (w[k] < lo) f.swing[k] = 'low';
      });
      return f;
    }

    function highlights(season) {
      const out = [];
      const mig = (D.migrants || {})[String(season)];
      if (mig && mig.arrive) out.push([mig.arrive.slice(0, 7), `Winter migrants arrive (${fortnightLabel(mig.arrive)}).`, '']);
      if (mig && mig.leave) out.push([mig.leave.slice(0, 7), `Winter migrants leave (${fortnightLabel(mig.leave)}).`, '']);
      monthsOfSeason(season).forEach(m => {
        const f = wqFlags(m); if (!f) return;
        const w = WQ[m], parts = [];
        if (f.breach.DO) parts.push(`Dissolved oxygen ${w.DO} mg/L, ${f.breach.DO}`);
        if (f.breach.pH) parts.push(`pH ${w.pH}, ${f.breach.pH}`);
        const sw = Object.keys(f.swing);
        if (sw.length) parts.push(`Unusually ${sw.every(k => f.swing[k] === 'low') ? 'low' : 'high'} for this lake: ` +
                                  sw.map(k => `${WQ_SWING.keys[k]} ${fmt(w[k])}`).join(', '));
        if (f.bad) parts.push('Coliform values inconsistent (fecal above total), not used');
        if (parts.length) out.push([m, `Water quality: ${parts.join('. ')}.`, 'wq']);
      });
      return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    }

    return { vegTotal, lakeState, keyFinding, wqFlags, highlights };
  }

  // ════════════════════════════════════════════════════════════════════════
  // 5. DRAWING
  // ════════════════════════════════════════════════════════════════════════
  function start(D) {
    const R = makeRules(D);
    const tl = $('timeline');
    let season, months, cur = 0, timer = null;

    // colour scale for bird rows: one scale per microhabitat, across all months
    const birdMax = {};
    MICROHABITATS.forEach(([g]) => { birdMax[g] = Math.max(1, ...Object.values(D.birds).map(b => b[g] || 0)); });

    // seasons with any habitat or bird data
    const seasons = [...new Set([...Object.keys(D.habitat), ...Object.keys(D.birds)].map(seasonOf))]
      .filter(s => s >= (D.years || SEASON_RANGE)[0] && s <= (D.years || SEASON_RANGE)[1])
      .filter(s => monthsOfSeason(s).some(m => D.habitat[m])).sort((a, b) => a - b);

    $('eyebrow').textContent = 'A year at the lake · June to May';
    const sel = $('season');
    seasons.forEach(s => sel.appendChild(new Option(`${s}–${String(s + 1).slice(2)}`, s)));

    function row(cls, label, cellFn) {
      const r = el('div', `row ${cls}`), l = el('div', 'lab', label);
      r.appendChild(l);
      months.forEach((m, i) => { const c = el('div', 'c'); c.dataset.i = i; cellFn(c, m, i); r.appendChild(c); });
      tl.appendChild(r);
      return r;
    }
    const group = t => tl.appendChild(el('div', 'group', t));

    function drawTimeline() {
      tl.innerHTML = '';
      row('months', '', (c, m) => { c.textContent = monthShort(m); c.title = monthLabel(m); });

      group('Migrant seasons');
      const mig = (D.migrants || {})[String(season)] || {};
      const ai = mig.arrive ? months.indexOf(mig.arrive.slice(0, 7)) : -1;
      const di = mig.leave ? months.indexOf(mig.leave.slice(0, 7)) : -1;
      row('season', '<b>Winter migrants</b>', (c, m, i) => {
        if (ai < 0 || di < 0 || i < ai || i > di) {
          if (i === 0 && (ai < 0 || di < 0)) c.appendChild(el('span', 'note-cell', 'Not enough records to date the season'));
          return;
        }
        c.appendChild(el('div', `bar${i === ai ? ' start' : ''}${i === di ? ' end' : ''}`));
        if (i === ai) { const f = el('span', 'flag', `arrive ${fortnightLabel(mig.arrive).split(' ').slice(0, 2).join(' ')}`); f.style.left = '4px'; c.appendChild(f); }
        if (i === di) { const f = el('span', 'flag', `leave ${fortnightLabel(mig.leave).split(' ').slice(0, 2).join(' ')}`); f.style.right = '4px'; c.appendChild(f); }
        c.title = `Winter migrants present: ${fortnightLabel(mig.arrive)} to ${fortnightLabel(mig.leave)}`;
      });
      const nw = D.winter_migrant_species;
      const wMax = Math.max(1, ...months.map(m => (D.birds[m] || {}).winter_species || 0));
      row('birds', `<b>Species recorded</b>${nw ? `of ${nw} winter migrants` : ''}`, (c, m) => {
        const b = D.birds[m];
        if (!b || !b.checklists || b.winter_species == null) { c.classList.add('none'); c.title = 'No checklists'; return; }
        c.style.background = `color-mix(in srgb, var(--ink) ${Math.round(6 + 40 * b.winter_species / wMax)}%, transparent)`;
        if (b.winter_species / wMax > 0.6) c.style.color = '#fff';
        c.textContent = b.winter_species;
        c.title = `${b.winter_species}${nw ? ` of ${nw}` : ''} winter-migrant species recorded (${b.checklists} checklists)`;
      });

      group('Lake state');
      row('state-row', '<b>From the map</b>', (c, m) => {
        const s = R.lakeState(D.habitat[m]);
        c.style.background = s.color; if (s.text) c.style.color = s.text;
        c.textContent = s.short; c.title = s.name;
      });

      group('Birds: species recorded');
      MICROHABITATS.forEach(([g, col]) => {
        const n = (D.species_per_microhabitat || {})[g];
        row('birds', `<b>${g}</b>`, (c, m) => {
          const b = D.birds[m];
          if (!b || !b.checklists) { c.classList.add('none'); c.title = 'No checklists'; return; }
          c.style.background = `color-mix(in srgb, var(${col}) ${Math.round(10 + 75 * b[g] / birdMax[g])}%, transparent)`;
          c.textContent = b[g];
          c.title = `${g}: ${b[g]}${n ? ` of ${n}` : ''} species recorded (${b.checklists} checklists)`;
        });
      });
      row('months', '<span>Checklists</span>', (c, m) => { c.textContent = (D.birds[m] || {}).checklists || 0; });

      if (D.inat && Object.keys(D.inat).length) {
        group('Other wildlife: species recorded (iNaturalist)');
        INAT_ROWS.forEach(([k, name]) => {
          const max = Math.max(1, ...Object.values(D.inat).map(r => r[k] || 0));
          if (!Object.values(D.inat).some(r => k in r)) return;   // data built before this row existed
          row('birds', `<b>${name}</b>`, (c, m) => {
            const r = D.inat[m];
            if (!r) { c.classList.add('none'); c.title = 'No iNaturalist records'; return; }
            c.style.background = `color-mix(in srgb, var(--inat) ${Math.round(8 + 42 * r[k] / max)}%, transparent)`;
            c.textContent = r[k];
            c.title = `${name}: ${r[k]} species recorded (${r.observations} iNaturalist observations)`;
          });
        });
        row('months', '<span>Observations</span>', (c, m) => { c.textContent = (D.inat[m] || {}).observations || 0; });
      }

      if (D.wq_station) {
        group(`Water quality (KSPCB station ${D.wq_station})`);
        row('wq', '<b>WQI</b>band and rank', (c, m) => {
          const w = (D.water_quality || {})[m];
          if (!w || w.WQI == null) { c.classList.add('none'); c.title = 'No reading for this month'; return; }
          c.classList.add('band-' + String(w.WQI_Class).toLowerCase().replace(/\s+/g, '-'));
          c.textContent = Math.round(w.WQI);
          c.title = `WQI ${w.WQI} (${w.WQI_Class})` + (w.wqi_rank ? `, ${ordinal(w.wqi_rank)} of ${w.wqi_of} lakes this month` : '');
        });
        WQ_ROWS.forEach(([key, label, unit]) => {
          row('wq', `<b>${label}</b>${unit}`, (c, m) => {
            const w = (D.water_quality || {})[m];
            if (!w || w[key] == null) { c.classList.add('none'); c.title = 'No reading for this month'; return; }
            const f = R.wqFlags(m);
            if (f.breach[key]) c.classList.add('breach');
            if (f.swing[key]) c.classList.add('swing');
            c.textContent = w[key];
            c.title = `${label} ${w[key]} ${unit}` + (f.breach[key] ? `. ${f.breach[key]}` : '') + (f.swing[key] ? '. Unusual for this lake.' : '');
          });
        });
      }
    }

    function drawHighlights() {
      const list = $('highlights'); list.innerHTML = '';
      const items = R.highlights(season);
      if (!items.length) list.appendChild(el('li', '', '<span class="when"></span><span>Nothing flagged this year.</span>'));
      items.forEach(([m, text, kind]) =>
        list.appendChild(el('li', '', `<span class="when">${monthLabel(m)}</span><span class="${kind}">${text}</span>`)));
    }

    let view = 'photo';                   // map view: 'photo' (satellite, default) or 'drawing'
    function drawFrame(m) {
      const h = D.habitat[m], frame = $('frame'), note = $('frame-note');
      frame.innerHTML = '';
      if (!h) { frame.appendChild(el('div', 'empty', 'No clear image<br>(monsoon cloud)')); note.textContent = ''; return; }
      const img = new Image();
      img.alt = `${D.name} on ${h.date}, coloured by habitat layer`;
      // look in frames/<lake>/ first, then in ../frames_<lake>/ (a folder next to lake_year);
      // the drawing first when that view is chosen, the satellite frame otherwise or as fallback
      const folders = [`frames/${slug}/`, `../frames_${slug}/`];
      const photos = folders.map(f => `${f}${m}_classes.jpg`);
      const drawings = folders.map(f => `${f}${m}_drawing.svg`);
      const places = view === 'drawing' ? [...drawings, ...photos] : photos;
      img.onload = () => {
        // let the map box take this image's own shape, so tall or wide lakes are not cut off
        frame.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'contain' });
        note.textContent = img.src.endsWith('_drawing.svg')
          ? `Drawn from the Sentinel-2 scene of ${h.date}.`
          : `Sentinel-2 scene, ${h.date}. Yellow line = lake outline.`; };
      let tryNo = 0;
      img.onerror = () => {
        tryNo += 1;
        if (tryNo < places.length) { img.src = places[tryNo]; return; }
        frame.innerHTML = '';
        frame.appendChild(el('div', 'empty', `Map image not added yet<br>(${m}_classes.jpg)`));
        note.textContent = `Sentinel-2 scene, ${h.date}. The figures alongside are from this scene.`; };
      img.src = places[0];
      frame.appendChild(img);
    }
    document.querySelectorAll('.view button').forEach(btn => btn.addEventListener('click', () => {
      view = btn.dataset.view;
      document.querySelectorAll('.view button').forEach(b => b.setAttribute('aria-pressed', b === btn));
      drawFrame(months[cur]);
    }));

    function drawReadout(m) {
      const h = D.habitat[m], s = R.lakeState(h), b = D.birds[m], w = (D.water_quality || {})[m];
      $('r-month').textContent = monthLabel(m);
      $('r-state').textContent = s.name;
      $('r-state').style.color = h ? s.color : 'var(--muted)';
      $('r-habitat').innerHTML = h
        ? LAYERS.map(([k, n, col]) => `<dt><i class="sw" style="background:var(${col})"></i>${n}</dt><dd class="num">${r1(h[k])} ha</dd>`).join('')
        : '<dt>Habitat</dt><dd style="text-align:left">No clear satellite image this month.</dd>';
      $('r-wq').textContent = !D.wq_station ? '' : w
        && w.WQI != null
        ? `Water quality: WQI ${Math.round(w.WQI)} (${w.WQI_Class})${w.wqi_rank ? `, ${ordinal(w.wqi_rank)} of ${w.wqi_of} lakes` : ''}.`
        : 'Water quality: no reading for this month.';
      $('r-birds').textContent = b && b.checklists
        ? `Birds: ${b.species} species recorded in ${b.checklists} checklists, ${b.waterbird_species} of them waterbirds.`
        : 'Birds: no checklists this month.';
    }

    function drawStatic() {
      $('legend').innerHTML = LAYERS.map(([, n, col]) => `<span><i class="sw" style="background:var(${col})"></i>${n}</span>`).join('') +
        '<span>Hatched = no clear satellite image</span>' +
        `<span>States: Open ≥${STATE.openAtLeast * 100}% water · Drawn down ≥${STATE.drawnAtLeast * 100}% exposed · Vegetation-dominated ≥${STATE.vegAtLeast * 100}% vegetation</span>`;
      $('about').innerHTML = '<b>About the data.</b> Satellite imagery: Sentinel-2. Bird data: eBird complete checklists. Other wildlife: iNaturalist research-grade and needs-ID records named to species; counts follow how many observations were made. ' +
        'Winter migrants arrive in the first fortnight when checklists average at least one winter-migrant species, and leave after the last. ' +
        (D.wq_station ? `Water quality: monthly KSPCB readings for station ${D.wq_station}. WQI is the project's water quality index (higher is cleaner); the rank is among all KSPCB-monitored lakes that month. DO and BOD: tinted cells fail the national (CPCB) standard. ` +
          'Outlined cells, and the red-dot highlights, are unusual for this lake (beyond its quartiles ± 1.5 × interquartile range).' : '');
    }

    // ══════════════════════════════════════════════════════════════════════
    // 6. CONTROLS
    // ══════════════════════════════════════════════════════════════════════
    function select(i) {
      cur = i; $('month').value = i;
      tl.querySelectorAll('.c').forEach(c => c.classList.toggle('sel', +c.dataset.i === i));
      drawReadout(months[i]);
      drawFrame(months[i]);
    }
    function stop() { clearInterval(timer); timer = null; $('play').textContent = 'Play'; }
    function setSeason(s) {
      season = +s; months = monthsOfSeason(season); stop();
      $('finding').textContent = R.keyFinding(months);
      drawTimeline(); drawHighlights();
      const first = months.findIndex(m => D.habitat[m]);
      select(first < 0 ? 0 : first);
    }

    $('play').addEventListener('click', () => {
      if (timer) return stop();
      $('play').textContent = 'Pause';
      timer = setInterval(() => select((cur + 1) % 12), PLAY_MS);
    });
    $('month').addEventListener('input', e => { stop(); select(+e.target.value); });
    tl.addEventListener('click', e => { const c = e.target.closest('.c'); if (c) { stop(); select(+c.dataset.i); } });
    sel.addEventListener('change', () => setSeason(sel.value));

    drawStatic();
    if (!seasons.length) return fail('No clear satellite images for this lake yet.');
    // open on the latest season with a reasonable number of clear months
    const full = seasons.filter(s => monthsOfSeason(s).filter(m => D.habitat[m]).length >= 5);
    sel.value = (full.length ? full : seasons)[(full.length ? full : seasons).length - 1];
    setSeason(sel.value);
  }

  load();
})();
