// SPDX-FileCopyrightText: 2026 Макс and the Earth Analog team
// SPDX-License-Identifier: MIT

/**
 * i18n.js — interface language (English / Ukrainian).
 *
 *   t('key', {vars})       translated string; {name} placeholders are filled from vars
 *   pick(en, uk)           choose between two data values (sites.csv has *_en / *_uk)
 *   applyStatic()          fill [data-i18n] / [data-i18n-html] / [data-i18n-attr] in the page
 *   setLang('uk')          switch and notify onLangChange listeners (the app re-renders)
 *
 * Start-up language: #lang= in the URL → the last choice (localStorage) → browser
 * language (uk → Ukrainian, anything else → English).
 *
 * Values in t(...) that end up in innerHTML are escaped by the caller; strings whose
 * key ends in "Html" or that are used with data-i18n-html contain markup on purpose.
 */

export const LANGS = ['en', 'uk'];
const STORAGE_KEY = 'ea-lang';

const DICT = {
  /* ---------------- page chrome (index.html) ---------------- */
  'app.subtitle': { en: 'NASA Space Apps 2026 · Earth Analog', uk: 'NASA Space Apps 2026 · Earth Analog' },
  'meta.description': {
    en: 'Compare places on Earth with conditions on Mars and the lunar south pole. NASA Space Apps 2026 — Earth Analog challenge.',
    uk: 'Порівняння місць на Землі з умовами на Марсі та південному полюсі Місяця. NASA Space Apps 2026, завдання Earth Analog.',
  },
  'nav.sections': { en: 'Sections', uk: 'Розділи' },
  'lang.label': { en: 'Language', uk: 'Мова' },
  'tab.globe': { en: 'Globe', uk: 'Глобус' },
  'tab.map': { en: 'Map view', uk: 'Карти' },
  'nav.infographic': { en: 'Can humans live here?', uk: 'Чи можна тут жити?' },
  'tab.analysis': { en: 'Analysis', uk: 'Аналіз' },

  'intro.kicker': { en: 'Earth Analog · NASA Space Apps · 2026', uk: 'Earth Analog · NASA Space Apps · 2026' },
  'intro.title': {
    en: 'Where on <em class="hl hl--earth">Earth</em> is most like <em class="hl hl--mars">Mars</em> or <em class="hl hl--moon">the Moon</em>?',
    uk: 'Яке місце на <em class="hl hl--earth">Землі</em> найбільше схоже на <em class="hl hl--mars">Марс</em> чи <em class="hl hl--moon">Місяць</em>?',
  },
  'intro.lede': {
    en: 'Each glowing point is a place on Earth used to rehearse missions to another world. Click one to see how close it really is.',
    uk: 'Кожна світна точка — місце на Землі, де відпрацьовують місії на інші світи. Натисніть на неї, щоб побачити, наскільки воно справді схоже.',
  },
  'legend.mars': { en: 'Mars analog', uk: 'Аналог Марса' },
  'legend.moon': { en: 'Moon analog', uk: 'Аналог Місяця' },
  'globe.aria': { en: 'Explore Earth analogs on a globe', uk: 'Земні аналоги на глобусі' },
  'slot.earth': { en: 'Earth · analog', uk: 'Земля · аналог' },
  'slot.reference': { en: 'Reference', uk: 'Еталон' },
  'radar.kicker': { en: 'Similarity by criterion', uk: 'Схожість за критеріями' },
  'radar.aria': { en: 'Radar of the 8 similarity criteria', uk: 'Радар 8 критеріїв схожості' },
  'globe.back': { en: '← Back', uk: '← Назад' },
  'globe.hint': { en: 'Drag to rotate · click a glowing point or a region', uk: 'Тягніть, щоб обертати · натисніть на точку чи регіон' },

  'subnav.aria': { en: 'Map selection', uk: 'Вибір карти' },
  'compare.tab': { en: 'Compare', uk: 'Порівняння' },
  'compare.vs': { en: 'Earth vs', uk: 'Земля і' },
  'compare.aria': { en: 'Compare target', uk: 'З чим порівнювати' },

  'analysis.aria': { en: 'Analysis', uk: 'Аналіз' },
  'ctl.scenario': { en: 'Weighting scenario', uk: 'Сценарій ваг' },
  'ctl.reference': { en: 'Reference (Mars / Moon)', uk: 'Еталон (Марс / Місяць)' },
  'ctl.analog': { en: 'Earth analog', uk: 'Земний аналог' },
  'card.ranking': { en: 'Ranking', uk: 'Рейтинг' },
  'card.radar': { en: 'Analog vs reference', uk: 'Аналог і еталон' },
  'card.heatmap': { en: 'Heat map: all analogs × all references', uk: 'Теплова карта: усі аналоги × усі еталони' },
  'card.raw': { en: 'Raw parameters', uk: 'Вихідні параметри' },
  'card.limits': { en: 'Limits of the analogy', uk: 'Межі аналогії' },
  'btn.png': { en: 'Download PNG', uk: 'Завантажити PNG' },
  'limits.pdf': { en: 'Original (PDF, Ukrainian)', uk: 'Оригінал (PDF)' },
  'aria.ranking': { en: 'Ranking of Earth analogs for the selected reference', uk: 'Рейтинг земних аналогів для вибраного еталона' },
  'aria.radar': { en: 'Radar chart of the 8 similarity criteria', uk: 'Радарна діаграма 8 критеріїв схожості' },
  'aria.heatmap': { en: 'Heat map of similarity scores', uk: 'Теплова карта індексів схожості' },

  'sidebar.aria': { en: 'Site details', uk: 'Про локацію' },
  'sidebar.close': { en: 'Close details', uk: 'Закрити' },
  'sidebar.empty': { en: 'Click a marker on the map to see site details.', uk: 'Натисніть на мітку на карті, щоб побачити дані локації.' },

  'footer.note': {
    en: 'Grey-marked values are placeholders, not yet verified. Basemaps: OpenStreetMap, NASA Mars Trek, NASA Moon Trek. Charts: Chart.js.',
    uk: 'Значення із сірою позначкою тимчасові, їх ще не перевірено. Підкладки карт: OpenStreetMap, NASA Mars Trek, NASA Moon Trek. Графіки: Chart.js.',
  },
  'footer.credits': {
    en: 'Globe textures: Earth — <a href="https://visibleearth.nasa.gov/images/57752/blue-marble-land-surface-shallow-water-and-shaded-topography" target="_blank" rel="noopener">NASA Visible Earth, Blue Marble</a> (Reto Stöckli, NASA GSFC); Moon — <a href="https://svs.gsfc.nasa.gov/4720" target="_blank" rel="noopener">NASA\'s Scientific Visualization Studio, CGI Moon Kit</a> (LRO LROC); Mars — Viking MDIM 2.1 colour mosaic, NASA/JPL/USGS, via <a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener">NASA Mars Trek</a>.',
    uk: 'Текстури глобусів: Земля — <a href="https://visibleearth.nasa.gov/images/57752/blue-marble-land-surface-shallow-water-and-shaded-topography" target="_blank" rel="noopener">NASA Visible Earth, Blue Marble</a> (Reto Stöckli, NASA GSFC); Місяць — <a href="https://svs.gsfc.nasa.gov/4720" target="_blank" rel="noopener">NASA\'s Scientific Visualization Studio, CGI Moon Kit</a> (LRO LROC); Марс — кольорова мозаїка Viking MDIM 2.1, NASA/JPL/USGS, через <a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener">NASA Mars Trek</a>.',
  },
  'res.title': { en: 'Partner resources (CSA, ESA, JAXA)', uk: 'Партнерські ресурси (CSA, ESA, JAXA)' },
  'res.use': { en: 'Could help with:', uk: 'Може знадобитися для:' },
  'status.file': {
    en: 'Could not load the CSV files from a local file. Serve the folder over HTTP, e.g. <code>python -m http.server 8000</code>, then open <code>http://localhost:8000</code>.',
    uk: 'CSV-файли не завантажуються з локального файлу. Запустіть сервер у теці, наприклад <code>python -m http.server 8000</code>, і відкрийте <code>http://localhost:8000</code>.',
  },
  'status.error': { en: 'Could not load site data: {e}', uk: 'Не вдалося завантажити дані: {e}' },

  /* ---------------- bodies ---------------- */
  'body.earth': { en: 'Earth', uk: 'Земля' },
  'body.mars': { en: 'Mars', uk: 'Марс' },
  'body.moon': { en: 'Moon', uk: 'Місяць' },
  'bodyLong.earth': { en: 'Earth', uk: 'Земля' },
  'bodyLong.mars': { en: 'Mars', uk: 'Марс' },
  'bodyLong.moon': { en: 'Moon (South Pole)', uk: 'Місяць (південний полюс)' },

  /* ---------------- data labels (js/data.js, js/scores.js) ---------------- */
  'param.t_surf_min_c': { en: 'Surface temperature, min', uk: 'Температура поверхні, мін.' },
  'param.t_surf_mean_c': { en: 'Surface temperature, mean', uk: 'Температура поверхні, середня' },
  'param.t_surf_max_c': { en: 'Surface temperature, max', uk: 'Температура поверхні, макс.' },
  'param.crater_density_1e6km2': { en: 'Crater density', uk: 'Щільність кратерів' },
  'param.slope_mean_deg': { en: 'Mean slope', uk: 'Середній схил' },
  'param.relief_m': { en: 'Relief', uk: 'Рельєф' },
  'param.ice_water_frac': { en: 'Water ice fraction', uk: 'Частка водяного льоду' },
  'param.aridity_ai': { en: 'Aridity index', uk: 'Індекс аридності' },
  'param.rock_class': { en: 'Rock class', uk: 'Клас породи' },
  'param.sun_elev_max_deg': { en: 'Max solar elevation', uk: 'Макс. висота Сонця' },
  'param.sun_elev_min_deg': { en: 'Min solar elevation', uk: 'Мін. висота Сонця' },
  'unit.km2': { en: '/10⁶ km²', uk: '/10⁶ км²' },
  'unit.m': { en: 'm', uk: 'м' },

  'crit.temp_mean': { en: 'Mean temperature', uk: 'Середня температура' },
  'crit.temp_range': { en: 'Temperature range', uk: 'Розмах температур' },
  'crit.craters': { en: 'Crater density', uk: 'Щільність кратерів' },
  'crit.slope': { en: 'Slope', uk: 'Схил' },
  'crit.relief': { en: 'Relief', uk: 'Рельєф' },
  'crit.ice': { en: 'Water ice', uk: 'Водяний лід' },
  'crit.sun': { en: 'Solar elevation', uk: 'Висота Сонця' },
  'crit.rock': { en: 'Rock type', uk: 'Тип породи' },

  'scenario.auto': { en: 'Auto (per body)', uk: 'Авто (за небесним тілом)' },
  'scenario.equal': { en: 'Equal weights', uk: 'Рівні ваги' },
  'scenario.moon_base': { en: 'Moon base', uk: 'База на Місяці' },
  'scenario.mars_landing': { en: 'Mars landing', uk: 'Посадка на Марс' },

  'level.high': { en: 'High', uk: 'Висока' },
  'level.moderate': { en: 'Moderate', uk: 'Помірна' },
  'level.low': { en: 'Low', uk: 'Низька' },

  'status.literature': { en: 'Literature', uk: 'Література' },
  'status.literatureTip': { en: 'Value from published literature', uk: 'Значення з опублікованих джерел' },
  'status.computed': { en: 'Computed', uk: 'Обчислено' },
  'status.computedTip': { en: 'Computed from coordinates / formula', uk: 'Обчислено за координатами або формулою' },
  'status.shadowTip': {
    en: 'Computed: permanently shadowed by crater walls (max solar elevation set to 0°)',
    uk: 'Обчислено: постійна тінь від стінок кратера (макс. висота Сонця = 0°)',
  },
  'status.estimate': { en: 'Estimate', uk: 'Оцінка' },
  'status.test': { en: 'Test', uk: 'Тест' },
  'status.placeholder': { en: 'placeholder value, not yet verified', uk: 'тимчасове значення, ще не перевірене' },

  'coord.N': { en: 'N', uk: 'пн. ш.' },
  'coord.S': { en: 'S', uk: 'пд. ш.' },
  'coord.E': { en: 'E', uk: 'сх. д.' },
  'coord.W': { en: 'W', uk: 'зх. д.' },

  'rock.anorthosite': { en: 'anorthosite', uk: 'анортозит' },
  'rock.basalt': { en: 'basalt', uk: 'базальт' },
  'rock.carbonate': { en: 'carbonate', uk: 'карбонатні породи' },
  'rock.crystalline_felsic': { en: 'crystalline felsic', uk: 'кристалічні кислі породи' },
  'rock.evaporite': { en: 'evaporite', uk: 'евапорити' },
  'rock.glacial_till': { en: 'glacial till', uk: 'льодовикова морена' },
  'rock.impact_melt_breccia': { en: 'impact melt breccia', uk: 'брекчія ударного розплаву' },
  'rock.sedimentary_clastic': { en: 'sedimentary clastic', uk: 'уламкові осадові породи' },

  // sites.csv has region in English only
  'region.Aeolis Mons foothills': { uk: 'Підніжжя гори Еоліда' },
  'region.Artemis III candidate region': { uk: 'Район-кандидат для Artemis III' },
  'region.Crater floor (Maaz)': { uk: 'Дно кратера (формація Мааз)' },
  'region.Devon Island': { uk: 'Острів Девон' },
  'region.Ellesmere Island': { uk: 'Острів Елсмір' },
  'region.Labrador': { uk: 'Лабрадор' },
  'region.McMurdo Dry Valleys': { uk: 'Сухі долини Мак-Мердо' },
  'region.Namib Desert': { uk: 'Пустеля Наміб' },
  'region.Namib Desert (Gobabeb)': { uk: 'Пустеля Наміб (Гобабеб)' },
  'region.Permanently shadowed floor': { uk: 'Постійно затінене дно' },
  'region.Shackleton rim': { uk: 'Вал кратера Шеклтон' },
  'region.Vastitas Borealis': { uk: 'Північна рівнина (Vastitas Borealis)' },

  /* ---------------- popup & sidebar (js/app.js) ---------------- */
  'site.analogBadge.mars': { en: 'Earth · Mars analog', uk: 'Земля · аналог Марса' },
  'site.analogBadge.moon': { en: 'Earth · Moon analog', uk: 'Земля · аналог Місяця' },
  'site.earthSite': { en: 'Earth site', uk: 'Земна локація' },
  'site.refBadge.mars': { en: 'Mars · reference', uk: 'Марс · еталон' },
  'site.refBadge.moon': { en: 'Moon (South Pole) · reference', uk: 'Місяць (південний полюс) · еталон' },
  'photo.none': { en: 'No photo yet', uk: 'Фото ще немає' },
  'photo.soon': { en: 'Photo coming soon', uk: 'Фото буде згодом' },
  'photo.source': { en: 'Photo source', uk: 'Джерело фото' },
  'photo.unavailable': { en: 'Photo unavailable', uk: 'Фото недоступне' },
  'photo.prefix': { en: 'Photo:', uk: 'Фото:' },
  'pop.analogOfHtml': { en: 'Analog of: <strong>{name}</strong> ({body})', uk: 'Аналог для: <strong>{name}</strong> ({body})' },
  'pop.refOnHtml.mars': { en: 'Reference site on <strong>Mars</strong>', uk: 'Еталонна локація на <strong>Марсі</strong>' },
  'pop.refOnHtml.moon': { en: 'Reference site on <strong>the Moon</strong>', uk: 'Еталонна локація на <strong>Місяці</strong>' },
  'pop.limits': { en: 'Limits:', uk: 'Обмеження:' },
  'pop.more': { en: 'More details', uk: 'Детальніше' },

  'sb.scenario': { en: 'Scenario', uk: 'Сценарій' },
  'sb.score': { en: 'Similarity score', uk: 'Індекс схожості' },
  'sb.computedTip': { en: 'Computed by analysis/metrics.py (scores.csv)', uk: 'Обчислено скриптом analysis/metrics.py (scores.csv)' },
  'sb.vsHtml': { en: 'vs <strong>{ref}</strong>', uk: 'еталон: <strong>{ref}</strong>' },
  'sb.intendedPair': { en: ' (intended pair)', uk: ' (задумана пара)' },
  'sb.coverage': { en: 'coverage {v}', uk: 'покриття {v}' },
  'sb.pairTag': { en: 'pair', uk: 'пара' },
  'sb.pairTitle': { en: 'Intended pair', uk: 'Задумана пара' },
  'sb.weight': { en: 'weight {w}', uk: 'вага {w}' },
  'sb.gainTip': { en: 'Score gain if this criterion matched exactly', uk: 'Наскільки зросте індекс, якщо цей критерій збігатиметься повністю' },
  'sb.matchTitle': { en: 'What matches / What doesn\'t', uk: 'Що збігається, а що ні' },
  'sb.matchCaptionHtml': { en: 'Per-criterion similarity s from <code>scores.csv</code> · match = s ≥ {t}', uk: 'Схожість s за кожним критерієм із <code>scores.csv</code> · збіг = s ≥ {t}' },
  'sb.matches': { en: 'What matches', uk: 'Що збігається' },
  'sb.mismatches': { en: 'What doesn\'t', uk: 'Що не збігається' },
  'sb.noMatch': { en: 'No criterion is close enough.', uk: 'Жоден критерій не достатньо близький.' },
  'sb.allMatch': { en: 'Everything compared is within range.', uk: 'Усі порівняні критерії в межах норми.' },
  'sb.skipped': { en: 'Not compared (missing data or zero weight): {list}', uk: 'Не порівнювалось (немає даних або нульова вага): {list}' },
  'sb.gapTitle': { en: 'How to close the gap', uk: 'Як компенсувати обмеження' },
  'sb.gapCaptionHtml': {
    en: 'Criteria with similarity s &lt; {t} vs <strong>{ref}</strong>, with methods from the team’s <em>Limits of the analogy</em> documents (<code>{file}</code>).',
    uk: 'Критерії зі схожістю s &lt; {t} (еталон: <strong>{ref}</strong>) і способи з командних документів <em>«Межі аналогії»</em> (<code>{file}</code>).',
  },
  'sb.gapNone': { en: 'No criterion is below {t}.', uk: 'Немає критеріїв нижче {t}.' },
  'sb.addresses': { en: 'Addresses: {list}', uk: 'Стосується: {list}' },
  'sb.noMitigation': { en: 'No mitigation listed.', uk: 'Способу компенсації не вказано.' },
  'sb.earthVsTargetHtml': { en: 'Earth {a} <span class="vs">vs</span> target {b}', uk: 'Земля {a} <span class="vs">·</span> еталон {b}' },
  'sb.params': { en: 'Parameters', uk: 'Параметри' },
  'sb.legendHtml': {
    en: '<span class="st st--literature">L</span> literature <span class="st st--computed">C</span> computed <span class="st st--placeholder">T</span><span class="st st--placeholder">E</span> test / estimate — placeholder value, not yet verified',
    uk: '<span class="st st--literature">L</span> література <span class="st st--computed">C</span> обчислено <span class="st st--placeholder">T</span><span class="st st--placeholder">E</span> тест / оцінка — тимчасове значення, ще не перевірене',
  },
  'sb.placeholderWarn': {
    en: 'Values marked T / E are placeholders for UI development; do not cite them.',
    uk: 'Значення з позначками T / E — тимчасові заглушки для розробки інтерфейсу; не цитуйте їх.',
  },
  'sb.limitsBtn.mars': { en: 'What Earth can’t reproduce on Mars →', uk: 'Межі аналогії із Марсом →' },
  'sb.limitsBtn.moon': { en: 'What Earth can’t reproduce on the Moon →', uk: 'Межі аналогії з Місяцем →' },
  'sb.similarity': { en: 'Similarity', uk: 'Схожість' },
  'sb.noRef': { en: 'No reference to compare with.', uk: 'Немає еталона для порівняння.' },
  'sb.compareBtn': { en: 'Compare with reference', uk: 'Порівняти з еталоном' },
  'sb.comparedWith': { en: 'Compared with', uk: 'Порівняння з еталонами' },
  'sb.bestAnalogs': { en: 'Best Earth analogs', uk: 'Найкращі земні аналоги' },
  'sb.openAnalysis': { en: 'Open in Analysis', uk: 'Відкрити в «Аналізі»' },

  /* ---------------- limits card ---------------- */
  'lim.title.mars': { en: 'Limits of the analogy: Earth — Mars', uk: 'Межі аналогії: Земля — Марс' },
  'lim.title.moon': { en: 'Limits of the analogy: Earth — Moon', uk: 'Межі аналогії: Земля — Місяць' },
  'lim.cant': { en: 'What Earth can’t reproduce', uk: 'Чого Земля не відтворює' },
  'lim.factor': { en: 'Factor', uk: 'Фактор' },
  'lim.why': { en: 'Why it matters', uk: 'Чому це важливо' },
  'lim.general': { en: 'General (no specific factor)', uk: 'Загальне (без конкретного фактора)' },
  'lim.criteria': { en: 'criteria:', uk: 'критерії:' },

  /* ---------------- analysis view ---------------- */
  'an.noData': { en: 'Data not loaded.', uk: 'Дані не завантажено.' },
  'an.noChart': { en: 'Chart.js failed to load.', uk: 'Не вдалося завантажити Chart.js.' },
  'an.pair': { en: ' (pair)', uk: ' (пара)' },
  'an.noteAutoHtml': {
    en: 'Auto: each reference uses its body\'s scenario (Mars — {mars}, Moon — {moon}), as in <code>ranking.csv</code>. The heat map uses equal weights so Mars and Moon columns are comparable.',
    uk: 'Авто: кожен еталон використовує сценарій свого небесного тіла (Марс — {mars}, Місяць — {moon}), як у <code>ranking.csv</code>. Теплова карта використовує рівні ваги, щоб стовпці Марса й Місяця можна було порівнювати.',
  },
  'an.noteOneHtml': { en: 'All charts use the {s} scenario from <code>scores.csv</code>.', uk: 'Усі графіки побудовано за сценарієм «{s}» із <code>scores.csv</code>.' },
  'an.rawPngTitle': { en: '{a} vs {r} — raw parameters', uk: '{a} і {r} — вихідні параметри' },

  /* ---------------- globe ---------------- */
  'gl.badge.mars': { en: 'Analog of Mars', uk: 'Аналог Марса' },
  'gl.badge.moon': { en: 'Analog of Moon', uk: 'Аналог Місяця' },
  'gl.groupBadge.mars': { en: 'Analogs of Mars', uk: 'Аналоги Марса' },
  'gl.groupBadge.moon': { en: 'Analogs of Moon', uk: 'Аналоги Місяця' },
  'gl.groupBadge.mixed': { en: 'Mars & Moon analogs', uk: 'Аналоги Марса й Місяця' },
  'gl.similarity': { en: 'Similarity', uk: 'Схожість' },
  'gl.vsLine': { en: 'vs {ref} · {scn}', uk: 'еталон: {ref} · {scn}' },
  'gl.refLine': { en: 'vs {ref}', uk: 'еталон: {ref}' },
  'gl.compare.mars': { en: 'Compare with Mars', uk: 'Порівняти з Марсом' },
  'gl.compare.moon': { en: 'Compare with the Moon', uk: 'Порівняти з Місяцем' },
  'gl.openMap': { en: 'Open in Map view', uk: 'Відкрити на карті' },
  'gl.partOfHtml': { en: 'Part of <strong>{g}</strong> · {n} · “Back” returns to the list', uk: 'Входить до групи <strong>{g}</strong> · {n} · «Назад» повертає до списку' },
  'gl.groupText': {
    en: 'These sites lie too close together to pick on the whole globe, so they are spread out on a small ring. Thin lines lead to each exact location.',
    uk: 'Ці локації лежать надто близько, щоб вибрати їх на всьому глобусі, тому їх розставлено на невеликому кільці. Тонкі лінії ведуть до точного місця кожної.',
  },
  'gl.exact': { en: '{name} · exact location', uk: '{name} · точне місце' },
  'gl.targetLabel.mars': { en: 'Mars · reference', uk: 'Марс · еталон' },
  'gl.targetLabel.moon': { en: 'Moon · reference', uk: 'Місяць · еталон' },
  'gl.cmpKicker': { en: 'Comparison · {scn}', uk: 'Порівняння · {scn}' },
  'gl.vs': { en: 'vs', uk: 'і' },
  'gl.cmpLedeHtml': {
    en: 'Similarity <strong>{s}</strong> ({level}). The radar between the globes shows each of the 8 criteria (1 = identical).',
    uk: 'Схожість <strong>{s}</strong> ({level}). Радар між глобусами показує кожен із 8 критеріїв (1 — повний збіг).',
  },
  'gl.earthVs.mars': { en: 'Earth vs Mars', uk: 'Земля і Марс' },
  'gl.earthVs.moon': { en: 'Earth vs Moon', uk: 'Земля і Місяць' },

  /* ---------------- charts (js/charts.js) ---------------- */
  'ch.rankTitle': { en: 'Earth analogs ranked for {ref}', uk: 'Рейтинг земних аналогів · еталон: {ref}' },
  'ch.rankSub': { en: 'Similarity score, scenario: {s} · click a bar to compare it on the radar', uk: 'Індекс схожості, сценарій: {s} · натисніть на стовпчик, щоб порівняти на радарі' },
  'ch.scoreAxis': { en: 'Score (0 = no match, 1 = identical)', uk: 'Індекс (0 — немає збігу, 1 — повний збіг)' },
  'ch.scoreRank': { en: 'Score {v} · rank {r}', uk: 'Індекс {v} · місце {r}' },
  'ch.coverage': { en: 'Coverage {v}', uk: 'Покриття {v}' },
  'ch.intendedFor': { en: 'Intended analog for this reference', uk: 'Задуманий аналог для цього еталона' },
  'ch.radarTitle': { en: '{a} vs {r}', uk: '{a} і {r}' },
  'ch.radarSub': { en: 'Similarity per criterion (0–1) · total {t} · scenario: {s}', uk: 'Схожість за критеріями (0–1) · разом {t} · сценарій: {s}' },
  'ch.noScore': { en: 'No score for this pair', uk: 'Для цієї пари немає оцінки' },
  'ch.analogDs': { en: '{a} (Earth analog)', uk: '{a} (земний аналог)' },
  'ch.refDs': { en: '{r} (reference = 1)', uk: '{r} (еталон = 1)' },
  'ch.sWeight': { en: ' · weight {w}', uk: ' · вага {w}' },
  'ch.heatTitle': { en: 'Similarity of every Earth analog to every reference', uk: 'Схожість кожного земного аналога з кожним еталоном' },
  'ch.heatSub': {
    en: 'Scenario: {s} · mean score vs Mars {m}, vs Moon {n} · outlined = intended pair, number = best analog per reference',
    uk: 'Сценарій: {s} · середній індекс для Марса {m}, для Місяця {n} · рамка — задумана пара, число — найкращий аналог для еталона',
  },
  'ch.heatLabel': { en: 'Score {v} · coverage {c}', uk: 'Індекс {v} · покриття {c}' },
  'ch.intendedPair': { en: 'Intended pair', uk: 'Задумана пара' },
  'ch.legendPair': { en: 'Intended analog (pair)', uk: 'Задуманий аналог (пара)' },
  'ch.legendOther': { en: 'Other analogs', uk: 'Інші аналоги' },
  'ch.scoreWord': { en: 'score', uk: 'індекс' },
  'ch.placeholder': { en: ' (placeholder value, not yet verified)', uk: ' (тимчасове значення, ще не перевірене)' },
  'raw.temp': { en: 'Surface temperature', uk: 'Температура поверхні' },
  'raw.sun': { en: 'Solar elevation', uk: 'Висота Сонця' },
  'raw.slope': { en: 'Mean slope', uk: 'Середній схил' },
  'raw.relief': { en: 'Relief', uk: 'Рельєф' },
  'raw.min': { en: 'Min', uk: 'Мін.' },
  'raw.mean': { en: 'Mean', uk: 'Середня' },
  'raw.max': { en: 'Max', uk: 'Макс.' },
  'raw.slopeItem': { en: 'Slope', uk: 'Схил' },
  'raw.reliefItem': { en: 'Relief', uk: 'Рельєф' },

  /* ---------------- maps (js/maps.js) ---------------- */
  'map.projAria': { en: 'Moon projection', uk: 'Проєкція Місяця' },
  'map.proj.polar': { en: 'South Pole', uk: 'Південний полюс' },
  'map.proj.global': { en: 'Global', uk: 'Уся поверхня' },
  'map.legend.other': { en: 'Other site', uk: 'Інша локація' },
  'map.legend.target.mars': { en: 'Mars target site', uk: 'Еталонна локація на Марсі' },
  'map.legend.target.moon': { en: 'Lunar target site', uk: 'Еталонна локація на Місяці' },
  'map.placeholder': { en: 'Placeholder grid (tiles unavailable)', uk: 'Тимчасова сітка (тайли недоступні)' },
};

/* ------------------------------------------------------------------ */

function detect() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('lang');
  if (LANGS.includes(fromHash)) return fromHash;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch { /* storage blocked: fall through */ }
  const nav = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
  return nav.some((l) => /^uk\b/i.test(l)) ? 'uk' : 'en';
}

let lang = detect();
const listeners = [];

export const getLang = () => lang;

export function t(key, vars) {
  const entry = DICT[key];
  let s = entry?.[lang] ?? entry?.en;
  if (s === undefined) {
    if (key.startsWith('region.')) return key.slice(7); // untranslated region: keep the English name
    console.warn('[i18n] missing key', key);
    return key;
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** Ukrainian plural: 1 локація, 2–4 локації, 5+ локацій. */
export function nSites(n) {
  if (lang !== 'uk') return `${n} site${n === 1 ? '' : 's'}`;
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'локація' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'локації' : 'локацій';
  return `${n} ${word}`;
}

/** Choose a data value for the current language (falls back to English). */
export const pick = (en, uk) => (lang === 'uk' && uk ? uk : en);

/**
 * Fill the static page:
 *   data-i18n="key"                     → textContent
 *   data-i18n-html="key"                → innerHTML (trusted dictionary markup)
 *   data-i18n-attr="aria-label:key;…"   → attributes
 */
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
}

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* not persisted */ }
  applyStatic();
  listeners.forEach((fn) => fn(lang));
}

export function onLangChange(fn) { listeners.push(fn); }
