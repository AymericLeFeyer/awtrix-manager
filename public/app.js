// Interface sans framework : un état serveur, re-rendu à chaque changement.
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const html = (strings, ...vals) => strings.reduce((out, s, i) => out + s + (i < vals.length ? (vals[i]?.__raw ?? (Array.isArray(vals[i]) ? vals[i].map((v) => v?.__raw ?? esc(v)).join('') : esc(vals[i]))) : ''), '');
const raw = (s) => ({ __raw: s });
const R = (s) => raw(s);

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}
const toastEl = $('#toast');
let toastTimer;
function toast(msg, bad = false) {
  toastEl.textContent = msg;
  toastEl.className = `show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = ''), 3500);
}
const run = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok); await refresh({ force: true }); return r; } catch (e) { toast(e.message, true); } };

let S = null;
let tab = 'widgets';
const dlg = $('#dlg');

let lastJson = '';
const editing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && document.activeElement.type !== 'checkbox';
async function refresh({ force = false } = {}) {
  S = await api('GET', '/api/state');
  // Le polling ne doit jamais redessiner pendant une saisie, ni si rien n'a changé.
  const json = JSON.stringify(S);
  if (!dlg.open && (force || (json !== lastJson && !editing()))) { render(); lastJson = json; }
  const pill = $('#mqtt-pill');
  pill.textContent = !S.mqtt.url ? 'MQTT non configuré' : S.mqtt.connected ? 'MQTT connecté' : `MQTT hors ligne${S.mqtt.error ? ` · ${S.mqtt.error}` : ''}`;
  pill.className = `pill ${S.mqtt.connected ? 'ok' : 'ko'}`;
}

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tab = b.dataset.tab;
  lastJson = '';
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});

const providerName = (id) => S.providers.find((p) => p.id === id)?.name ?? '?';
const iconUrl = (icon, deviceId) =>
  !icon ? '' : /^\d+$/.test(icon) ? `/api/icons/lametric/${icon}` : deviceId ? `/api/icons/device/${deviceId}/${encodeURIComponent(icon)}` : '';
const ledHtml = (text, icon, color, rainbow, deviceId) => html`<span class="led">${icon ? R(html`<img src="${iconUrl(icon, deviceId)}" alt="" onerror="this.style.visibility='hidden'">`) : ''}<span class="t ${rainbow ? 'rainbow' : ''}" style="${color && !rainbow ? `color:${color}` : ''}">${text}</span></span>`;

function render() {
  const v = $('#view');
  v.innerHTML = { widgets: viewWidgets, devices: viewDevices, providers: viewProviders, settings: viewSettings }[tab]();
  bind(v);
}

// --- Widgets ---------------------------------------------------------------
function viewWidgets() {
  if (!S.devices.length || !S.providers.length) {
    return html`<div class="card"><b>Pour commencer</b><p class="muted">Configure le broker dans l'onglet MQTT, ajoute au moins un appareil et un provider, puis crée tes widgets ici.</p></div>`;
  }
  return html`
    <div class="bar"><h2>Widgets</h2><button class="btn primary" data-act="new-widget">+ Nouveau widget</button></div>
    <div class="card" style="padding:0;overflow:auto"><table>
      <tr><th>Aperçu</th><th>Widget</th>${R(S.devices.map((d) => html`<th class="c"><span class="dot ${d.online ? 'on' : ''}"></span> ${d.name}</th>`).join(''))}<th></th></tr>
      ${R(S.widgets.map((w) => html`<tr>
        <td>${R(ledHtml(w.runtime?.text ?? '…', w.icon, w.color, w.rainbow, w.devices[0]))}</td>
        <td><b>${w.label || w.name}</b> ${R(w.enabled ? '' : '<span class="muted">(désactivé)</span>')}<div class="muted">${providerName(w.providerId)} · ${w.name}</div>${R(w.runtime?.error ? html`<div class="err">${w.runtime.error}</div>` : '')}</td>
        ${R(S.devices.map((d) => html`<td class="c"><input type="checkbox" data-act="toggle-dev" data-w="${w.id}" data-d="${d.id}" ${w.devices.includes(d.id) ? 'checked' : ''}></td>`).join(''))}
        <td style="white-space:nowrap"><button class="btn sm" data-act="refresh-widget" data-id="${w.id}" title="Rafraîchir">↻</button> <button class="btn sm" data-act="edit-widget" data-id="${w.id}">Modifier</button> <button class="btn sm danger" data-act="del-widget" data-id="${w.id}">✕</button></td>
      </tr>`).join(''))}
      ${R(S.widgets.length ? '' : `<tr><td colspan="${S.devices.length + 3}" class="muted">Aucun widget.</td></tr>`)}
    </table></div>`;
}

// --- Appareils ------------------------------------------------------------
function viewDevices() {
  return html`
    <div class="bar"><h2>Appareils AWTRIX</h2><button class="btn primary" data-act="new-device">+ Ajouter</button></div>
    ${R(S.devices.map((d) => {
      const st = d.stats;
      return html`<div class="card">
        <div class="row sp"><div><span class="dot ${d.online ? 'on' : ''}"></span> <b>${d.name}</b> <span class="muted">${d.prefix}${st?.ip_address ? ` · ${st.ip_address}` : ''}${st?.version ? ` · v${st.version}` : ''}</span></div>
          <div><button class="btn sm" data-act="edit-device" data-id="${d.id}">Modifier</button> <button class="btn sm danger" data-act="del-device" data-id="${d.id}">Supprimer</button></div></div>
        ${R(st ? html`<p class="muted">App : ${st.app} · Luminosité : ${st.bri} · Batterie : ${st.bat ?? '–'}% · Temp : ${st.temp ?? '–'}° · Wi-Fi : ${st.wifi_signal ?? '–'} dBm · Uptime : ${Math.round((st.uptime ?? 0) / 3600)} h</p>` : '<p class="muted">En attente des statistiques MQTT…</p>')}
        <div class="row">
          <button class="btn sm" data-act="dev" data-do="power" data-on="1" data-id="${d.id}">Allumer</button>
          <button class="btn sm" data-act="dev" data-do="power" data-on="0" data-id="${d.id}">Éteindre</button>
          <button class="btn sm" data-act="dev" data-do="previous" data-id="${d.id}">◀</button>
          <button class="btn sm" data-act="dev" data-do="next" data-id="${d.id}">▶</button>
          <button class="btn sm" data-act="dev" data-do="sync" data-id="${d.id}">Renvoyer les widgets</button>
          <button class="btn sm" data-act="notify" data-id="${d.id}">Notification test</button>
          <button class="btn sm danger" data-act="dev" data-do="reboot" data-id="${d.id}">Redémarrer</button>
          <label class="muted">Luminosité <input type="range" min="0" max="255" value="${st?.bri ?? 100}" style="width:140px" data-act="bri" data-id="${d.id}"></label>
        </div></div>`;
    }).join(''))}
    ${R(S.devices.length ? '' : '<div class="card muted">Aucun appareil.</div>')}`;
}

// --- Providers ------------------------------------------------------------
function viewProviders() {
  return html`
    <div class="bar"><h2>Providers</h2><button class="btn primary" data-act="new-provider">+ Ajouter</button></div>
    ${R(S.providers.map((p) => {
      const t = S.types.find((x) => x.type === p.type);
      return html`<div class="card row sp"><div><b>${p.name}</b> <span class="muted">${t?.label ?? p.type} · ${S.widgets.filter((w) => w.providerId === p.id).length} widget(s)</span></div>
        <div>${R((t?.actions ?? []).map((a) => html`<button class="btn sm" data-act="prov-action" data-id="${p.id}" data-name="${a.id}">${a.label}</button> `).join(''))}<button class="btn sm" data-act="edit-provider" data-id="${p.id}">Modifier</button> <button class="btn sm danger" data-act="del-provider" data-id="${p.id}">Supprimer</button></div></div>`;
    }).join(''))}
    ${R(S.providers.length ? '' : '<div class="card muted">Aucun provider.</div>')}`;
}

// --- MQTT -----------------------------------------------------------------
function viewSettings() {
  const m = S.mqtt;
  return html`<h2>Broker MQTT</h2><div class="card" style="max-width:520px">
    <p class="muted">Le broker auquel tes AWTRIX sont reliés (Paramètres MQTT de chaque AWTRIX).</p>
    <label class="f"><span>URL</span><input id="m-url" value="${m.url}" placeholder="mqtt://192.168.68.87:1883"></label>
    <div class="two"><label class="f"><span>Utilisateur</span><input id="m-user" value="${m.username}"></label>
    <label class="f"><span>Mot de passe</span><input id="m-pass" type="password" value="${m.password}"></label></div>
    <div class="row sp"><span class="muted">${m.connected ? '✓ connecté' : m.error || 'non connecté'}</span><button class="btn primary" data-act="save-mqtt">Enregistrer</button></div></div>`;
}

// --- Dialogues -------------------------------------------------------------
function openDialog(content) { dlg.innerHTML = content; dlg.showModal(); bind(dlg); }
dlg.addEventListener('close', () => { dlg.innerHTML = ''; render(); });
const closeDlg = () => dlg.close();
const val = (id) => $(`#${id}`, dlg.open ? dlg : document).value;

function deviceForm(d = {}) {
  openDialog(html`<h3>${d.id ? 'Modifier' : 'Ajouter'} un appareil</h3>
    <label class="f"><span>Nom</span><input id="d-name" value="${d.name}" placeholder="Salon"></label>
    <label class="f"><span>Préfixe MQTT (réglé sur l'AWTRIX)</span><input id="d-prefix" value="${d.prefix}" placeholder="awtrix_salon"></label>
    <label class="f"><span>Adresse IP (facultatif : sinon lue dans les stats)</span><input id="d-host" value="${d.host}" placeholder="192.168.68.50"></label>
    <div class="actions"><button class="btn" data-act="close">Annuler</button><button class="btn primary" data-act="save-device" data-id="${d.id ?? ''}">Enregistrer</button></div>`);
}

function providerForm(p) {
  const type = p?.type ?? S.types[0].type;
  const render = (type) => {
    const t = S.types.find((x) => x.type === type);
    $('#p-fields', dlg).innerHTML = t.fields.map((f) => html`<label class="f"><span>${f.label}</span>${R(f.multiline
      ? html`<textarea id="pf-${f.key}" rows="3">${p?.config?.[f.key] ?? ''}</textarea>`
      : html`<input id="pf-${f.key}" type="${f.secret ? 'password' : 'text'}" value="${p?.config?.[f.key] ?? ''}" placeholder="${f.placeholder ?? ''}" autocomplete="off">`)}</label>`).join('');
  };
  openDialog(html`<h3>${p ? 'Modifier' : 'Ajouter'} un provider</h3>
    <label class="f"><span>Type</span><select id="p-type" ${p ? 'disabled' : ''}>${R(S.types.map((t) => html`<option value="${t.type}" ${t.type === type ? 'selected' : ''}>${t.label}</option>`).join(''))}</select></label>
    <label class="f"><span>Nom</span><input id="p-name" value="${p?.name ?? ''}"></label>
    <div id="p-fields"></div>
    <div class="actions"><button class="btn" data-act="close">Annuler</button><button class="btn primary" data-act="save-provider" data-id="${p?.id ?? ''}">Enregistrer</button></div>`);
  render(type);
  $('#p-type', dlg).addEventListener('change', (e) => render(e.target.value));
}

// Éditeur de widget
let W = null; // widget en cours d'édition
let previewTimer;
function widgetForm(w) {
  W = structuredClone(w ?? { name: '', label: '', enabled: true, providerId: S.providers[0].id, source: null, format: { template: '{value}' }, icon: '', color: '', rainbow: false, center: false, noScroll: false, duration: 10, refresh: 300, devices: S.devices.map((d) => d.id) });
  openDialog(html`<h3>${w ? 'Modifier' : 'Nouveau'} widget</h3>
    <div class="two">
      <label class="f"><span>Nom de l'app AWTRIX</span><input id="w-name" value="${W.name}" placeholder="youtube"></label>
      <label class="f"><span>Libellé (interface)</span><input id="w-label" value="${W.label}" placeholder="Abonnés YouTube"></label>
    </div>
    <label class="f"><span>Provider</span><select id="w-prov">${R(S.providers.map((p) => html`<option value="${p.id}" ${p.id === W.providerId ? 'selected' : ''}>${p.name}</option>`).join(''))}</select></label>
    <label class="f"><span>Source de la valeur</span><input id="w-q" placeholder="Rechercher…"><div class="srcs" id="w-srcs"></div></label>
    <div class="muted" id="w-selected"></div>
    <div class="two" style="margin-top:12px">
      <label class="f"><span>Gabarit ({value} {unit} {name})</span><input id="w-tpl" value="${W.format.template}"></label>
      <label class="f"><span>Décimales</span><input id="w-dec" type="number" min="0" max="6" value="${W.format.decimals ?? ''}" placeholder="auto"></label>
    </div>
    <div class="row" style="margin-bottom:12px"><label class="chk"><input type="checkbox" id="w-compact" ${W.format.compact ? 'checked' : ''}> Format compact (12,4k)</label></div>
    <label class="f"><span>Icône (ID LaMetric ou nom d'une icône de l'appareil)</span>
      <div class="row"><input id="w-icon" value="${W.icon}" placeholder="6491" style="width:140px"><span class="iprev" id="w-iprev"></span>
      <button class="btn sm" data-act="install-icon" type="button">Installer sur les appareils cochés</button></div></label>
    <div class="row"><span class="muted">Icônes sur</span><select id="w-idev" style="width:auto">${R(S.devices.map((d) => html`<option value="${d.id}">${d.name}</option>`).join(''))}</select><button class="btn sm" data-act="load-icons" type="button">Afficher</button></div>
    <div class="icons" id="w-icons"></div>
    <div class="two" style="margin-top:12px">
      <label class="f"><span>Couleur</span><div class="row"><input type="color" id="w-color" value="${W.color || '#ffffff'}"><label class="chk"><input type="checkbox" id="w-usecolor" ${W.color ? 'checked' : ''}> personnalisée</label><label class="chk"><input type="checkbox" id="w-rainbow" ${W.rainbow ? 'checked' : ''}> arc-en-ciel</label></div></label>
      <label class="f"><span>Durée d'affichage (s) · rafraîchissement (s)</span><div class="row"><input id="w-dur" type="number" min="0" value="${W.duration}" style="width:90px"><input id="w-ref" type="number" min="10" value="${W.refresh}" style="width:100px"></div></label>
    </div>
    <div class="row" style="margin-bottom:12px"><label class="chk"><input type="checkbox" id="w-center" ${W.center ? 'checked' : ''}> Centré</label><label class="chk"><input type="checkbox" id="w-noscroll" ${W.noScroll ? 'checked' : ''}> Sans défilement</label><label class="chk"><input type="checkbox" id="w-enabled" ${W.enabled ? 'checked' : ''}> Activé</label></div>
    <div class="f"><span class="muted">Installer sur</span><div class="row">${R(S.devices.map((d) => html`<label class="chk"><input type="checkbox" class="w-dev" value="${d.id}" ${W.devices.includes(d.id) ? 'checked' : ''}> ${d.name}</label>`).join(''))}</div></div>
    <div class="row sp"><div class="row"><span class="muted">Aperçu</span><span id="w-led"></span><span class="err" id="w-err"></span></div>
      <div class="actions" style="margin:0"><button class="btn" data-act="close">Annuler</button><button class="btn primary" data-act="save-widget" data-id="${w?.id ?? ''}">Enregistrer</button></div></div>`);
  $('#w-prov', dlg).addEventListener('change', () => { W.providerId = val('w-prov'); W.source = null; loadSources(); updatePreview(); });
  ['w-tpl', 'w-dec', 'w-compact', 'w-icon', 'w-color', 'w-usecolor', 'w-rainbow'].forEach((id) => $(`#${id}`, dlg).addEventListener('input', () => { collect(); updatePreview(); }));
  $('#w-q', dlg).addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = setTimeout(loadSources, 250); });
  loadSources(); updatePreview();
}

function collect() {
  W.name = val('w-name'); W.label = val('w-label'); W.providerId = val('w-prov');
  W.format = { template: val('w-tpl'), decimals: val('w-dec'), compact: $('#w-compact', dlg).checked };
  W.icon = val('w-icon').trim();
  W.color = $('#w-usecolor', dlg).checked ? val('w-color') : '';
  W.rainbow = $('#w-rainbow', dlg).checked; W.center = $('#w-center', dlg).checked; W.noScroll = $('#w-noscroll', dlg).checked; W.enabled = $('#w-enabled', dlg).checked;
  W.duration = Number(val('w-dur')); W.refresh = Number(val('w-ref'));
  W.devices = [...dlg.querySelectorAll('.w-dev:checked')].map((x) => x.value);
}

let sources = [];
async function loadSources() {
  const box = $('#w-srcs', dlg); if (!box) return;
  box.innerHTML = '<div class="muted">Chargement…</div>';
  try {
    sources = await api('GET', `/api/providers/${val('w-prov')}/sources?q=${encodeURIComponent(val('w-q'))}`);
    box.innerHTML = sources.map((s, i) => html`<div data-i="${i}" class="${JSON.stringify(s.source) === JSON.stringify(W.source) ? 'sel' : ''}"><span>${s.label}</span><span class="muted">${s.preview}</span></div>`).join('') || '<div class="muted">Aucun résultat</div>';
  } catch (e) { box.innerHTML = html`<div class="err">${e.message}</div>`; }
  showSelected();
}
const showSelected = () => { const el = $('#w-selected', dlg); if (el) el.textContent = W.source ? `Source : ${JSON.stringify(W.source)}` : 'Aucune source choisie'; };

let prevSeq = 0;
async function updatePreview() {
  collect();
  const seq = ++prevSeq;
  const led = $('#w-led', dlg), err = $('#w-err', dlg); if (!led) return;
  const color = W.color, rainbow = W.rainbow;
  let text = '???';
  if (W.source) {
    const r = await api('POST', '/api/preview', { providerId: W.providerId, source: W.source, format: W.format }).catch((e) => ({ text: '???', error: e.message }));
    if (seq !== prevSeq || !dlg.open) return;
    text = r.text; err.textContent = r.error || '';
  }
  led.innerHTML = ledHtml(text, W.icon, color, rainbow, $('#w-idev', dlg)?.value);
  $('#w-iprev', dlg).innerHTML = W.icon ? html`<img src="${iconUrl(W.icon, $('#w-idev', dlg)?.value)}" alt="" onerror="this.style.visibility='hidden'">` : '';
}

// --- Actions (délégation) --------------------------------------------------
function bind(root) {
  root.onclick = async (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const { act, id } = el.dataset;
    const dev = S.devices.find((d) => d.id === id), prov = S.providers.find((p) => p.id === id), wid = S.widgets.find((w) => w.id === id);
    switch (act) {
      case 'close': return closeDlg();
      case 'new-widget': return widgetForm();
      case 'edit-widget': return widgetForm(wid);
      case 'refresh-widget': return run(() => api('POST', `/api/widgets/${id}/refresh`), 'Rafraîchi');
      case 'del-widget': if (confirm(`Supprimer « ${wid.label || wid.name} » ? Il sera retiré des appareils.`)) run(() => api('DELETE', `/api/widgets/${id}`)); return;
      case 'toggle-dev': {
        const w = S.widgets.find((x) => x.id === el.dataset.w);
        const devices = el.checked ? [...w.devices, el.dataset.d] : w.devices.filter((x) => x !== el.dataset.d);
        return run(() => api('PUT', `/api/widgets/${w.id}`, { ...w, devices }));
      }
      case 'save-widget': {
        collect();
        if (!W.source) return toast('Choisis une source', true);
        try { await api(id ? 'PUT' : 'POST', id ? `/api/widgets/${id}` : '/api/widgets', W); closeDlg(); toast('Widget enregistré'); await refresh(); } catch (err) { toast(err.message, true); }
        return;
      }
      case 'install-icon': {
        collect();
        if (!/^\d+$/.test(W.icon)) return toast('Saisis un ID LaMetric numérique', true);
        for (const d of W.devices) { try { await api('POST', `/api/devices/${d}/install-icon`, { id: W.icon }); toast(`Icône ${W.icon} installée`); } catch (err) { toast(`${S.devices.find((x) => x.id === d)?.name} : ${err.message}`, true); } }
        return;
      }
      case 'load-icons': {
        const d = val('w-idev'), box = $('#w-icons', dlg);
        try {
          const list = await api('POST', `/api/devices/${d}/icons`, {});
          box.innerHTML = list.map((n) => html`<button type="button" data-act="pick-icon" data-name="${n}" title="${n}"><img src="/api/icons/device/${d}/${encodeURIComponent(n)}" alt="${n}"></button>`).join('') || '<span class="muted">Aucune icône.</span>';
        } catch (err) { box.innerHTML = html`<span class="err">${err.message}</span>`; }
        return;
      }
      case 'pick-icon': $('#w-icon', dlg).value = el.dataset.name; return updatePreview();
      case 'new-device': return deviceForm();
      case 'edit-device': return deviceForm(dev);
      case 'save-device': {
        const body = { name: val('d-name'), prefix: val('d-prefix'), host: val('d-host') };
        try { await api(id ? 'PUT' : 'POST', id ? `/api/devices/${id}` : '/api/devices', body); closeDlg(); await refresh(); } catch (err) { toast(err.message, true); }
        return;
      }
      case 'del-device': if (confirm(`Supprimer « ${dev.name} » ?`)) run(() => api('DELETE', `/api/devices/${id}`)); return;
      case 'dev': return run(() => api('POST', `/api/devices/${id}/${el.dataset.do}`, { on: el.dataset.on === '1' }), 'Envoyé');
      case 'notify': { const text = prompt('Texte de la notification', 'Coucou !'); if (text) run(() => api('POST', `/api/devices/${id}/notify`, { text }), 'Envoyé'); return; }
      case 'new-provider': return providerForm();
      case 'edit-provider': return providerForm(prov);
      case 'save-provider': {
        const type = id ? prov.type : val('p-type'), t = S.types.find((x) => x.type === type);
        const config = Object.fromEntries(t.fields.map((f) => [f.key, val(`pf-${f.key}`)]));
        try { await api(id ? 'PUT' : 'POST', id ? `/api/providers/${id}` : '/api/providers', { type, name: val('p-name'), config }); closeDlg(); await refresh(); } catch (err) { toast(err.message, true); }
        return;
      }
      case 'del-provider': if (confirm(`Supprimer « ${prov.name} » ?`)) run(() => api('DELETE', `/api/providers/${id}`)); return;
      case 'prov-action': return run(async () => { const r = await api('POST', `/api/providers/${id}/action/${el.dataset.name}`); if (r.errors?.length) throw new Error(r.errors.join(' · ')); }, 'Terminé');
      case 'save-mqtt': return run(() => api('PUT', '/api/mqtt', { url: val('m-url'), username: val('m-user'), password: val('m-pass') }), 'Enregistré');
    }
  };
  root.onchange = (e) => {
    const el = e.target;
    if (el.dataset?.act === 'bri') api('POST', `/api/devices/${el.dataset.id}/brightness`, { value: el.value }).catch((err) => toast(err.message, true));
  };
  // Choix d'une source dans la liste (dans le dialogue).
  if (root === dlg) {
    $('#w-srcs', dlg)?.addEventListener('click', (e) => {
      const row = e.target.closest('[data-i]'); if (!row) return;
      const s = sources[row.dataset.i];
      W.source = s.source;
      if (s.unit && W.format.template === '{value}') $('#w-tpl', dlg).value = '{value}{unit}';
      if (s.icon && !val('w-icon')) $('#w-icon', dlg).value = s.icon;
      if (!val('w-name')) $('#w-name', dlg).value = s.label.split(/[ (]/)[0].replaceAll('.', '-');
      dlg.querySelectorAll('#w-srcs .sel').forEach((x) => x.classList.remove('sel'));
      row.classList.add('sel'); showSelected(); updatePreview();
    });
  }
}

refresh().catch((e) => toast(e.message, true));
setInterval(() => { if (!dlg.open) refresh().catch(() => {}); }, 5000);
